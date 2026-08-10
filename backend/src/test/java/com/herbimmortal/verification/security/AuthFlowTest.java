package com.herbimmortal.verification.security;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The access rules, exercised through the real filter chain.
 *
 * <p>MockMvc with {@code @AutoConfigureMockMvc} runs requests through every
 * filter Spring Security installed, which is the only way these assertions mean
 * anything: calling the controller directly would skip authentication entirely
 * and every one of these tests would pass against a completely open system.
 *
 * <p>Needs the database from docker-compose, like the rest of the suite.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ObjectMapper json;

    /** Unique per run, so re-running the suite does not collide on the email index. */
    private static String freshEmail() {
        return "test-" + UUID.randomUUID() + "@example.com";
    }

    private JsonNode registerAccount(String email) throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","password":"a sufficiently long passphrase",
                                 "fullName":"Test Person"}
                                """.formatted(email)))
                .andExpect(status().isCreated())
                .andReturn();
        return json.readTree(result.getResponse().getContentAsString());
    }

    // ------------------------------------------------------------------
    // What must stay open
    // ------------------------------------------------------------------

    /**
     * The public lookup is the product. A patient checking whether their doctor
     * is real must never be asked to register with us first.
     */
    @Test
    void thePublicVerifyEndpointNeedsNoAccount() throws Exception {
        mvc.perform(get("/api/v1/public/verify").param("immortalId", "HI-26INA-K3M7Q"))
                .andExpect(status().isOk());
    }

    /**
     * Read by the public verify page to validate an ID before it sends one.
     * Gating these means either a signed out page cannot validate, or the
     * validation is skipped for exactly the callers we trust least.
     */
    @Test
    void referenceListsNeedNoAccount() throws Exception {
        mvc.perform(get("/api/v1/councils")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/countries")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/medical-systems")).andExpect(status().isOk());
    }

    // ------------------------------------------------------------------
    // What must not
    // ------------------------------------------------------------------

    @Test
    void everythingElseRefusesAnAnonymousCaller() throws Exception {
        mvc.perform(get("/api/v1/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/verifications")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/me/api-keys")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/admin/review")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/internal/practitioners/HI-26INA-K3M7Q"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/verifications")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    /**
     * A 401 has to be JSON. The client keys its silent token refresh off this
     * response, and Spring's default is an HTML error page or a redirect to a
     * login form, either of which a fetch() cannot act on.
     */
    @Test
    void refusalIsJsonRatherThanAnHtmlLoginPage() throws Exception {
        mvc.perform(get("/api/v1/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // ------------------------------------------------------------------
    // Signing up
    // ------------------------------------------------------------------

    @Test
    void signUpReturnsTokensAndTheAccount() throws Exception {
        JsonNode body = registerAccount(freshEmail());

        assertThat(body.get("accessToken").asText()).isNotBlank();
        assertThat(body.get("refreshToken").asText()).isNotBlank();
        // The account travels with the tokens so the client does not need a
        // second round trip to find out where to send the person.
        assertThat(body.get("user").get("role").asText()).isEqualTo("PRACTITIONER");
    }

    /**
     * The single most important assertion in this file.
     *
     * <p>If a role could be bound from a public request body, anyone who can
     * POST to a public endpoint could mint themselves an administrator, and the
     * request would look entirely ordinary in an access log.
     */
    @Test
    void signUpIgnoresARoleAskedForInTheBody() throws Exception {
        MvcResult result = mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","password":"a sufficiently long passphrase",
                                 "fullName":"Escalation Attempt","role":"ADMIN"}
                                """.formatted(freshEmail())))
                .andExpect(status().isCreated())
                .andReturn();

        assertThat(json.readTree(result.getResponse().getContentAsString())
                .get("user").get("role").asText()).isEqualTo("PRACTITIONER");
    }

    @Test
    void signUpRefusesAShortPassword() throws Exception {
        mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","password":"short","fullName":"Short Pass"}
                                """.formatted(freshEmail())))
                .andExpect(status().isBadRequest());
    }

    @Test
    void signUpRefusesAPasswordContainingTheEmail() throws Exception {
        mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"predictable@example.com",
                                 "password":"predictable123456","fullName":"Predictable Person"}
                                """))
                .andExpect(status().isBadRequest());
    }

    /**
     * Addresses are normalized before the uniqueness check, so one person
     * cannot end up with two accounts that differ only in capitals and then be
     * unable to sign in to either.
     */
    @Test
    void signUpTreatsAddressesCaseInsensitively() throws Exception {
        String email = freshEmail();
        registerAccount(email);

        mvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","password":"a different long passphrase",
                                 "fullName":"Someone Else"}
                                """.formatted(email.toUpperCase())))
                .andExpect(status().isConflict());
    }

    // ------------------------------------------------------------------
    // Signing in
    // ------------------------------------------------------------------

    /**
     * The wrong password and an address with no account answer identically.
     * Anything else turns this endpoint into a way to enumerate who holds an
     * account, which for a register of named medical practitioners is a real
     * disclosure.
     */
    @Test
    void aFailedSignInNeverSaysWhichHalfWasWrong() throws Exception {
        String email = freshEmail();
        registerAccount(email);

        MvcResult wrongPassword = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"%s","password":"not the right one at all"}
                                """.formatted(email)))
                .andExpect(status().isUnauthorized())
                .andReturn();

        MvcResult unknownAccount = mvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"nobody-%s@example.com","password":"not the right one at all"}
                                """.formatted(UUID.randomUUID())))
                .andExpect(status().isUnauthorized())
                .andReturn();

        assertThat(wrongPassword.getResponse().getContentAsString())
                .isEqualTo(unknownAccount.getResponse().getContentAsString());
    }

    // ------------------------------------------------------------------
    // Ownership
    // ------------------------------------------------------------------

    /**
     * Someone else's case and a case that does not exist answer the same.
     *
     * <p>Section 7.3. If one answered 403 and the other 404, a caller walking
     * ids would learn exactly which ones are real without ever seeing their
     * contents.
     */
    @Test
    void anotherAccountsCaseIsNotFoundRatherThanForbidden() throws Exception {
        String token = registerAccount(freshEmail()).get("accessToken").asText();

        mvc.perform(get("/api/v1/verifications/" + UUID.randomUUID())
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    @Test
    void aNewAccountSeesAnEmptyCaseListRatherThanEveryonesCases() throws Exception {
        String token = registerAccount(freshEmail()).get("accessToken").asText();

        mvc.perform(get("/api/v1/verifications").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    /** A practitioner is not a reviewer, and finds that out as 403 rather than 404. */
    @Test
    void aPractitionerCannotReachTheConsole() throws Exception {
        String token = registerAccount(freshEmail()).get("accessToken").asText();

        mvc.perform(get("/api/v1/admin/review").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------------
    // Tokens
    // ------------------------------------------------------------------

    @Test
    void aForgedOrGarbledTokenIsRefused() throws Exception {
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer not.a.real.token"))
                .andExpect(status().isUnauthorized());

        // A well formed JWT signed with the wrong key. The signature check is
        // the whole security of a stateless token, so this one matters.
        String forged = "eyJhbGciOiJIUzI1NiJ9"
                + ".eyJpc3MiOiJoZXJiaW1tb3J0YWwtdmVyaWZpY2F0aW9uIiwic3ViIjoi"
                + "MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwMDAxIiwicm9sZSI6IkFETUlOIn0"
                + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        mvc.perform(get("/api/v1/me").header("Authorization", "Bearer " + forged))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void refreshRotatesTheTokenAndTheOldOneStopsWorking() throws Exception {
        String refreshToken = registerAccount(freshEmail()).get("refreshToken").asText();

        MvcResult rotated = mvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"%s\"}".formatted(refreshToken)))
                .andExpect(status().isOk())
                .andReturn();

        String replacement = json.readTree(rotated.getResponse().getContentAsString())
                .get("refreshToken").asText();
        assertThat(replacement).isNotEqualTo(refreshToken);

        // Replaying the consumed token is either a retry after a dropped
        // response or a stolen copy. Nothing can tell those apart, so the
        // server assumes the worse.
        mvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"%s\"}".formatted(refreshToken)))
                .andExpect(status().isUnauthorized());

        // ...and having assumed it, the whole family is revoked, so the
        // replacement is dead too. This assertion is the one that failed when
        // the revocation was being rolled back by the throw that followed it.
        mvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refreshToken\":\"%s\"}".formatted(replacement)))
                .andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------------------
    // API keys
    // ------------------------------------------------------------------

    @Test
    void anApiKeyIsShownOnceAndNeverListedAgain() throws Exception {
        String token = registerAccount(freshEmail()).get("accessToken").asText();

        MvcResult created = mvc.perform(post("/api/v1/me/api-keys")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"test integration\"}"))
                .andExpect(status().isCreated())
                .andReturn();

        String key = json.readTree(created.getResponse().getContentAsString()).get("key").asText();
        assertThat(key).startsWith("hi_live_");

        MvcResult listed = mvc.perform(get("/api/v1/me/api-keys")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn();

        // Not "the key field is absent" but "the secret appears nowhere in the
        // response at all", which also catches it leaking through some other
        // field somebody adds later.
        assertThat(listed.getResponse().getContentAsString()).doesNotContain(key);
    }

    @Test
    void anApiKeyAuthenticatesTheInternalLookupButCannotMintMoreKeys() throws Exception {
        String token = registerAccount(freshEmail()).get("accessToken").asText();

        MvcResult created = mvc.perform(post("/api/v1/me/api-keys")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"machine\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        String key = json.readTree(created.getResponse().getContentAsString()).get("key").asText();

        // Authenticated: 404 is "no such verified practitioner", not "who are
        // you". An unauthenticated call to the same path answers 401.
        mvc.perform(get("/api/v1/internal/practitioners/HI-26INA-K3M7Q")
                        .header("X-API-Key", key))
                .andExpect(status().isNotFound());

        // A stolen key that can mint keys is a stolen account: revoking the one
        // that leaked would accomplish nothing.
        mvc.perform(post("/api/v1/me/api-keys")
                        .header("X-API-Key", key)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"escalation\"}"))
                .andExpect(status().isForbidden());
    }
}

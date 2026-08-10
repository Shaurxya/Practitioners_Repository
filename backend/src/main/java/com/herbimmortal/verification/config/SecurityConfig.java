package com.herbimmortal.verification.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.herbimmortal.verification.security.ApiKeyAuthenticationFilter;
import com.herbimmortal.verification.security.AuthProperties;
import com.herbimmortal.verification.security.JwtAuthenticationFilter;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.time.Instant;
import java.util.Map;

/**
 * What is public, what needs an account, and what needs a role.
 *
 * <p>This is the only file in the system that answers those questions. Adding
 * Spring Security flipped the default for every endpoint from open to denied,
 * which means a new controller is unreachable until someone comes here and says
 * otherwise. That is the correct direction for the mistake to point: forgetting
 * this file produces a 401 in development, where the previous arrangement
 * produced a public admin endpoint in production.
 *
 * <h2>The rule for this product</h2>
 *
 * Everything that <em>does</em> something on behalf of a person needs an
 * account: claiming a registration, reading your own cases, minting an API key,
 * anything in the console.
 *
 * <p>One endpoint stays open, and it has to. {@code /api/v1/public/verify} is
 * what a patient or an employer calls to check a practitioner, and it is the
 * reason the rest of the system exists. Requiring a login there would mean a
 * patient must register with us before they can find out whether their doctor is
 * real, which defeats the product. It is unauthenticated, rate limited, answers
 * identically for an unknown and an unverified ID, and returns a name reduced to
 * an initial and a surname. Section 7 marks it "no auth" and that stands.
 *
 * <p>The reference lists stay open for the same reason: the public verify page
 * validates an ID against them before it will send a request, and gating them
 * would mean either a signed out page cannot validate or the validation is
 * skipped for exactly the callers we trust least.
 */
@Configuration
@EnableConfigurationProperties(AuthProperties.class)
// Turns on @PreAuthorize. Without it those annotations are silently inert,
// which is the worst possible failure mode for an authorization annotation:
// the code reads as guarded and is not.
@EnableMethodSecurity
public class SecurityConfig {

    private final ObjectMapper json;

    public SecurityConfig(ObjectMapper json) {
        this.json = json;
    }

    /**
     * BCrypt at the default cost of 10.
     *
     * <p>Roughly 60ms per hash on this hardware. That is the number the whole
     * choice turns on: high enough that guessing a stolen hash is expensive,
     * low enough that it does not become the dominant cost of signing in. Cost
     * 12 is four times slower and would put a quarter of a second into every
     * sign in and every failed attempt, which is also a quarter of a second an
     * attacker can spend to occupy a request thread.
     *
     * <p>The encoded output carries its own cost factor, so raising this later
     * verifies old hashes correctly and only new passwords get the new cost.
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http,
                                           JwtAuthenticationFilter jwtFilter,
                                           ApiKeyAuthenticationFilter apiKeyFilter)
            throws Exception {

        http
            // CSRF protects cookie authenticated requests, because a browser
            // attaches cookies to a cross site form post without being asked.
            // Nothing here is cookie authenticated: credentials travel in an
            // Authorization header that no cross origin form can set. Leaving
            // CSRF on would break every API client to defend against an attack
            // this design cannot suffer.
            .csrf(csrf -> csrf.disable())

            // No HttpSession, ever. Every request carries its own credential,
            // so there is no server side session to pin a user to one instance
            // and nothing to replicate when there are two.
            .sessionManagement(session ->
                    session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))

            .authorizeHttpRequests(auth -> auth
                // ---- the error dispatch, which is not a request anyone made ----
                //
                // When an exception escapes a controller, the servlet container
                // forwards internally to /error. That forward re-enters this
                // filter chain, carries no Authorization header, and so was
                // caught by anyRequest().authenticated() below.
                //
                // The result: every unhandled server fault answered 401
                // "Sign in to continue." A 500 was unreachable. That is worse
                // than a wrong status code, because the React apiClient keys its
                // token refresh off 401, so a server side bug made every client
                // refresh its token and retry, hiding the fault and doubling the
                // load that caused it.
                //
                // Found by submitting a claim that hit a constraint violation
                // and getting 401 back from an endpoint the caller was correctly
                // authenticated for.
                .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()

                // ---- open, deliberately ----
                .requestMatchers(HttpMethod.POST,
                        "/api/v1/auth/register",
                        "/api/v1/auth/login",
                        "/api/v1/auth/refresh",
                        "/api/v1/auth/logout").permitAll()

                // The product's whole point. See the class comment.
                .requestMatchers(HttpMethod.GET, "/api/v1/public/**").permitAll()

                // Read by the public verify page to validate an ID before it
                // sends one, and by the signup and claim forms.
                .requestMatchers(HttpMethod.GET,
                        "/api/v1/councils",
                        "/api/v1/countries",
                        "/api/v1/medical-systems").permitAll()

                .requestMatchers("/actuator/health", "/actuator/health/**").permitAll()

                // Preflight carries no credentials by definition, so requiring
                // authentication on it fails every cross origin call before the
                // real request is ever made.
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                // ---- role gated ----
                // Registry import rewrites the table every verification is
                // decided against. Reviewers read; only admins import.
                .requestMatchers("/api/v1/admin/imports/**",
                        "/api/v1/admin/profiles/**").hasRole("ADMIN")

                // The review queue and everything else in the console.
                .requestMatchers("/api/v1/admin/**").hasAnyRole("REVIEWER", "ADMIN")

                // ---- everything else needs an account ----
                .anyRequest().authenticated())

            // Order matters. The API key filter runs first so a request
            // carrying a key never reaches the JWT parser, and both run before
            // Spring's own username/password filter, which this application
            // does not use but which is still in the default chain.
            .addFilterBefore(apiKeyFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterAfter(jwtFilter, ApiKeyAuthenticationFilter.class)

            .exceptionHandling(handling -> handling
                    .authenticationEntryPoint(this::unauthenticated)
                    .accessDeniedHandler(this::forbidden))

            // Off. These produce a redirect to an HTML login form, which is the
            // wrong answer for a JSON API: a fetch() following it receives 200
            // and a page of markup instead of a 401 it can act on.
            .httpBasic(basic -> basic.disable())
            .formLogin(form -> form.disable());

        return http.build();
    }

    /**
     * 401 as JSON, in the shape the React apiClient already parses.
     *
     * <p>The client keys its automatic token refresh off this status, so the
     * default HTML error page would turn "your token expired" into an unparseable
     * response and a signed in user would simply see everything break.
     */
    private void unauthenticated(jakarta.servlet.http.HttpServletRequest request,
                                 HttpServletResponse response,
                                 org.springframework.security.core.AuthenticationException e)
            throws java.io.IOException {
        write(response, HttpServletResponse.SC_UNAUTHORIZED, "UNAUTHENTICATED",
                "Sign in to continue.");
    }

    /**
     * 403 when the caller is known but not allowed.
     *
     * <p>Distinct from 401 on purpose: 401 means "who are you", 403 means "not
     * you". The client must not retry a refresh on a 403, because the token is
     * fine and a refresh loop would hammer the server on every forbidden page.
     *
     * <p>Note this is about roles. Ownership of a specific record answers 404
     * instead, per section 7.3, so a practitioner cannot learn that someone
     * else's case id exists by the difference between 403 and 404.
     */
    private void forbidden(jakarta.servlet.http.HttpServletRequest request,
                           HttpServletResponse response,
                           org.springframework.security.access.AccessDeniedException e)
            throws java.io.IOException {
        write(response, HttpServletResponse.SC_FORBIDDEN, "FORBIDDEN",
                "Your account cannot do that.");
    }

    private void write(HttpServletResponse response, int status, String code, String message)
            throws java.io.IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), Map.of(
                "code", code,
                "message", message,
                "timestamp", Instant.now().toString()));
    }
}

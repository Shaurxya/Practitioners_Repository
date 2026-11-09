package com.herbimmortal.verification.publishing;

import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.util.ImmortalId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Narrow first-party account confirmation; not a partner-key product or OIDC provider. */
@Service
public class PublishingLoginService {
    private final JdbcTemplate db;
    private final String clientId;
    private final String redirectUri;
    private final String issuer;
    private final byte[] secretHash;
    private static final SecureRandom RANDOM = new SecureRandom();

    public PublishingLoginService(JdbcTemplate db,
            @Value("${PUBLISHING_CLIENT_ID:publishing-org}") String clientId,
            @Value("${PUBLISHING_REDIRECT_URI:http://localhost:5001/api/auth/immortal/callback}") String redirectUri,
            @Value("${PUBLISHING_ISSUER:http://localhost:8080}") String issuer,
            @Value("${PUBLISHING_CLIENT_SECRET_SHA256:}") String secretHash) {
        this.db = db; this.clientId = clientId; this.redirectUri = redirectUri; this.issuer = issuer;
        this.secretHash = secretHash.matches("[a-fA-F0-9]{64}") ? HexFormat.of().parseHex(secretHash) : new byte[0];
    }
    public record Identity(UUID subject, UUID owner, String immortalId, String email, String name,
                           boolean verified, Instant expiresAt) {}
    private static final String IDENTITY_SQL = """
        select p.id, p.user_id, p.immortal_id, u.email, u.full_name,
          (u.status = 'ACTIVE' and c.status = 'APPROVED'
           and r.present_in_latest_batch and r.status = 'ACTIVE'
           and (select count(*) from verification_cases tie where tie.practitioner_id = p.id and tie.submitted_at = c.submitted_at) = 1
           and r.council_code = p.council_code and r.license_no_normalized = p.license_no_normalized
           and (r.valid_until is null or r.valid_until >= (now() at time zone 'UTC')::date)
           and (select count(*) from registry_records rr where rr.council_code = p.council_code
                and rr.license_no_normalized = p.license_no_normalized and rr.present_in_latest_batch) = 1
          ) as verified,
          ((r.valid_until + 1)::timestamp at time zone 'UTC') as expires_at
        from practitioners p join users u on u.id = p.user_id
        left join lateral (select * from verification_cases vc where vc.practitioner_id = p.id
             order by vc.submitted_at desc, vc.id desc limit 1) c on true
        left join registry_records r on r.id = c.matched_registry_record_id
        where p.id = ?
        """;
    public Identity identity(UUID subject) {
        List<Identity> rows = db.query(IDENTITY_SQL, (rs, n) -> new Identity(
            rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class), rs.getString("immortal_id"),
            rs.getString("email"), rs.getString("full_name"), rs.getBoolean("verified"),
            rs.getTimestamp("expires_at") == null ? null : rs.getTimestamp("expires_at").toInstant()), subject);
        return rows.isEmpty() ? null : rows.getFirst();
    }
    private static ResponseStatusException denied() { return new ResponseStatusException(HttpStatus.FORBIDDEN, "Unable to confirm this practitioner account."); }
    static byte[] hash(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); }
        catch (Exception e) { throw new IllegalStateException("Digest unavailable"); }
    }
    static String challenge(String value) { return Base64.getUrlEncoder().withoutPadding().encodeToString(hash(value)); }
    private static boolean bounded(String value, int max) { return value != null && !value.isBlank() && value.length() <= max; }
    void configured() {
        URI uri = URI.create(redirectUri);
        boolean loopback = List.of("localhost", "127.0.0.1", "::1", "[::1]").contains(uri.getHost());
        if (secretHash.length != 32 || !uri.isAbsolute() || uri.getRawQuery() != null || uri.getFragment() != null
            || uri.getUserInfo() != null || !("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && loopback)))
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Account confirmation is not configured.");
    }
    public void authenticateClient(String presented) {
        configured();
        if (!bounded(presented, 256) || !MessageDigest.isEqual(secretHash, hash(presented)))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Client authentication failed.");
    }
    @Transactional
    public String authorize(UserPrincipal caller, String client, String redirect, String immortalId, String state, String pkce, String method) {
        configured();
        if (caller == null || caller.authenticatedBy() != UserPrincipal.AuthMethod.SESSION) throw denied();
        if (!clientId.equals(client) || !redirectUri.equals(redirect) || !"S256".equals(method)
            || !bounded(state, 200) || !state.matches("[A-Za-z0-9_-]{32,200}")
            || pkce == null || !pkce.matches("[A-Za-z0-9_-]{43}")
            || !bounded(immortalId, 100) || !ImmortalId.isIssuable(immortalId)) throw denied();
        List<UUID> subjects = db.query("select id from practitioners where immortal_id = ? and user_id = ?",
            (rs,n) -> rs.getObject(1, UUID.class), immortalId, caller.id());
        if (subjects.size() != 1) throw denied();
        Identity identity = identity(subjects.getFirst());
        if (identity == null || !identity.verified() || !caller.id().equals(identity.owner())) throw denied();
        byte[] bytes = new byte[32]; RANDOM.nextBytes(bytes);
        String code = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        // Opportunistic bounded-lifetime storage, not a credential/plaintext log.
        db.update("delete from publishing_login_code where expires_at <= now()");
        db.update("insert into publishing_login_code(code_hash,client_id,practitioner_id,pkce_challenge,expires_at) values (?,?,?,?,now() + interval '2 minutes')",
            hash(code), clientId, identity.subject(), pkce);
        db.update("insert into publishing_login_consent(client_id,practitioner_id,owner_user_id) values (?,?,?) on conflict (client_id,practitioner_id) do update set granted_at = now() where publishing_login_consent.owner_user_id = excluded.owner_user_id",
            clientId, identity.subject(), caller.id());
        return redirectUri + "?code=" + code + "&state=" + URLEncoder.encode(state, StandardCharsets.UTF_8);
    }
    @Transactional
    public Map<String, Object> exchange(String secret, String client, String redirect, String code, String verifier) {
        authenticateClient(secret);
        if (!clientId.equals(client) || !redirectUri.equals(redirect) || code == null || !code.matches("[A-Za-z0-9_-]{43}")
            || verifier == null || !verifier.matches("[A-Za-z0-9_-]{43,128}")) throw denied();
        List<UUID> subjects = db.query("delete from publishing_login_code where code_hash = ? and client_id = ? and pkce_challenge = ? and expires_at > now() returning practitioner_id",
            (rs,n) -> rs.getObject(1, UUID.class), hash(code), clientId, challenge(verifier));
        if (subjects.size() != 1) throw denied();
        return statusFor(subjects.getFirst());
    }
    public Map<String, Object> status(String secret, String client, UUID subject) {
        authenticateClient(secret);
        if (!clientId.equals(client) || subject == null) throw denied();
        return statusFor(subject);
    }
    private Map<String, Object> statusFor(UUID subject) {
        Identity identity = identity(subject);
        boolean consent = identity != null && Boolean.TRUE.equals(db.queryForObject(
            "select exists(select 1 from publishing_login_consent where client_id = ? and practitioner_id = ? and owner_user_id = ?)",
            Boolean.class, clientId, subject, identity.owner()));
        Map<String,Object> result = new java.util.LinkedHashMap<>();
        result.put("issuer", issuer); result.put("audience", clientId); result.put("subject", subject.toString());
        result.put("status", consent && identity.verified() ? "VERIFIED" : "NOT_VERIFIED");
        result.put("checkedAt", Instant.now().toString());
        result.put("expiresAt", consent && identity.verified() && identity.expiresAt() != null ? identity.expiresAt().toString() : null);
        if (consent && identity.verified()) {
            result.put("immortalId", identity.immortalId()); result.put("email", identity.email()); result.put("name", identity.name());
        }
        return result;
    }
}

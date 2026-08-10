package com.herbimmortal.verification.security;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;

/**
 * Issues and verifies the access token, and mints the opaque random strings used
 * for refresh tokens and API keys.
 *
 * <h2>Why the access token is a JWT and the refresh token is not</h2>
 *
 * An access token is checked on every single request. Making it a signed JWT
 * means that check is a HMAC over a few hundred bytes with no database round
 * trip, which is the difference between authentication being free and
 * authentication being the slowest thing in the request. The cost is that it
 * cannot be withdrawn before it expires, which is why it expires in minutes.
 *
 * <p>A refresh token is checked once every fifteen minutes per client, has to be
 * revocable, and carries no claims anyone needs to read without the database. So
 * it is 256 random bits, stored as a digest, and looked up. Making it a JWT
 * would buy a stateless check nobody needs and give up the revocation the whole
 * design depends on.
 *
 * <h2>HMAC rather than RSA</h2>
 *
 * One service signs these and the same service verifies them. Asymmetric signing
 * earns its keep when verifiers cannot be trusted with the signing key, which is
 * a second service or a public verifier, and neither exists here. Revisit at the
 * first consumer that has to verify a token without calling us.
 */
@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    /** HS256 needs 256 bits. Anything shorter is refused rather than padded. */
    private static final int MIN_SECRET_BYTES = 32;

    private static final SecureRandom RANDOM = new SecureRandom();

    private final SecretKey key;
    private final AuthProperties properties;

    public JwtService(AuthProperties properties) {
        this.properties = properties;
        this.key = buildKey(properties.secret());
    }

    /**
     * Fails at startup rather than at first sign in.
     *
     * <p>A missing or short signing key is not a configuration warning, it is a
     * system that issues forgeable credentials. Discovering that when the first
     * user signs in, in an environment where it looked like it booted fine, is
     * strictly worse than refusing to start.
     */
    private static SecretKey buildKey(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "app.auth.secret is not set. Generate one with:\n"
                            + "  openssl rand -base64 48\n"
                            + "and put it in .env as AUTH_SECRET. There is no default, "
                            + "because a default signing key is a signing key everyone knows.");
        }

        // Accept base64 or plain text. Someone pasting the output of
        // `openssl rand -base64 48` and someone typing a long passphrase should
        // both work; only the resulting byte length matters.
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(secret);
        } catch (IllegalArgumentException notBase64) {
            bytes = secret.getBytes(StandardCharsets.UTF_8);
        }
        if (bytes.length < MIN_SECRET_BYTES) {
            bytes = secret.getBytes(StandardCharsets.UTF_8);
        }

        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "app.auth.secret is too short: " + bytes.length + " bytes, need at least "
                            + MIN_SECRET_BYTES + ". Generate one with: openssl rand -base64 48");
        }
        return Keys.hmacShaKeyFor(bytes);
    }

    /**
     * A signed access token.
     *
     * <p>Claims are minimal on purpose. A JWT is base64, not encryption: every
     * claim is readable by anyone holding the token, including whatever
     * intercepted it. The subject and role are needed to authorize without a
     * database read, which is the point. Nothing else goes in.
     */
    public String issueAccessToken(User user, Instant now) {
        Instant expiry = now.plus(properties.accessTokenTtl());
        return Jwts.builder()
                .issuer(properties.issuer())
                .subject(user.getId().toString())
                .claim("role", user.getRole().name())
                .claim("email", user.getEmail())
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiry))
                .signWith(key)
                .compact();
    }

    /**
     * Verifies signature, expiry and issuer, and returns the caller.
     *
     * <p>Empty rather than an exception for any failure. At this layer a bad
     * token is the ordinary case, not an error: expired sessions, a stale tab, a
     * probe. Throwing would make the normal path a stack trace and would tempt a
     * caller into distinguishing "expired" from "forged" in a response, which
     * tells an attacker which half of their guess was right.
     */
    public Optional<Authenticated> verify(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(properties.issuer())
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            return Optional.of(new Authenticated(
                    UUID.fromString(claims.getSubject()),
                    Role.valueOf(claims.get("role", String.class)),
                    String.valueOf(claims.get("email"))));

        } catch (JwtException | IllegalArgumentException rejected) {
            // Debug, not warn. An expired token on every stale browser tab is
            // not an operational event, and logging it at warn buries the ones
            // that are.
            log.debug("Rejected access token: {}", rejected.getMessage());
            return Optional.empty();
        }
    }

    /** What a valid access token asserts. Never trusted for account state: see UserPrincipal. */
    public record Authenticated(UUID userId, Role role, String email) {
    }

    public Instant accessTokenExpiry(Instant now) {
        return now.plus(properties.accessTokenTtl());
    }

    /**
     * 256 bits of randomness, URL safe, no padding.
     *
     * <p>Used for refresh tokens and as the body of an API key. Both are
     * compared by digest and never by guesswork, so the only property that
     * matters is that they cannot be predicted.
     */
    public String randomSecret() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}

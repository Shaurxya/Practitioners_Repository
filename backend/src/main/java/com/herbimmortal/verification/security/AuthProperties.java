package com.herbimmortal.verification.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Every knob the authentication system has, in one place, bound from
 * {@code app.auth.*} in application.yml.
 *
 * <p>{@code @ConfigurationProperties} is Spring's typed configuration binding:
 * it maps {@code app.auth.access-token-ttl: 15m} onto {@link #accessTokenTtl}
 * and fails at startup if the value cannot be parsed. The FastAPI equivalent is
 * a pydantic Settings class. Reading these through {@code @Value("${...}")}
 * strings scattered across classes is the thing this replaces: a typo in one of
 * those is a null at runtime rather than a refusal to boot.
 *
 * @param secret            HMAC signing key for access tokens, base64 or plain text,
 *                          at least 32 bytes. No default: a signing key with a
 *                          default is a signing key everyone knows.
 * @param issuer            the {@code iss} claim, so tokens from another deployment
 *                          of this service are rejected rather than accepted
 * @param accessTokenTtl    how long an access token is good for. Short by design:
 *                          it cannot be revoked, so this is the maximum delay
 *                          between locking an account and that taking effect
 * @param refreshTokenTtl   how long a session survives without signing in again
 * @param maxFailedLogins   failures before an account locks
 * @param lockDuration      how long a lock lasts. Temporary on purpose: a
 *                          permanent lock lets anyone who knows an email address
 *                          shut that person out of their own account
 * @param apiKeyCacheTtl    how long a resolved API key stays cached in process.
 *                          Also the maximum delay between revoking a key and the
 *                          revocation biting
 * @param apiKeyUseWindow   how stale {@code last_used_at} may get before it is
 *                          worth a write
 * @param bootstrapAdminEmail    created at startup only when no admin exists at all
 * @param bootstrapAdminPassword ditto, and ignored entirely once one does
 */
@ConfigurationProperties(prefix = "app.auth")
public record AuthProperties(
        String secret,
        String issuer,
        Duration accessTokenTtl,
        Duration refreshTokenTtl,
        int maxFailedLogins,
        Duration lockDuration,
        Duration apiKeyCacheTtl,
        Duration apiKeyUseWindow,
        String bootstrapAdminEmail,
        String bootstrapAdminPassword
) {

    /**
     * Defaults applied here rather than as {@code ${...:15m}} strings in the
     * yaml, so the fallback for each value is visible next to its meaning and
     * cannot differ between two files that both reference it.
     *
     * <p>The signing secret is the one thing with no default. A weak or absent
     * key is checked in {@link JwtService}, at startup, where it stops the
     * application rather than producing forgeable tokens.
     */
    public AuthProperties {
        issuer = issuer == null || issuer.isBlank() ? "herbimmortal-verification" : issuer;
        accessTokenTtl = accessTokenTtl == null ? Duration.ofMinutes(15) : accessTokenTtl;
        refreshTokenTtl = refreshTokenTtl == null ? Duration.ofDays(30) : refreshTokenTtl;
        maxFailedLogins = maxFailedLogins <= 0 ? 8 : maxFailedLogins;
        lockDuration = lockDuration == null ? Duration.ofMinutes(15) : lockDuration;
        apiKeyCacheTtl = apiKeyCacheTtl == null ? Duration.ofSeconds(60) : apiKeyCacheTtl;
        apiKeyUseWindow = apiKeyUseWindow == null ? Duration.ofMinutes(5) : apiKeyUseWindow;
    }
}

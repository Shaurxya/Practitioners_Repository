package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One session, as a revocable server side record.
 *
 * <p>The access token is a JWT and is deliberately not stored anywhere:
 * verifying it is a signature check, which is why it is fast, and the price of
 * that is that it cannot be withdrawn. This row is the other half of the trade.
 * The access token lives fifteen minutes; this lives thirty days and can be
 * killed at any moment, so signing out, locking an account or changing a role
 * takes effect within one short token lifetime rather than at the end of a week.
 *
 * <p>Stored as a SHA-256 digest of an opaque random string. Not a JWT, because
 * a refresh token carries no claims anyone needs to read without the database,
 * and not bcrypt, because the input is 256 bits of randomness rather than a
 * human-chosen password.
 */
@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token_hash", nullable = false, unique = true)
    private String tokenHash;

    /**
     * The rotation chain. Null means this is the live token for its family.
     *
     * <p>Set when this token is exchanged. If a token that already has a
     * successor is presented again, either a client retried after a dropped
     * response or a stolen copy is being used alongside the real one. Nothing
     * can tell those apart from here, so {@code AuthService} assumes the worse
     * and revokes the family.
     */
    @Column(name = "replaced_by")
    private UUID replacedBy;

    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt = Instant.now();

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "ip_address")
    private String ipAddress;

    protected RefreshToken() {
    }

    public RefreshToken(UUID userId, String tokenHash, Instant expiresAt,
                        String userAgent, String ipAddress) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        // Truncated rather than stored whole. A user agent is attacker
        // controlled and unbounded, and this column is read back into an
        // account page: enough to say "a Chrome on Windows", not a place to
        // put arbitrary text of arbitrary length.
        this.userAgent = truncate(userAgent, 255);
        this.ipAddress = truncate(ipAddress, 45);
    }

    public boolean isUsable(Instant now) {
        return revokedAt == null && replacedBy == null && now.isBefore(expiresAt);
    }

    /** Already exchanged. Seeing this presented again is the reuse signal. */
    public boolean isAlreadyRotated() {
        return replacedBy != null;
    }

    public void rotateTo(UUID successorId, Instant now) {
        this.replacedBy = successorId;
        this.revokedAt = now;
    }

    public void revoke(Instant now) {
        if (this.revokedAt == null) {
            this.revokedAt = now;
        }
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return null;
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getTokenHash() { return tokenHash; }
    public Instant getIssuedAt() { return issuedAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public String getUserAgent() { return userAgent; }
    public String getIpAddress() { return ipAddress; }
}

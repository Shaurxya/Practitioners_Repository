package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * A credential for calling the platform without a browser.
 *
 * <p>The key itself is never stored. This row holds a SHA-256 digest and a short
 * non secret prefix, so the full value is returned exactly once, at creation,
 * and is unrecoverable afterwards by us or by anyone who reads this table.
 * "I lost my key" is answered by issuing a new one.
 *
 * <p>The prefix exists because a list of eight rows of asterisks cannot be acted
 * on. Faced with that, the reflex is to store the first few characters of the
 * real key, which is storing part of the key. Generating a separate,
 * deliberately non secret handle removes the temptation.
 */
@Entity
@Table(name = "api_keys")
public class ApiKey {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** What the owner called it. Revoking the right key later is impossible otherwise. */
    @Column(nullable = false)
    private String name;

    @Column(name = "key_prefix", nullable = false)
    private String keyPrefix;

    @Column(name = "key_hash", nullable = false, unique = true)
    private String keyHash;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    protected ApiKey() {
    }

    public ApiKey(UUID userId, String name, String keyPrefix, String keyHash, Instant expiresAt) {
        this.userId = userId;
        this.name = name.trim();
        this.keyPrefix = keyPrefix;
        this.keyHash = keyHash;
        this.expiresAt = expiresAt;
    }

    public boolean isUsable(Instant now) {
        return revokedAt == null && (expiresAt == null || now.isBefore(expiresAt));
    }

    public void revoke(Instant now) {
        if (this.revokedAt == null) {
            this.revokedAt = now;
        }
    }

    /**
     * Whether the last-used stamp is stale enough to be worth a write.
     *
     * <p>Updating it on every call would turn every key authenticated read into
     * a write, and put a row lock on the shared key in the path of every
     * concurrent request using it. The value is used to answer "is this key
     * still in use", which nobody asks to the minute, so it is written at most
     * once per window.
     */
    public boolean shouldRecordUse(Instant now, java.time.Duration window) {
        return lastUsedAt == null || lastUsedAt.plus(window).isBefore(now);
    }

    public void recordUse(Instant now) {
        this.lastUsedAt = now;
    }

    public UUID getId() { return id; }
    public UUID getUserId() { return userId; }
    public String getName() { return name; }
    public String getKeyPrefix() { return keyPrefix; }
    public String getKeyHash() { return keyHash; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
}

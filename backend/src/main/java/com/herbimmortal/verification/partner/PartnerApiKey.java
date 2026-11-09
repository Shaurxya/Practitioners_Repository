package com.herbimmortal.verification.partner;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;

import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static com.herbimmortal.verification.partner.PartnerTypes.*;

/** Persistence model only. Partner responses must use dedicated DTOs. */
@Entity
@Table(name = "partner_api_key")
public class PartnerApiKey {
    @Id @GeneratedValue private UUID id;
    @Column(name = "client_id", nullable = false) private UUID clientId;
    @Column(nullable = false) private String label;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private Environment environment;
    @Column(name = "public_key_id", nullable = false, unique = true) private String publicKeyId;
    @Column(name = "display_prefix", nullable = false) private String displayPrefix;
    @JsonIgnore @Column(name = "secret_hash", nullable = false, unique = true, columnDefinition = "bytea")
    private byte[] secretHash;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private KeyStatus status = KeyStatus.ACTIVE;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "expires_at") private Instant expiresAt;
    @Column(name = "last_used_at") private Instant lastUsedAt;
    @Column(name = "revoked_at") private Instant revokedAt;
    @Column(name = "revoked_by") private UUID revokedBy;
    @Column(name = "rotated_from", unique = true) private UUID rotatedFrom;
    @Version private long version;

    @ElementCollection
    @CollectionTable(name = "partner_api_key_scope", joinColumns = @JoinColumn(name = "key_id"))
    @Column(name = "scope", nullable = false)
    @Convert(converter = PartnerScopeConverter.class)
    private Set<Scope> scopes = new HashSet<>();

    protected PartnerApiKey() { }

    public PartnerApiKey(UUID clientId, String label, Environment environment, String publicKeyId,
                         byte[] secretHash, Set<Scope> scopes, Instant now, Instant expiresAt,
                         UUID rotatedFrom) {
        this.clientId = Objects.requireNonNull(clientId);
        this.label = PartnerValidation.text(label, "key label", 100);
        this.environment = Objects.requireNonNull(environment);
        if (publicKeyId == null || !publicKeyId.matches("[A-Za-z0-9_-]{22}")) {
            throw new IllegalArgumentException("Invalid public key identifier.");
        }
        if (secretHash == null || secretHash.length != 32) {
            throw new IllegalArgumentException("A SHA-256 digest is required.");
        }
        if (scopes == null || scopes.isEmpty()) throw new IllegalArgumentException("A scope is required.");
        this.publicKeyId = publicKeyId;
        this.displayPrefix = "hi_" + environment.name().toLowerCase(java.util.Locale.ROOT) + "_" + publicKeyId;
        this.secretHash = secretHash.clone();
        this.scopes = new HashSet<>(Set.copyOf(scopes));
        this.createdAt = Objects.requireNonNull(now);
        if (expiresAt != null && !expiresAt.isAfter(now)) {
            throw new IllegalArgumentException("Expiry must follow creation.");
        }
        this.expiresAt = expiresAt;
        this.rotatedFrom = rotatedFrom;
    }

    void transition(KeyStatus next, UUID actor, Instant now) {
        if (!status.canTransitionTo(next)) throw new IllegalStateException("Invalid key transition.");
        if (next == KeyStatus.EXPIRED && (expiresAt == null || now.isBefore(expiresAt))) {
            throw new IllegalStateException("Key has not expired.");
        }
        UUID revoker = next == KeyStatus.REVOKED ? Objects.requireNonNull(actor) : null;
        status = next;
        if (next == KeyStatus.REVOKED) {
            revokedAt = now;
            revokedBy = revoker;
        }
    }

    public boolean isUsable(Instant now) {
        return status == KeyStatus.ACTIVE && (expiresAt == null || now.isBefore(expiresAt));
    }

    public UUID getId() { return id; }
    public UUID getClientId() { return clientId; }
    public String getLabel() { return label; }
    public Environment getEnvironment() { return environment; }
    public String getPublicKeyId() { return publicKeyId; }
    public String getDisplayPrefix() { return displayPrefix; }
    @JsonIgnore public byte[] getSecretHash() { return secretHash.clone(); }
    public Set<Scope> getScopes() { return Set.copyOf(scopes); }
    public KeyStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getLastUsedAt() { return lastUsedAt; }
    public Instant getRevokedAt() { return revokedAt; }
    public UUID getRevokedBy() { return revokedBy; }
    public UUID getRotatedFrom() { return rotatedFrom; }
}

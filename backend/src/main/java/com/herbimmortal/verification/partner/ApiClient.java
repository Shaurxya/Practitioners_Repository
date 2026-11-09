package com.herbimmortal.verification.partner;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static com.herbimmortal.verification.partner.PartnerTypes.*;

/** Partner organization, separate from both the account and practitioner identity. */
@Entity
@Table(name = "api_client")
public class ApiClient {
    @Id @GeneratedValue private UUID id;
    @Column(name = "owner_user_id", nullable = false, unique = true) private UUID ownerUserId;
    @Column(nullable = false) private String name;
    @Column(name = "contact_email", nullable = false) private String contactEmail;
    @Column(nullable = false) private String purpose;
    @Column(name = "terms_version", nullable = false) private String termsVersion;
    @Column(name = "terms_accepted_at", nullable = false) private Instant termsAcceptedAt;
    @Enumerated(EnumType.STRING) @Column(nullable = false) private ClientStatus status = ClientStatus.PENDING;
    @Enumerated(EnumType.STRING) @Column(name = "live_access_status", nullable = false)
    private LiveAccessStatus liveAccessStatus = LiveAccessStatus.NOT_REQUESTED;
    @Column(name = "live_decided_by") private UUID liveDecidedBy;
    @Column(name = "live_decided_at") private Instant liveDecidedAt;
    @Column(name = "live_decision_reason") private String liveDecisionReason;
    @Column(name = "test_monthly_quota") private Long testMonthlyQuota;
    @Column(name = "live_monthly_quota") private Long liveMonthlyQuota;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;

    @ElementCollection
    @CollectionTable(name = "api_client_scope", joinColumns = @JoinColumn(name = "client_id"))
    @Column(name = "scope", nullable = false)
    @Convert(converter = PartnerScopeConverter.class)
    private Set<Scope> allowedScopes = new HashSet<>(Set.of(Scope.VERIFY_BASIC));

    protected ApiClient() { }

    public ApiClient(UUID ownerUserId, String name, String contactEmail, String purpose,
                     String termsVersion, Instant acceptedAt) {
        this.ownerUserId = Objects.requireNonNull(ownerUserId);
        this.name = PartnerValidation.text(name, "organization name", 200);
        this.contactEmail = PartnerValidation.text(contactEmail, "contact email", 320);
        if (!this.contactEmail.matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")) {
            throw new IllegalArgumentException("Invalid contact email.");
        }
        this.purpose = PartnerValidation.text(purpose, "purpose", 2000);
        this.termsVersion = PartnerValidation.text(termsVersion, "terms version", 100);
        this.termsAcceptedAt = Objects.requireNonNull(acceptedAt);
        this.createdAt = acceptedAt;
        this.updatedAt = acceptedAt;
    }

    // Package-private: all changes go through the transactional lifecycle service.
    void transition(ClientStatus next, Instant now) {
        if (!status.canTransitionTo(next)) throw new IllegalStateException("Invalid client transition.");
        status = next;
        updatedAt = now;
    }

    void transitionLiveAccess(LiveAccessStatus next, UUID actor, String reason, Instant now) {
        if (status != ClientStatus.ACTIVE || !liveAccessStatus.canTransitionTo(next)) {
            throw new IllegalStateException("Invalid live access transition.");
        }
        boolean decision = next == LiveAccessStatus.APPROVED || next == LiveAccessStatus.REJECTED;
        String checkedReason = decision ? PartnerValidation.text(reason, "decision reason", 2000) : null;
        liveAccessStatus = next;
        liveDecidedBy = decision ? Objects.requireNonNull(actor) : null;
        liveDecidedAt = decision ? now : null;
        liveDecisionReason = checkedReason;
        updatedAt = now;
    }

    public boolean permits(Environment environment) {
        return status == ClientStatus.ACTIVE
                && (environment == Environment.TEST ||
                    environment == Environment.LIVE && liveAccessStatus == LiveAccessStatus.APPROVED);
    }

    public UUID getId() { return id; }
    public UUID getOwnerUserId() { return ownerUserId; }
    public String getName() { return name; }
    public String getContactEmail() { return contactEmail; }
    public String getPurpose() { return purpose; }
    public String getTermsVersion() { return termsVersion; }
    public Instant getTermsAcceptedAt() { return termsAcceptedAt; }
    public ClientStatus getStatus() { return status; }
    public LiveAccessStatus getLiveAccessStatus() { return liveAccessStatus; }
    public UUID getLiveDecidedBy() { return liveDecidedBy; }
    public Instant getLiveDecidedAt() { return liveDecidedAt; }
    public String getLiveDecisionReason() { return liveDecisionReason; }
    public Long getTestMonthlyQuota() { return testMonthlyQuota; }
    public Long getLiveMonthlyQuota() { return liveMonthlyQuota; }
    public Set<Scope> getAllowedScopes() { return Set.copyOf(allowedScopes); }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

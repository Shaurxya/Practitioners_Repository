package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One attempt to verify one practitioner. Immutable once terminal.
 */
@Entity
@Table(name = "verification_cases")
public class VerificationCase {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "practitioner_id", nullable = false)
    private UUID practitionerId;

    /**
     * The account that submitted this claim, and the subject of every ownership
     * check on it.
     *
     * <p>Held here rather than reached through the practitioner, which is a
     * denormalization worth defending. Ownership is checked on every read of
     * every case, so going through practitioners puts a join on the hottest
     * authorization path in the system. Worse, it makes ownership mutable: if a
     * practitioner record were ever relinked to a different account, every past
     * case would silently change hands, including ones decided before that
     * account existed.
     *
     * <p>Who submitted a claim is a fact about the moment of submission, like
     * the claimed fields beside it. Null for the cases that predate accounts.
     */
    @Column(name = "submitted_by_user_id")
    private UUID submittedByUserId;

    @Column(nullable = false)
    private String status;

    @Column(name = "claimed_full_name", nullable = false)
    private String claimedFullName;

    @Column(name = "claimed_registration_number", nullable = false)
    private String claimedRegistrationNumber;

    @Column(name = "claimed_council", nullable = false)
    private String claimedCouncil;

    @Column(name = "claimed_specialty")
    private String claimedSpecialty;

    /**
     * What the practitioner selected, kept on the case as well as resolved onto
     * the practitioner.
     *
     * Same reason 3.1 gives for the licence number living here: a corrected
     * claim after a rejection has to leave the original readable. Someone who
     * picks Unani, is rejected, and resubmits as Ayurveda leaves a first case
     * that still says Unani, or the rejection cannot be explained afterwards.
     *
     * Nullable, because every case submitted before V9 was never asked.
     */
    @Column(name = "claimed_country")
    private String claimedCountry;

    @Column(name = "claimed_medical_system")
    private String claimedMedicalSystem;

    @Column(name = "matched_registry_record_id")
    private UUID matchedRegistryRecordId;

    @Column(name = "match_confidence")
    private BigDecimal matchConfidence;

    @Column(name = "candidate_count", nullable = false)
    private int candidateCount;

    @Column(name = "submitted_at", nullable = false)
    private Instant submittedAt = Instant.now();

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decided_by")
    private String decidedBy;

    @Column(name = "decision_reason")
    private String decisionReason;

    protected VerificationCase() {
    }

    public VerificationCase(UUID practitionerId, UUID submittedByUserId, String fullName,
                            String registrationNumber, String council, String specialty,
                            String country, String medicalSystem) {
        this.practitionerId = practitionerId;
        this.submittedByUserId = submittedByUserId;
        this.claimedFullName = fullName;
        this.claimedRegistrationNumber = registrationNumber;
        this.claimedCouncil = council;
        this.claimedSpecialty = specialty;
        this.claimedCountry = country;
        this.claimedMedicalSystem = medicalSystem;
        this.status = "SUBMITTED";
    }

    public void recordMatch(UUID registryRecordId, Double confidence, int candidates) {
        this.matchedRegistryRecordId = registryRecordId;
        this.matchConfidence = confidence == null ? null : BigDecimal.valueOf(confidence);
        this.candidateCount = candidates;
    }

    /** Terminal decisions carry who and why. A decision without a reason is an outcome. */
    public void decide(String status, String by, String reason) {
        this.status = status;
        this.decidedBy = by;
        this.decisionReason = reason;
        if (isTerminal(status)) {
            this.decidedAt = Instant.now();
        }
    }

    public void setStatus(String status) {
        this.status = status;
    }

    private static boolean isTerminal(String status) {
        return switch (status) {
            case "APPROVED", "REJECTED", "EXPIRED", "REVOKED" -> true;
            default -> false;
        };
    }

    public UUID getId() { return id; }
    public UUID getPractitionerId() { return practitionerId; }
    public UUID getSubmittedByUserId() { return submittedByUserId; }

    /**
     * Whether this case belongs to the given account.
     *
     * <p>A case with no submitter belongs to nobody, and that is the honest
     * answer for the rows created before accounts existed. Treating null as
     * "belongs to whoever is asking" would hand every pre-accounts claim to the
     * next person who signed up.
     */
    public boolean isOwnedBy(UUID userId) {
        return submittedByUserId != null && submittedByUserId.equals(userId);
    }
    public String getStatus() { return status; }
    public String getClaimedFullName() { return claimedFullName; }
    public String getClaimedRegistrationNumber() { return claimedRegistrationNumber; }
    public String getClaimedCouncil() { return claimedCouncil; }
    public String getClaimedSpecialty() { return claimedSpecialty; }
    public String getClaimedCountry() { return claimedCountry; }
    public String getClaimedMedicalSystem() { return claimedMedicalSystem; }
    public UUID getMatchedRegistryRecordId() { return matchedRegistryRecordId; }
    public BigDecimal getMatchConfidence() { return matchConfidence; }
    public int getCandidateCount() { return candidateCount; }
    public Instant getSubmittedAt() { return submittedAt; }
    public Instant getDecidedAt() { return decidedAt; }
    public String getDecidedBy() { return decidedBy; }
    public String getDecisionReason() { return decisionReason; }
}

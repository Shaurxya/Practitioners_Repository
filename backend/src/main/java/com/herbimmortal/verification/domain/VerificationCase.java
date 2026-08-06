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

    public VerificationCase(UUID practitionerId, String fullName, String registrationNumber,
                            String council, String specialty) {
        this.practitionerId = practitionerId;
        this.claimedFullName = fullName;
        this.claimedRegistrationNumber = registrationNumber;
        this.claimedCouncil = council;
        this.claimedSpecialty = specialty;
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
    public String getStatus() { return status; }
    public String getClaimedFullName() { return claimedFullName; }
    public String getClaimedRegistrationNumber() { return claimedRegistrationNumber; }
    public String getClaimedCouncil() { return claimedCouncil; }
    public String getClaimedSpecialty() { return claimedSpecialty; }
    public UUID getMatchedRegistryRecordId() { return matchedRegistryRecordId; }
    public BigDecimal getMatchConfidence() { return matchConfidence; }
    public int getCandidateCount() { return candidateCount; }
    public Instant getSubmittedAt() { return submittedAt; }
    public Instant getDecidedAt() { return decidedAt; }
    public String getDecidedBy() { return decidedBy; }
    public String getDecisionReason() { return decisionReason; }
}

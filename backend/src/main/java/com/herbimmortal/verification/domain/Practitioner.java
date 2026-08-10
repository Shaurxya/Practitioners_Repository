package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * The person a claim is about, keyed on the registration rather than an account.
 *
 * There is no signup yet, and the identity that matters is the registration:
 * two claims for the same council and licence are the same practitioner even if
 * they arrive from different sessions.
 *
 * immortal_id is null until the first approval, and every read path has to
 * handle that. It lives here rather than on the case because a case is one
 * attempt and terminal, while the identifier is permanent: an expiry followed
 * by a re-approval must return the same one.
 */
@Entity
@Table(name = "practitioners")
public class Practitioner {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "council_code", nullable = false)
    private String councilCode;

    @Column(name = "license_no_normalized", nullable = false)
    private String licenseNoNormalized;

    @Column(name = "full_name_raw", nullable = false)
    private String fullNameRaw;

    /**
     * The two facts the Immortal ID bakes in permanently, stored next to the
     * identifier they produced.
     *
     * Not derived at read time. If a practitioner later corrects their medical
     * system, HI-26INA-... still has to decode back to Ayurveda, because that is
     * what was true when it was issued and the ID does not change. Deriving from
     * the council or the latest case would quietly make the ID and its own
     * meaning disagree.
     */
    @Column(name = "country_code", nullable = false)
    private String countryCode;

    @Column(name = "medical_system_code", nullable = false)
    private String medicalSystemCode;

    @Column(name = "immortal_id", unique = true)
    private String immortalId;

    /**
     * When the identifier was issued, which is what its YY segment records.
     * Deliberately not created_at: a practitioner created in December and
     * approved in January belongs to the later year.
     */
    @Column(name = "immortal_id_issued_at")
    private Instant immortalIdIssuedAt;

    /**
     * The account that claimed this registration, or null.
     *
     * <p>Null is a real and permanent answer, not a gap to be filled: a
     * registration exists on a council register whether or not anyone ever
     * signs up for it, and every practitioner row created before accounts
     * existed has no honest owner. Guessing one would attach a stranger's
     * verified identity to somebody's login.
     */
    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected Practitioner() {
    }

    public Practitioner(String councilCode, String licenseNoNormalized, String fullNameRaw,
                        String countryCode, String medicalSystemCode, UUID userId) {
        this.councilCode = councilCode;
        this.licenseNoNormalized = licenseNoNormalized;
        this.fullNameRaw = fullNameRaw;
        this.countryCode = countryCode;
        this.medicalSystemCode = medicalSystemCode;
        this.userId = userId;
    }

    /**
     * Attaches an account to a registration that had none.
     *
     * <p>First claim wins, and a second account claiming the same registration
     * is refused rather than allowed to take it over. Two people claiming one
     * licence is either a mistake or an impersonation attempt, and silently
     * moving a verified identity to the newer account is the wrong answer to
     * both. A reviewer resolves it.
     */
    public void claimBy(UUID candidateUserId) {
        if (this.userId == null) {
            this.userId = candidateUserId;
            this.updatedAt = Instant.now();
        } else if (!this.userId.equals(candidateUserId)) {
            throw new RegistrationAlreadyClaimedException();
        }
    }

    /** Distinct type so the controller can answer 409 rather than a generic 400. */
    public static class RegistrationAlreadyClaimedException extends RuntimeException {
        public RegistrationAlreadyClaimedException() {
            super("That registration has already been claimed by another account. "
                    + "If it is yours, contact support.");
        }
    }

    /**
     * Issued once, on the first approval. Calling this again is a no-op rather
     * than an error, because re-approval after an expiry is a normal event and
     * must return the identifier the practitioner already has.
     *
     * The issue timestamp is set in the same call for a reason V9 enforces with
     * a CHECK: an ID whose YY segment nothing can corroborate is worse than no
     * ID, because it reads as a fact.
     */
    public void issueImmortalId(String candidate) {
        if (this.immortalId == null) {
            this.immortalId = candidate;
            this.immortalIdIssuedAt = Instant.now();
            this.updatedAt = Instant.now();
        }
    }

    public UUID getId() { return id; }
    public String getCouncilCode() { return councilCode; }
    public String getLicenseNoNormalized() { return licenseNoNormalized; }
    public String getFullNameRaw() { return fullNameRaw; }
    public String getCountryCode() { return countryCode; }
    public String getMedicalSystemCode() { return medicalSystemCode; }
    public String getImmortalId() { return immortalId; }
    public Instant getImmortalIdIssuedAt() { return immortalIdIssuedAt; }
    public UUID getUserId() { return userId; }
}

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

    @Column(name = "immortal_id", unique = true)
    private String immortalId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected Practitioner() {
    }

    public Practitioner(String councilCode, String licenseNoNormalized, String fullNameRaw) {
        this.councilCode = councilCode;
        this.licenseNoNormalized = licenseNoNormalized;
        this.fullNameRaw = fullNameRaw;
    }

    /**
     * Issued once, on the first approval. Calling this again is a no-op rather
     * than an error, because re-approval after an expiry is a normal event and
     * must return the identifier the practitioner already has.
     */
    public void issueImmortalId(String candidate) {
        if (this.immortalId == null) {
            this.immortalId = candidate;
            this.updatedAt = Instant.now();
        }
    }

    public UUID getId() { return id; }
    public String getCouncilCode() { return councilCode; }
    public String getLicenseNoNormalized() { return licenseNoNormalized; }
    public String getFullNameRaw() { return fullNameRaw; }
    public String getImmortalId() { return immortalId; }
}

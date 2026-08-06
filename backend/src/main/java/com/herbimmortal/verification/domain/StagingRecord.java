package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One extracted row, waiting for a human.
 *
 * Maps registry_staging_record. Extracted data is never live data until someone
 * says so, which is the whole reason a staging table exists: nothing here has
 * touched registry_records.
 *
 * The JSONB columns (cell_confidence, confirmation_codes) are deliberately not
 * mapped. They carry database defaults, nothing in this phase reads them, and
 * mapping JSONB pulls in a type contributor for no gain. Flyway keeps owning
 * them until something actually needs them.
 */
@Entity
@Table(name = "registry_staging_record")
public class StagingRecord {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "import_batch_id", nullable = false)
    private UUID importBatchId;

    @Column(name = "source_page", nullable = false)
    private int sourcePage;

    @Column(name = "source_row_index", nullable = false)
    private int sourceRowIndex;

    /**
     * The row exactly as extracted, before column splitting. When a reviewer
     * disagrees with a parsed field this is what they read, and it is the only
     * way to tell a bad OCR from a bad column mapping.
     */
    @Column(name = "raw_row_text", nullable = false)
    private String rawRowText;

    @Column(name = "license_no_raw")
    private String licenseNoRaw;

    @Column(name = "full_name_raw")
    private String fullNameRaw;

    @Column(name = "council_raw")
    private String councilRaw;

    @Column(name = "status_raw")
    private String statusRaw;

    @Column(name = "specialty_raw")
    private String specialtyRaw;

    @Column(name = "qualification_raw")
    private String qualificationRaw;

    @Column(name = "registration_date_raw")
    private String registrationDateRaw;

    @Column(name = "valid_until_raw")
    private String validUntilRaw;

    @Column(name = "row_confidence", nullable = false)
    private java.math.BigDecimal rowConfidence = java.math.BigDecimal.ONE;

    /** Broken out because it alone gates promotion. */
    @Column(name = "license_confidence")
    private java.math.BigDecimal licenseConfidence;

    @Column(name = "needs_confirmation", nullable = false)
    private boolean needsConfirmation;

    @Column(name = "confirmed_at")
    private Instant confirmedAt;

    @Column(name = "promoted_at")
    private Instant promotedAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected StagingRecord() {
    }

    public StagingRecord(UUID importBatchId, int sourcePage, int sourceRowIndex, String rawRowText) {
        this.importBatchId = importBatchId;
        this.sourcePage = sourcePage;
        this.sourceRowIndex = sourceRowIndex;
        this.rawRowText = rawRowText;
    }

    /**
     * Fills a raw cell by canonical field name.
     *
     * A switch rather than reflection: the set of canonical fields is fixed and
     * small, and an unknown name here should be a compile time impossibility
     * rather than a runtime surprise on row 40,000.
     */
    public void setCell(String field, String value) {
        switch (field) {
            case "licenseNo" -> this.licenseNoRaw = value;
            case "fullName" -> this.fullNameRaw = value;
            case "council" -> this.councilRaw = value;
            case "status" -> this.statusRaw = value;
            case "specialty" -> this.specialtyRaw = value;
            case "qualification" -> this.qualificationRaw = value;
            case "registrationDate" -> this.registrationDateRaw = value;
            case "validUntil" -> this.validUntilRaw = value;
            default -> { /* a column mapped to a field this phase does not store */ }
        }
    }

    public void scoreConfidence(double rowConfidence, Double licenseConfidence, double minLicence) {
        this.rowConfidence = java.math.BigDecimal.valueOf(rowConfidence);
        this.licenseConfidence = licenseConfidence == null
                ? null : java.math.BigDecimal.valueOf(licenseConfidence);
        // Held when the parser was unsure about the licence number, or when
        // there is no licence number at all. Everything else can be corrected
        // later; a wrong licence invents a practitioner and erases another.
        this.needsConfirmation = licenseConfidence == null || licenseConfidence < minLicence
                || this.licenseNoRaw == null;
    }

    public UUID getId() { return id; }
    public UUID getImportBatchId() { return importBatchId; }
    public int getSourcePage() { return sourcePage; }
    public int getSourceRowIndex() { return sourceRowIndex; }
    public String getRawRowText() { return rawRowText; }
    public String getLicenseNoRaw() { return licenseNoRaw; }
    public String getFullNameRaw() { return fullNameRaw; }
    public String getCouncilRaw() { return councilRaw; }
    public String getStatusRaw() { return statusRaw; }
    public String getSpecialtyRaw() { return specialtyRaw; }
    public String getQualificationRaw() { return qualificationRaw; }
    public String getRegistrationDateRaw() { return registrationDateRaw; }
    public String getValidUntilRaw() { return validUntilRaw; }
    public java.math.BigDecimal getRowConfidence() { return rowConfidence; }
    public java.math.BigDecimal getLicenseConfidence() { return licenseConfidence; }
    public boolean isNeedsConfirmation() { return needsConfirmation; }
    public Instant getConfirmedAt() { return confirmedAt; }
    public Instant getPromotedAt() { return promotedAt; }
}

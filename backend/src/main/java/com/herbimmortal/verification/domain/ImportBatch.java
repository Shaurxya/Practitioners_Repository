package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One uploaded register PDF and its lifecycle.
 *
 * Maps the import_batch table from V3, extended by V7. Hibernate runs with
 * ddl-auto: validate, so if a field here disagrees with the column it names the
 * application refuses to start. That is the point: Flyway owns the schema and
 * this class is checked against it, rather than the other way round.
 *
 * Only the columns this phase reads are mapped. Validation checks that mapped
 * columns exist, not that every column is mapped, so the rest stay under
 * Flyway's control until something needs them.
 */
@Entity
@Table(name = "import_batch")
public class ImportBatch {

    @Id
    @GeneratedValue
    private UUID id;

    /** Becomes registry_records.source_batch, which the public endpoint prints. */
    @Column(nullable = false)
    private String label;

    @Column(name = "council_code")
    private String councilCode;

    @Column(nullable = false)
    private String status;

    @Column(name = "source_object_key", nullable = false)
    private String sourceObjectKey;

    @Column(name = "source_filename", nullable = false)
    private String sourceFilename;

    /** Identity comes from content, not name: uploading the same PDF twice is a mistake. */
    @Column(name = "source_sha256", nullable = false)
    private String sourceSha256;

    @Column(name = "source_bytes", nullable = false)
    private long sourceBytes;

    @Column(name = "page_count")
    private Integer pageCount;

    @Column(name = "text_layer_pages")
    private Integer textLayerPages;

    @Column(name = "scanned_pages")
    private Integer scannedPages;

    @Column(name = "unreadable_pages")
    private Integer unreadablePages;

    @Column(name = "pages_done", nullable = false)
    private int pagesDone;

    @Column(name = "rows_extracted", nullable = false)
    private int rowsExtracted;

    @Column(name = "rows_rejected", nullable = false)
    private int rowsRejected;

    @Column(name = "rows_promoted", nullable = false)
    private int rowsPromoted;

    @Column(name = "declared_row_count")
    private Integer declaredRowCount;

    @Column(name = "failure_code")
    private String failureCode;

    @Column(name = "failure_detail")
    private String failureDetail;

    @Column(name = "uploaded_by", nullable = false)
    private String uploadedBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected ImportBatch() {
        // Hibernate needs a no-arg constructor. Not for application use.
    }

    public ImportBatch(String label, String councilCode, String sourceObjectKey,
                       String sourceFilename, String sourceSha256, long sourceBytes,
                       String uploadedBy) {
        this.label = label;
        this.councilCode = councilCode;
        this.sourceObjectKey = sourceObjectKey;
        this.sourceFilename = sourceFilename;
        this.sourceSha256 = sourceSha256;
        this.sourceBytes = sourceBytes;
        this.uploadedBy = uploadedBy;
        this.status = "UPLOADED";
    }

    public void recordClassification(int pageCount, int textLayer, int scanned, int unreadable) {
        // A successful run clears the previous failure. Leaving it set means a
        // batch that has just classified cleanly still reports NO_READABLE_PAGES,
        // and the console shows a failure screen over working data.
        clearFailure();
        this.pageCount = pageCount;
        this.textLayerPages = textLayer;
        this.scannedPages = scanned;
        this.unreadablePages = unreadable;
        this.status = "AWAITING_CLASSIFY_OK";
        this.updatedAt = Instant.now();
    }

    public void recordExtraction(int rowsExtracted, int rowsRejected, Integer declaredRowCount) {
        clearFailure();
        this.rowsExtracted = rowsExtracted;
        this.rowsRejected = rowsRejected;
        this.declaredRowCount = declaredRowCount;
        this.pagesDone = this.pageCount == null ? 0 : this.pageCount;
        this.status = "AWAITING_PROMOTE_OK";
        this.updatedAt = Instant.now();
    }

    private void clearFailure() {
        this.failureCode = null;
        this.failureDetail = null;
    }

    /** Records why a run stopped, so the console shows an action rather than a 500. */
    public void fail(String failureCode, String detail, String status) {
        this.failureCode = failureCode;
        this.failureDetail = detail;
        this.status = status;
        this.updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getLabel() { return label; }
    public String getCouncilCode() { return councilCode; }
    public String getStatus() { return status; }
    public String getSourceObjectKey() { return sourceObjectKey; }
    public String getSourceFilename() { return sourceFilename; }
    public String getSourceSha256() { return sourceSha256; }
    public long getSourceBytes() { return sourceBytes; }
    public Integer getPageCount() { return pageCount; }
    public Integer getTextLayerPages() { return textLayerPages; }
    public Integer getScannedPages() { return scannedPages; }
    public Integer getUnreadablePages() { return unreadablePages; }
    public int getPagesDone() { return pagesDone; }
    public int getRowsExtracted() { return rowsExtracted; }
    public int getRowsRejected() { return rowsRejected; }
    public int getRowsPromoted() { return rowsPromoted; }
    public Integer getDeclaredRowCount() { return declaredRowCount; }
    public String getFailureCode() { return failureCode; }
    public String getFailureDetail() { return failureDetail; }
    public String getUploadedBy() { return uploadedBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}

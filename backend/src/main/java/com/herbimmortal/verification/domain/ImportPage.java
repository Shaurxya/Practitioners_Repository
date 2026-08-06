package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Per page telemetry. Maps import_page.
 *
 * This table is what makes page level confidence computable at all. Without it
 * there is no way to ask "which pages yielded fewer rows than this document's
 * own average", and that question is the one that catches the last fifty pages
 * failing silently while every row that did extract looks perfect.
 */
@Entity
@Table(name = "import_page")
public class ImportPage {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "import_batch_id", nullable = false)
    private UUID importBatchId;

    @Column(name = "page_number", nullable = false)
    private int pageNumber;

    @Column(nullable = false)
    private String classification;

    @Column(name = "char_count")
    private Integer charCount;

    @Column(name = "rotation_degrees", nullable = false)
    private int rotationDegrees;

    @Column(name = "table_mode_used")
    private String tableModeUsed;

    @Column(name = "rows_extracted", nullable = false)
    private int rowsExtracted;

    @Column(name = "mean_ocr_confidence")
    private BigDecimal meanOcrConfidence;

    @Column(name = "page_confidence")
    private BigDecimal pageConfidence;

    @Column(name = "anomaly_code")
    private String anomalyCode;

    protected ImportPage() {
    }

    public ImportPage(UUID importBatchId, int pageNumber, String classification, Integer charCount,
                      int rotationDegrees, String tableModeUsed, int rowsExtracted,
                      Double meanOcrConfidence, String anomalyCode) {
        this.importBatchId = importBatchId;
        this.pageNumber = pageNumber;
        this.classification = classification;
        this.charCount = charCount;
        this.rotationDegrees = rotationDegrees;
        this.tableModeUsed = tableModeUsed;
        this.rowsExtracted = rowsExtracted;
        this.meanOcrConfidence = meanOcrConfidence == null ? null : BigDecimal.valueOf(meanOcrConfidence);
        this.anomalyCode = anomalyCode;
    }

    /** Rows on this page against the document's own average, never an absolute. */
    public void scoreAgainst(double meanRowsPerPage) {
        this.pageConfidence = meanRowsPerPage <= 0 ? BigDecimal.ONE
                : BigDecimal.valueOf(Math.min(1.0, rowsExtracted / meanRowsPerPage))
                        .setScale(3, java.math.RoundingMode.HALF_UP);
    }

    public int getPageNumber() { return pageNumber; }
    public String getClassification() { return classification; }
    public Integer getCharCount() { return charCount; }
    public int getRotationDegrees() { return rotationDegrees; }
    public String getTableModeUsed() { return tableModeUsed; }
    public int getRowsExtracted() { return rowsExtracted; }
    public BigDecimal getMeanOcrConfidence() { return meanOcrConfidence; }
    public BigDecimal getPageConfidence() { return pageConfidence; }
    public String getAnomalyCode() { return anomalyCode; }
}

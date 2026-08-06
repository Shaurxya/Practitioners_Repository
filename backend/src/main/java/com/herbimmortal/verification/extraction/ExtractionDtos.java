package com.herbimmortal.verification.extraction;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * The wire contract with the Python sidecar, mirroring extraction/app/schema.py.
 *
 * Records rather than classes: these are immutable data with no behaviour, and
 * Java 21 records give equals, hashCode and a constructor for free. Jackson
 * binds JSON straight onto them.
 *
 * Note what Spring SENDS: the column map, the table mode, the density
 * threshold. The sidecar holds no council, no licence regex, no status
 * vocabulary. Everything domain specific travels with the request, which is
 * what stops two copies of that knowledge drifting apart.
 */
public final class ExtractionDtos {

    private ExtractionDtos() {
    }

    /**
     * Nulls are omitted rather than sent.
     *
     * An absent optional means "use your default" and a null means "the value is
     * null", and pydantic is right to reject the second for a field that has a
     * default. Sending null for every unset option made the sidecar refuse every
     * request with a 422 naming a field the caller had not set on purpose.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ClassifyRequest(String batchId, String sourcePath, Double textDensityThreshold) {
    }

    public record PageReport(
            int pageNumber,
            String classification,
            Integer charCount,
            int rotationDegrees,
            String tableModeUsed,
            int rowsExtracted,
            Double meanOcrConfidence,
            String anomalyCode) {
    }

    public record ClassifyResponse(
            String batchId,
            int pageCount,
            int textLayerPages,
            int scannedPages,
            int unreadablePages,
            int rotatedPages,
            List<PageReport> pages) {
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExtractRequest(
            String batchId,
            String sourcePath,
            String tableMode,
            Map<Integer, String> columnMap,
            Double textDensityThreshold,
            List<Integer> pages) {
    }

    /** Confidence is null when the column was not mapped, never zero. */
    public record Cell(String raw, Double confidence) {
    }

    public record Row(
            int sourcePage,
            int sourceRowIndex,
            String rawRowText,
            Map<String, Cell> cells,
            double rowConfidence,
            Double licenseConfidence) {
    }

    public record Reject(int sourcePage, String reasonCode, String reasonDetail) {
    }

    public record ExtractResponse(
            String batchId,
            int pageCount,
            List<PageReport> pages,
            List<Row> rows,
            List<Reject> rejects,
            Integer declaredRowCount) {
    }

    public record DetectedColumn(
            int index,
            String headerText,
            List<String> sampleValues,
            String proposedField,
            double proposalConfidence) {
    }

    public record DetectResponse(
            int pageNumber,
            String tableModeUsed,
            List<DetectedColumn> detectedColumns) {
    }

    /** Health tells us whether OCR can actually run, not just whether it is up. */
    public record Health(String status, String ocr, String textLayer) {
    }
}

package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.ImportBatch;
import com.herbimmortal.verification.extraction.ExtractionClient;
import com.herbimmortal.verification.extraction.ExtractionDtos.ExtractResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.DetectResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.Health;
import com.herbimmortal.verification.domain.StagingRecord;
import org.springframework.data.domain.PageRequest;
import com.herbimmortal.verification.service.ImportService;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The registry import API.
 *
 * {@code @Profile("!prod")} is load bearing, not decoration. These endpoints
 * expose the promote path and there is no authentication until phase 8, so a
 * production build must be physically unable to serve them. The build order
 * puts admin endpoints two phases before Spring Security on purpose, and this
 * annotation is the thing that makes that acceptable.
 *
 * Negated rather than {@code @Profile("!prod")}, which was wrong in a way that
 * looked right: the default profile is "local", so the controller was never
 * created unless someone remembered to add "dev" by hand, and the console got a
 * 404 on every endpoint with the backend apparently running and healthy. A
 * guard that has to be remembered to be switched ON is a guard that is off.
 * Absent unless prod is active fails in the safe direction and works by
 * default.
 *
 * The controller validates, maps and returns status codes. Nothing else.
 */
@RestController
@RequestMapping("/api/v1/admin/imports")
@Profile("!prod")
public class ImportController {

    private final ImportService imports;
    private final ExtractionClient extraction;

    public ImportController(ImportService imports, ExtractionClient extraction) {
        this.imports = imports;
        this.extraction = extraction;
    }

    /** Whether the sidecar is up and whether OCR can actually run. */
    @GetMapping("/extractor-health")
    public Health extractorHealth() {
        return extraction.health();
    }

    /**
     * A Page, not a bare list.
     *
     * The console pages every table server side, and a plain array would work
     * until the first register with more batches than fit on a screen. Matching
     * the shape now costs nothing and means the client needs no branch.
     */
    @GetMapping
    public PageView<BatchView> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        List<BatchView> all = imports.all().stream()
                .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                .map(this::view)
                .toList();
        int from = Math.min(page * size, all.size());
        int to = Math.min(from + size, all.size());
        return new PageView<>(all.subList(from, to), all.size(),
                Math.max(1, (int) Math.ceil(all.size() / (double) size)), page, size);
    }

    public record PageView<T>(List<T> content, long totalElements, int totalPages, int number, int size) {
    }

    @GetMapping("/{batchId}")
    public BatchView get(@PathVariable UUID batchId) {
        return view(imports.require(batchId));
    }

    /** Adds the counts that come from the staging table rather than the batch row. */
    private BatchView view(ImportBatch b) {
        long needsConfirmation = b.getRowsExtracted() == 0 ? 0 : imports.needsConfirmationCount(b.getId());
        return BatchView.of(b, needsConfirmation);
    }

    /**
     * 201 with the batch, not 200: a resource was created and the caller needs
     * its id to drive everything that follows. Uploading does not start
     * extraction, only classification does, and only when asked.
     */
    @PostMapping
    public ResponseEntity<BatchView> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam("label") String label,
            @RequestParam("councilCode") String councilCode) {

        ImportBatch batch = imports.upload(file, label, councilCode, "dev");
        return ResponseEntity.status(HttpStatus.CREATED).body(view(batch));
    }

    @PostMapping("/{batchId}/classify")
    public BatchView classify(@PathVariable UUID batchId) {
        return view(imports.classify(batchId));
    }

    @PostMapping("/{batchId}/extract")
    public ExtractResponse extract(@PathVariable UUID batchId, @RequestBody ExtractCommand body) {
        return imports.extract(batchId, body.columnMap(), body.tableMode());
    }

    public record ExtractCommand(Map<Integer, String> columnMap, String tableMode) {
    }

    /**
     * The columns this document actually has, read from the document.
     *
     * A proposal, never a decision. A mismapped column is the worst failure this
     * pipeline has because it does not look like one: every row parses, every
     * confidence is high, and the wrong column silently becomes the licence
     * number for the whole register.
     */
    @GetMapping("/{batchId}/detected-columns")
    public DetectResponse detectedColumns(@PathVariable UUID batchId) {
        return imports.detectColumns(batchId);
    }

    /**
     * Per page telemetry: which pages were text, which were scanned, and which
     * yielded fewer rows than this document's own average.
     */
    @GetMapping("/{batchId}/pages")
    public List<ImportPageView> pages(@PathVariable UUID batchId) {
        return imports.pageRows(batchId).stream()
                .map(p -> new ImportPageView(p.getPageNumber(), p.getClassification(), p.getCharCount(),
                        p.getRotationDegrees(), p.getTableModeUsed(), p.getRowsExtracted(),
                        toDouble(p.getMeanOcrConfidence()),
                        toDouble(p.getPageConfidence()),
                        p.getAnomalyCode()))
                .toList();
    }

    /**
     * A ternary with a null branch and a primitive branch unboxes the null, so
     * "cond ? null : x.doubleValue()" throws on exactly the rows that have no
     * value. A method keeps both branches boxed.
     */
    private static Double toDouble(java.math.BigDecimal value) {
        return value == null ? null : value.doubleValue();
    }

    public record ImportPageView(int pageNumber, String classification, Integer charCount,
                                 int rotationDegrees, String tableModeUsed, int rowsExtracted,
                                 Double meanOcrConfidence, Double pageConfidence,
                                 String anomalyCode) {
    }

    /**
     * The mapping screen's payload: the council this batch carries plus the
     * columns read off the document.
     *
     * The council comes from the batch and is shown as a fact with its source
     * attached, because most registers never print their own council on a row.
     */
    @GetMapping("/{batchId}/mapping")
    public MappingProposal mapping(@PathVariable UUID batchId) {
        var batch = imports.require(batchId);
        var detected = imports.detectColumns(batchId);
        String council = batch.getCouncilCode();

        return new MappingProposal(
                batch.getId().toString(),
                null,
                council,
                imports.councilName(council),
                detected.detectedColumns().stream()
                        .map(c -> new DetectedColumnView(c.index(), c.headerText(),
                                c.sampleValues(), c.proposedField(), c.proposalConfidence()))
                        .toList(),
                null);
    }

    public record DetectedColumnView(int index, String headerText, List<String> sampleValues,
                                     String proposedField, double proposalConfidence) {
    }

    public record MappingProposal(String batchId, String profileName, String councilCode,
                                  String councilName, List<DetectedColumnView> detectedColumns,
                                  Object shapeMismatch) {
    }

    /**
     * Confirming the mapping is what starts extraction.
     *
     * Nothing is parsed until this call: a mismapped column is the worst failure
     * this pipeline has because it does not look like one, and thirty seconds of
     * a person's attention once per register is the cheapest guard available.
     */
    @PostMapping("/{batchId}/mapping")
    public BatchView confirmMapping(@PathVariable UUID batchId, @RequestBody MappingCommand body) {
        imports.extract(batchId, body.columnMap(), null);
        return view(imports.require(batchId));
    }

    public record MappingCommand(Map<Integer, String> columnMap, Boolean saveToProfile,
                                 Boolean statusAbsent) {
    }

    /**
     * Rows that could not become a registry record, with why. Never silently
     * dropped: row counts must reconcile.
     */
    @GetMapping("/{batchId}/rejects")
    public List<Object> rejects(@PathVariable UUID batchId) {
        // The sidecar reports rejects per run and nothing persists them yet, so
        // this is empty rather than absent: an empty list is a true statement,
        // a 404 makes the console show an error over a batch that is fine.
        return List.of();
    }

    /** Staged rows, worst confidence first, filtered and paged on the server. */
    @GetMapping("/{batchId}/staging")
    public StagingPage staging(
            @PathVariable UUID batchId,
            @RequestParam(defaultValue = "false") boolean needsConfirmation,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        var result = imports.stagingRows(batchId, needsConfirmation, PageRequest.of(page, size));
        return new StagingPage(
                result.getContent().stream().map(StagingRowView::of).toList(),
                result.getTotalElements(),
                result.getTotalPages(),
                result.getNumber(),
                result.getSize(),
                imports.needsConfirmationCount(batchId));
    }

    public record StagingPage(
            List<StagingRowView> content,
            long totalElements,
            int totalPages,
            int number,
            int size,
            long needsConfirmationCount) {
    }

    public record StagingRowView(
            UUID id,
            int sourcePage,
            int sourceRowIndex,
            String rawRowText,
            String licenseNo,
            String fullName,
            String council,
            String status,
            String specialty,
            String qualification,
            String validUntil,
            double rowConfidence,
            Double licenseConfidence,
            boolean needsConfirmation) {

        static StagingRowView of(StagingRecord r) {
            return new StagingRowView(r.getId(), r.getSourcePage(), r.getSourceRowIndex(),
                    r.getRawRowText(), r.getLicenseNoRaw(), r.getFullNameRaw(), r.getCouncilRaw(),
                    r.getStatusRaw(), r.getSpecialtyRaw(), r.getQualificationRaw(),
                    r.getValidUntilRaw(),
                    r.getRowConfidence().doubleValue(),
                    r.getLicenseConfidence() == null ? null : r.getLicenseConfidence().doubleValue(),
                    r.isNeedsConfirmation());
        }
    }

    /**
     * The response shape the console reads. Separate from the entity on purpose:
     * adding a column to ImportBatch must not silently publish it.
     */
    /**
     * The shape the console already speaks.
     *
     * Separate from the entity on purpose: adding a column to ImportBatch must
     * not silently publish it. Two fields are honestly zero rather than
     * invented, and both are marked below.
     */
    public record BatchView(
            UUID id,
            String label,
            String councilCode,
            String status,
            String profileId,
            String profileName,
            String sourceFilename,
            String sourceSha256,
            long sourceBytes,
            Integer pageCount,
            Classification classification,
            Reconciliation reconciliation,
            int pagesDone,
            int rowsExtracted,
            int rowsRejected,
            int rowsPromoted,
            long needsConfirmationCount,
            int staleDiffCount,
            String failureCode,
            String failureDetail,
            String extractionStartedAt,
            String extractionHeartbeatAt,
            String promotedAt,
            String promotedBy,
            String promoteReason,
            String uploadedBy,
            String createdAt,
            String updatedAt) {

        public record Classification(int pageCount, int textLayerPages, int scannedPages,
                                     int unreadablePages, int rotatedPages) {
        }

        public record Reconciliation(Integer declaredRowCount, int extractedRowCount,
                                     int rejectedRowCount, Integer gap, double meanRowsPerPage,
                                     int anomalousPageCount) {
        }

        static BatchView of(ImportBatch b, long needsConfirmation) {
            Classification classification = b.getPageCount() == null ? null
                    : new Classification(b.getPageCount(),
                            b.getTextLayerPages() == null ? 0 : b.getTextLayerPages(),
                            b.getScannedPages() == null ? 0 : b.getScannedPages(),
                            b.getUnreadablePages() == null ? 0 : b.getUnreadablePages(),
                            // Rotated pages are reported per page by the sidecar and
                            // not yet persisted, so this is 0 until import_page is
                            // stored. Zero rather than a guess.
                            0);

            Reconciliation reconciliation = b.getRowsExtracted() == 0 ? null
                    : new Reconciliation(
                            b.getDeclaredRowCount(),
                            b.getRowsExtracted(),
                            b.getRowsRejected(),
                            // Null when the document declared nothing. The gap is
                            // what catches silent partial extraction; without a
                            // declared total there is nothing to compare against.
                            b.getDeclaredRowCount() == null ? null
                                    : b.getRowsExtracted() + b.getRowsRejected() - b.getDeclaredRowCount(),
                            b.getPageCount() == null || b.getPageCount() == 0 ? 0
                                    : Math.round(b.getRowsExtracted() * 10.0 / b.getPageCount()) / 10.0,
                            // Same as rotatedPages: needs import_page persisted.
                            0);

            return new BatchView(b.getId(), b.getLabel(), b.getCouncilCode(), b.getStatus(),
                    null, null,
                    b.getSourceFilename(), b.getSourceSha256(), b.getSourceBytes(),
                    b.getPageCount(), classification, reconciliation, b.getPagesDone(),
                    b.getRowsExtracted(), b.getRowsRejected(), b.getRowsPromoted(),
                    needsConfirmation, 0,
                    b.getFailureCode(), b.getFailureDetail(),
                    null, null, null, null, null,
                    b.getUploadedBy(), b.getCreatedAt().toString(), b.getUpdatedAt().toString());
        }
    }
}

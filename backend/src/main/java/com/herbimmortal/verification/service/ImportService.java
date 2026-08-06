package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.ImportBatch;
import com.herbimmortal.verification.extraction.ExtractionClient;
import com.herbimmortal.verification.extraction.ExtractionDtos.ClassifyResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.ExtractResponse;
import com.herbimmortal.verification.extraction.ExtractionException;
import com.herbimmortal.verification.extraction.ExtractionProperties;
import com.herbimmortal.verification.domain.ImportPage;
import com.herbimmortal.verification.domain.StagingRecord;
import com.herbimmortal.verification.repository.ImportBatchRepository;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.repository.ImportPageRepository;
import com.herbimmortal.verification.repository.StagingRecordRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Upload, classify and extract a register.
 *
 * All the logic lives here rather than in the controller so the HTTP path, a
 * scheduled re-import and any bulk tool run identical code. No business logic in
 * controllers, ever.
 */
@Service
public class ImportService {

    private static final Logger log = LoggerFactory.getLogger(ImportService.class);
    private static final long MAX_BYTES = 200L * 1024 * 1024;

    /** Below this the parser was unsure and a person reads the row. */
    private static final double MIN_LICENCE_CONFIDENCE = 0.95;

    private final ImportBatchRepository batches;
    private final StagingRecordRepository staging;
    private final ImportPageRepository pages;
    private final CouncilRepository councils;
    private final ExtractionClient extraction;
    private final Path uploadDir;

    public ImportService(ImportBatchRepository batches, StagingRecordRepository staging,
                         ImportPageRepository pages, CouncilRepository councils,
                         ExtractionClient extraction,
                         ExtractionProperties properties) throws IOException {
        this.batches = batches;
        this.staging = staging;
        this.pages = pages;
        this.councils = councils;
        this.extraction = extraction;
        this.uploadDir = Path.of(properties.uploadDir()).toAbsolutePath().normalize();
        Files.createDirectories(this.uploadDir);
    }

    @Transactional
    public ImportBatch upload(MultipartFile file, String label, String councilCode, String uploadedBy) {
        if (file.isEmpty()) {
            throw new IllegalArgumentException("The uploaded file is empty.");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new IllegalArgumentException("That file is over 200 MB. Split the register.");
        }
        if (!"application/pdf".equals(file.getContentType())) {
            throw new IllegalArgumentException("This pipeline reads council register PDFs only.");
        }

        String objectKey = UUID.randomUUID() + ".pdf";
        Path target = uploadDir.resolve(objectKey);
        // Guards against a crafted object key escaping the upload directory.
        // The key is generated here so it cannot today, and that is exactly the
        // kind of invariant that stops being true after one refactor.
        if (!target.normalize().startsWith(uploadDir)) {
            throw new IllegalArgumentException("Refusing to write outside the upload directory.");
        }

        String sha256 = storeAndDigest(file, target);

        batches.findBySourceSha256AndStatusNot(sha256, "CANCELLED").ifPresent(existing -> {
            throw new IllegalStateException(
                    "This exact PDF was already uploaded as batch " + existing.getId());
        });

        ImportBatch batch = new ImportBatch(label, councilCode, objectKey,
                file.getOriginalFilename(), sha256, file.getSize(), uploadedBy);
        return batches.save(batch);
    }

    /**
     * The cheap pass, run before extraction on purpose: a register that comes
     * back fully scanned will extract far worse, and the admin should learn that
     * before waiting out a 400 page OCR run rather than after.
     */
    @Transactional
    public ImportBatch classify(UUID batchId) {
        ImportBatch batch = require(batchId);
        try {
            ClassifyResponse response = extraction.classify(
                    batch.getId().toString(), resolve(batch).toString());
            batch.recordClassification(response.pageCount(), response.textLayerPages(),
                    response.scannedPages(), response.unreadablePages());

            if (response.textLayerPages() == 0 && response.scannedPages() == 0) {
                batch.fail("NO_READABLE_PAGES",
                        "Every page came back unreadable. Nothing can be extracted from this file.",
                        "CLASSIFY_FAILED");
            }
        } catch (ExtractionException e) {
            log.error("classification failed for batch {}", batchId, e);
            batch.fail(e.failureCode(), e.getMessage(), "CLASSIFY_FAILED");
        }
        return batches.save(batch);
    }

    @Transactional
    public ExtractResponse extract(UUID batchId, Map<Integer, String> columnMap, String tableMode) {
        ImportBatch batch = require(batchId);
        try {
            ExtractResponse response = extraction.extract(
                    new com.herbimmortal.verification.extraction.ExtractionDtos.ExtractRequest(
                            batch.getId().toString(), resolve(batch).toString(),
                            tableMode == null ? "AUTO" : tableMode, columnMap, null, java.util.List.of()));

            // Re-extracting replaces the previous attempt rather than adding to
            // it. Two runs of the same batch must not leave the register in
            // staging twice, and a partial first run is not worth keeping.
            staging.deleteByImportBatchId(batch.getId());

            List<StagingRecord> records = response.rows().stream().map(row -> {
                StagingRecord record = new StagingRecord(
                        batch.getId(), row.sourcePage(), row.sourceRowIndex(), row.rawRowText());
                row.cells().forEach((field, cell) -> record.setCell(field, cell.raw()));
                record.scoreConfidence(row.rowConfidence(), row.licenseConfidence(),
                        MIN_LICENCE_CONFIDENCE);
                return record;
            }).toList();
            staging.saveAll(records);

            pages.deleteByImportBatchId(batch.getId());
            List<ImportPage> pageRows = response.pages().stream()
                    .map(p -> new ImportPage(batch.getId(), p.pageNumber(), p.classification(),
                            p.charCount(), p.rotationDegrees(), p.tableModeUsed(),
                            p.rowsExtracted(), p.meanOcrConfidence(), p.anomalyCode()))
                    .toList();
            double meanRows = pageRows.isEmpty() ? 0
                    : pageRows.stream().mapToInt(ImportPage::getRowsExtracted).average().orElse(0);
            pageRows.forEach(p -> p.scoreAgainst(meanRows));
            pages.saveAll(pageRows);

            batch.recordExtraction(response.rows().size(), response.rejects().size(),
                    response.declaredRowCount());
            batches.save(batch);
            return response;
        } catch (ExtractionException e) {
            log.error("extraction failed for batch {}", batchId, e);
            batch.fail(e.failureCode(), e.getMessage(), "PARSE_FAILED");
            batches.save(batch);
            throw e;
        }
    }

    public ImportBatch require(UUID batchId) {
        return batches.findById(batchId)
                .orElseThrow(() -> new IllegalArgumentException("No batch " + batchId));
    }

    public List<ImportBatch> all() {
        return batches.findAll();
    }

    public org.springframework.data.domain.Page<StagingRecord> stagingRows(
            UUID batchId, boolean needsConfirmationOnly,
            org.springframework.data.domain.Pageable pageable) {
        return needsConfirmationOnly
                ? staging.findByImportBatchIdAndNeedsConfirmationTrueAndConfirmedAtIsNullOrderByRowConfidenceAsc(batchId, pageable)
                : staging.findByImportBatchIdOrderByRowConfidenceAsc(batchId, pageable);
    }

    /** Display name for a council code, falling back to the code itself. */
    public String councilName(String code) {
        if (code == null) return null;
        return councils.findById(code)
                .map(com.herbimmortal.verification.domain.Council::getCanonicalName)
                .orElse(code);
    }

    public List<ImportPage> pageRows(UUID batchId) {
        return pages.findByImportBatchIdOrderByPageNumberAsc(batchId);
    }

    public long anomalousPageCount(UUID batchId) {
        return pages.countByImportBatchIdAndAnomalyCodeIsNotNull(batchId);
    }

    public long needsConfirmationCount(UUID batchId) {
        return staging.countByImportBatchIdAndNeedsConfirmationTrueAndConfirmedAtIsNull(batchId);
    }

    /** Detected columns for the mapping screen, read from the document itself. */
    public com.herbimmortal.verification.extraction.ExtractionDtos.DetectResponse detectColumns(UUID batchId) {
        ImportBatch batch = require(batchId);
        return extraction.detectColumns(batch.getId().toString(), resolve(batch).toString());
    }

    private Path resolve(ImportBatch batch) {
        return uploadDir.resolve(batch.getSourceObjectKey());
    }

    /**
     * Hashes while writing rather than reading the file twice. On a 200 MB
     * register the second read is not free, and it is a second chance for the
     * bytes on disk to differ from the bytes that were hashed.
     */
    private String storeAndDigest(MultipartFile file, Path target) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = file.getInputStream();
                 DigestInputStream digesting = new DigestInputStream(in, digest)) {
                Files.copy(digesting, target, StandardCopyOption.REPLACE_EXISTING);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException("Could not store the uploaded file", e);
        }
    }
}

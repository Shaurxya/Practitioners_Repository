package com.herbimmortal.verification.ingestion;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Date;
import java.sql.Types;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Loads a registry export into registry_records.
 *
 * WHY JdbcTemplate AND NOT JPA
 * Bulk loading through Hibernate means one managed entity per row sitting in
 * the persistence context, dirty checked on every flush, for no benefit: these
 * rows are written once and never edited by the application. JdbcTemplate maps
 * straight onto a JDBC batch. The verification flow later uses JPA, because
 * there the object graph and change tracking earn their cost.
 *
 * JdbcTemplate is roughly psycopg with the connection handling and the
 * try/finally removed.
 */
@Service
public class RegistryIngestionService {

    private static final Logger log = LoggerFactory.getLogger(RegistryIngestionService.class);

    private static final String UPSERT_SQL = """
            INSERT INTO registry_records (
                license_no_raw, full_name_raw, council_raw, status_raw,
                specialty_raw, qualification_raw, registration_date_raw, valid_until_raw,
                license_no_normalized, full_name_normalized, council_code, status,
                registration_date, valid_until,
                source_batch, source_row_number, raw_payload, content_hash,
                present_in_latest_batch
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,true)
            ON CONFLICT (license_no_normalized, council_code, content_hash)
            DO UPDATE SET
                source_batch            = EXCLUDED.source_batch,
                source_row_number       = EXCLUDED.source_row_number,
                synced_at               = now(),
                present_in_latest_batch = true
            """;

    private static final String REJECT_SQL = """
            INSERT INTO registry_import_rejects
                (source_batch, source_row_number, raw_payload, reason_code, reason_detail)
            VALUES (?,?,?::jsonb,?,?)
            """;

    private final JdbcTemplate jdbc;
    private final RegistryRowParser parser;
    private final IngestionProperties properties;
    private final ObjectMapper objectMapper;

    /**
     * Single constructor, so Spring injects these without an @Autowired
     * annotation. Constructor injection over field injection because it makes
     * the dependencies visible and the class constructible in a plain unit test.
     */
    public RegistryIngestionService(JdbcTemplate jdbc, RegistryRowParser parser,
                                    IngestionProperties properties, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.parser = parser;
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    /**
     * Deliberately NOT @Transactional.
     *
     * One transaction around 5000 rows means a single bad row at the end rolls
     * back the entire load, and it holds locks and WAL for the whole run. Each
     * batch commits on its own, so a crash halfway leaves a partial load that
     * the next run completes, because the operation is idempotent.
     */
    public IngestionReport ingest() throws IOException {
        Instant started = Instant.now();
        Path path = Path.of(properties.file());
        if (!Files.exists(path)) {
            throw new IOException("Registry file not found: " + path.toAbsolutePath());
        }

        String batch = "batch-" + LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
        Map<String, String> councilCodes = loadCouncilAliases();
        log.info("Ingesting {} as {} with {} council aliases, batch size {}",
                path, batch, councilCodes.size(), properties.batchSize());

        long rowsBefore = countRows();
        long rowsRead = 0;
        long rejected = 0;
        Map<RejectReason, Long> byReason = new EnumMap<>(RejectReason.class);

        List<RegistryRowParser.ParsedRow> pending = new ArrayList<>(properties.batchSize());
        List<RegistryRowParser.Reject> pendingRejects = new ArrayList<>();

        CSVFormat format = CSVFormat.DEFAULT.builder()
                .setHeader()                 // first line is the header
                .setSkipHeaderRecord(true)
                .setIgnoreSurroundingSpaces(true)
                .setTrim(true)
                .get();

        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8);
             CSVParser csv = CSVParser.parse(reader, format)) {

            for (CSVRecord record : csv) {
                rowsRead++;
                Map<String, String> row = record.toMap();
                String json = toJson(row);

                RegistryRowParser.Outcome outcome =
                        record.isConsistent()
                                ? parser.parse(row, (int) record.getRecordNumber(), councilCodes, json)
                                : new RegistryRowParser.Reject((int) record.getRecordNumber(), json,
                                RejectReason.MALFORMED_ROW,
                                "expected " + csv.getHeaderNames().size() + " columns, got " + record.size());

                // Pattern matching for switch: the compiler checks both
                // permitted subtypes of the sealed interface are handled.
                switch (outcome) {
                    case RegistryRowParser.ParsedRow p -> pending.add(p);
                    case RegistryRowParser.Reject r -> {
                        pendingRejects.add(r);
                        rejected++;
                        byReason.merge(r.reason(), 1L, Long::sum);
                    }
                }

                if (pending.size() >= properties.batchSize()) {
                    flush(pending, batch);
                }
                if (pendingRejects.size() >= properties.batchSize()) {
                    flushRejects(pendingRejects, batch);
                }
            }
        }
        flush(pending, batch);
        flushRejects(pendingRejects, batch);

        // Rows from earlier batches are not deleted. They are flagged out of
        // the matcher's view, so a decision made against one can still be
        // explained six months from now.
        int superseded = jdbc.update(
                "UPDATE registry_records SET present_in_latest_batch = false "
                        + "WHERE source_batch <> ? AND present_in_latest_batch", batch);

        long inserted = countRows() - rowsBefore;
        long unchanged = rowsRead - rejected - inserted;

        IngestionReport report = new IngestionReport(
                batch, rowsRead, inserted, unchanged, rejected, superseded,
                byReason, Duration.between(started, Instant.now()));
        log.info(report.toLogLines());
        if (!report.reconciles()) {
            log.error("Ingestion did not reconcile. Rows are unaccounted for.");
        }
        return report;
    }

    /**
     * Sends the buffered rows as ONE JDBC batch.
     *
     * Chunk size is a memory versus round trip tradeoff. Every buffered row is
     * a live object on the heap, so 50000 would hold the whole file in memory.
     * One row per statement would mean one network round trip each, and at
     * around 0.2ms of latency per trip that is the entire cost of the load.
     * 500 keeps the heap flat and amortises the latency to nothing. Above a few
     * thousand the returns disappear and the failure blast radius grows.
     */
    private void flush(List<RegistryRowParser.ParsedRow> pending, String batch) {
        if (pending.isEmpty()) {
            return;
        }
        jdbc.batchUpdate(UPSERT_SQL, pending, pending.size(), (ps, p) -> {
            ps.setString(1, p.licenseNoRaw());
            ps.setString(2, p.fullNameRaw());
            ps.setString(3, p.councilRaw());
            ps.setString(4, p.statusRaw());
            ps.setString(5, p.specialtyRaw());
            ps.setString(6, p.qualificationRaw());
            ps.setString(7, p.registrationDateRaw());
            ps.setString(8, p.validUntilRaw());
            ps.setString(9, p.licenseNoNormalized());
            ps.setString(10, p.fullNameNormalized());
            ps.setString(11, p.councilCode());
            ps.setString(12, p.status());
            setDate(ps, 13, p.registrationDate());
            setDate(ps, 14, p.validUntil());
            ps.setString(15, batch);
            ps.setInt(16, p.sourceRowNumber());
            ps.setString(17, p.rawPayloadJson());
            ps.setString(18, p.contentHash());
        });
        pending.clear();
    }

    private void flushRejects(List<RegistryRowParser.Reject> rejects, String batch) {
        if (rejects.isEmpty()) {
            return;
        }
        jdbc.batchUpdate(REJECT_SQL, rejects, rejects.size(), (ps, r) -> {
            ps.setString(1, batch);
            ps.setInt(2, r.sourceRowNumber());
            ps.setString(3, r.rawPayloadJson());
            ps.setString(4, r.reason().name());
            ps.setString(5, r.detail());
        });
        rejects.clear();
    }

    private static void setDate(java.sql.PreparedStatement ps, int index, java.time.LocalDate value)
            throws java.sql.SQLException {
        if (value == null) {
            ps.setNull(index, Types.DATE);
        } else {
            ps.setDate(index, Date.valueOf(value));
        }
    }

    private Map<String, String> loadCouncilAliases() {
        Map<String, String> map = new HashMap<>();
        jdbc.query("SELECT alias_normalized, council_code FROM council_aliases",
                rs -> {
                    map.put(rs.getString("alias_normalized"), rs.getString("council_code"));
                });
        return map;
    }

    private long countRows() {
        Long n = jdbc.queryForObject("SELECT count(*) FROM registry_records", Long.class);
        return n == null ? 0 : n;
    }

    private String toJson(Map<String, String> row) {
        try {
            return objectMapper.writeValueAsString(row);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Could not serialize source row to JSON", e);
        }
    }
}

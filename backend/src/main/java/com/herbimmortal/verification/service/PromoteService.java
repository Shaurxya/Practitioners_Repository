package com.herbimmortal.verification.service;

import com.herbimmortal.verification.repository.ImportBatchRepository;
import com.herbimmortal.verification.util.Normalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Writes checked staging rows into the live registry.
 *
 * The only thing in the system that writes registry_records. Rows that still
 * need confirming are left behind rather than promoted with a caveat: the
 * confirmation gate stays absolute per row, it simply no longer holds the rest
 * of the batch hostage.
 *
 * JdbcTemplate rather than JPA because registry_records carries two JSONB
 * columns and a generated content hash, and mapping those onto an entity buys
 * nothing when the only operation is one insert.
 */
@Service
public class PromoteService {

    private static final Logger log = LoggerFactory.getLogger(PromoteService.class);

    private final JdbcTemplate jdbc;
    private final ImportBatchRepository batches;

    public PromoteService(JdbcTemplate jdbc, ImportBatchRepository batches) {
        this.jdbc = jdbc;
        this.batches = batches;
    }

    @Transactional
    public Map<String, Object> promote(UUID batchId, String reason) {
        var batch = batches.findById(batchId)
                .orElseThrow(() -> new IllegalArgumentException("No batch " + batchId));

        if (reason == null || reason.isBlank() || reason.trim().length() < 10) {
            throw new IllegalArgumentException("A reason of at least 10 characters is required.");
        }

        var ready = jdbc.queryForList(
                "select id, license_no_raw, full_name_raw, council_raw, status_raw,"
                        + " specialty_raw, qualification_raw, valid_until_raw"
                        + " from registry_staging_record"
                        + " where import_batch_id = ? and promoted_at is null"
                        + "   and (needs_confirmation = false or confirmed_at is not null)"
                        + "   and license_no_raw is not null",
                batchId);

        int inserted = 0;
        int rowNumber = 0;
        for (Map<String, Object> row : ready) {
            rowNumber++;
            String licence = (String) row.get("license_no_raw");
            String name = (String) row.get("full_name_raw");
            String councilRaw = (String) row.get("council_raw");
            String council = batch.getCouncilCode();

            String licenceNormalized = Normalizer.normalizeLicenseNumber(licence, council);
            String nameNormalized = Normalizer.normalizeName(name);
            String status = Normalizer.normalizeStatus((String) row.get("status_raw"));

            // content_hash digests the business fields only, never provenance,
            // so re-running the same file produces identical hashes and the
            // upsert fires instead of duplicating. That is idempotency.
            String contentHash = Integer.toHexString(
                    (licenceNormalized + "|" + nameNormalized + "|" + council + "|" + status).hashCode());

            jdbc.update("""
                    insert into registry_records
                      (license_no_raw, full_name_raw, council_raw, status_raw, specialty_raw,
                       qualification_raw, valid_until_raw, license_no_normalized,
                       full_name_normalized, council_code, status, source_batch,
                       source_row_number, raw_payload, content_hash)
                    values (?,?,?,?,?,?,?,?,?,?,?,?,?, '{}'::jsonb, ?)
                    on conflict do nothing
                    """,
                    licence, name, councilRaw, row.get("status_raw"), row.get("specialty_raw"),
                    row.get("qualification_raw"), row.get("valid_until_raw"),
                    licenceNormalized, nameNormalized, council, status,
                    batch.getLabel(), rowNumber, contentHash);
            inserted++;
        }

        jdbc.update("update registry_staging_record set promoted_at = now()"
                + " where import_batch_id = ? and promoted_at is null"
                + "   and (needs_confirmation = false or confirmed_at is not null)"
                + "   and license_no_raw is not null", batchId);

        Long held = jdbc.queryForObject(
                "select count(*) from registry_staging_record where import_batch_id = ?"
                        + " and promoted_at is null", Long.class, batchId);
        long remaining = held == null ? 0 : held;

        // Terminal only when nothing is left. A batch with held rows is still
        // waiting on a person, and saying PROMOTED would lose exactly that fact.
        jdbc.update("update import_batch set status = ?, rows_promoted = rows_promoted + ?,"
                        + " promoted_at = now(), promoted_by = 'dev', promote_reason = ?,"
                        + " updated_at = now() where id = ?",
                remaining > 0 ? "PARTIALLY_PROMOTED" : "PROMOTED", inserted, reason, batchId);

        log.info("promoted {} rows from batch {}, {} held", inserted, batchId, remaining);

        Map<String, Object> result = new HashMap<>();
        result.put("batchId", batchId.toString());
        result.put("status", remaining > 0 ? "PARTIALLY_PROMOTED" : "PROMOTED");
        result.put("inserted", inserted);
        result.put("updated", 0);
        result.put("unchanged", 0);
        result.put("flaggedNotPresent", 0);
        result.put("held", remaining);
        return result;
    }
}

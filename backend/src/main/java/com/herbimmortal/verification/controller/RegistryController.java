package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.service.PromoteService;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The live registry, and the promote that fills it.
 *
 * Separate from ImportController because it answers a different question.
 * Imports shows how data got here, batch by batch, with everything still in
 * staging. This shows what is here now, across every batch ever promoted, and
 * it is what a claim is matched against.
 *
 * Read only. Nothing edits a registry record by hand: the registry is a
 * normalized copy of an external authority, and a hand edit is a claim about a
 * council's own register that the council never made.
 */
@RestController
@RequestMapping("/api/v1/admin")
@Profile("!prod")
public class RegistryController {

    private final JdbcTemplate jdbc;
    private final PromoteService promote;

    public RegistryController(JdbcTemplate jdbc, PromoteService promote) {
        this.jdbc = jdbc;
        this.promote = promote;
    }

    public record RegistryRecordView(String councilCode, String licenceRaw, String fullNameRaw,
                                     String status, String validUntil, String specialty,
                                     String sourceBatch) {
    }

    /** Filtered and paged server side. The console never narrows a page in the browser. */
    @GetMapping("/registry")
    public Map<String, Object> registry(
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "") String council,
            @RequestParam(defaultValue = "") String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {

        StringBuilder where = new StringBuilder(" where 1=1");
        List<Object> args = new java.util.ArrayList<>();
        if (!council.isBlank()) { where.append(" and council_code = ?"); args.add(council); }
        if (!status.isBlank()) { where.append(" and status = ?"); args.add(status); }
        if (!q.isBlank()) {
            where.append(" and (upper(full_name_raw) like ? or upper(license_no_raw) like ?"
                    + " or license_no_normalized like ?)");
            String like = "%" + q.toUpperCase() + "%";
            args.add(like);
            args.add(like);
            args.add("%" + q.toUpperCase().replaceAll("[^A-Z0-9]", "") + "%");
        }

        Long total = jdbc.queryForObject(
                "select count(*) from registry_records" + where, Long.class, args.toArray());

        List<Object> paged = new java.util.ArrayList<>(args);
        paged.add(size);
        paged.add(page * size);

        // Council then licence, which is the natural key. Any other default
        // makes two runs of the same filter return rows in different places.
        List<RegistryRecordView> rows = jdbc.query(
                "select council_code, license_no_raw, full_name_raw, status, valid_until,"
                        + " specialty_raw, source_batch from registry_records" + where
                        + " order by council_code, license_no_normalized limit ? offset ?",
                (rs, i) -> new RegistryRecordView(rs.getString(1), rs.getString(2), rs.getString(3),
                        rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7)),
                paged.toArray());

        long count = total == null ? 0 : total;
        return Map.of("content", rows, "totalElements", count,
                "totalPages", Math.max(1, (int) Math.ceil(count / (double) size)),
                "number", page, "size", size);
    }

    @GetMapping("/registry/summary")
    public Map<String, Object> summary() {
        Long total = jdbc.queryForObject("select count(*) from registry_records", Long.class);
        List<String> councils = jdbc.queryForList(
                "select distinct council_code from registry_records order by 1", String.class);
        List<String> batches = jdbc.queryForList(
                "select distinct source_batch from registry_records order by 1", String.class);
        Map<String, Object> byStatus = new java.util.LinkedHashMap<>();
        jdbc.query("select status, count(*) from registry_records group by status order by 1",
                rs -> { byStatus.put(rs.getString(1), rs.getLong(2)); });

        return Map.of("totalRows", total == null ? 0 : total, "councils", councils,
                "batches", batches, "byStatus", byStatus);
    }

    @PostMapping("/imports/{batchId}/promote")
    public Map<String, Object> promote(@PathVariable UUID batchId, @RequestBody(required = false) Map<String, Object> body) {
        String reason = body == null ? null : String.valueOf(body.get("reason"));
        return promote.promote(batchId, reason);
    }

    /**
     * Parser profiles and the accuracy report are not persisted yet. An empty
     * answer is a true statement and lets those screens render the empty state
     * they already have; a 404 makes the console show an error instead.
     */
    @GetMapping("/profiles")
    public List<Object> profiles() {
        return List.of();
    }

    @GetMapping("/accuracy")
    public Map<String, Object> accuracy() {
        return Map.of("batchesCovered", 0, "rowsReviewed", 0,
                "byField", List.of(), "byClassification", List.of(),
                "recentCorrections", List.of());
    }
}

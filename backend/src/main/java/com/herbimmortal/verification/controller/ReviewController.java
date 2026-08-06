package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.service.VerificationService;
import com.herbimmortal.verification.util.Normalizer;
import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The review console's API. Everything a person needs to decide a case, and
 * nothing the practitioner facing response is allowed to see.
 */
@RestController
@RequestMapping("/api/v1/admin/review")
@Profile("!prod")
public class ReviewController {

    private final VerificationService verification;

    public ReviewController(VerificationService verification) {
        this.verification = verification;
    }

    @GetMapping
    public Map<String, Object> queue(
            @RequestParam(required = false) List<String> status,
            @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "25") int size) {

        List<VerificationCase> rows = verification.queue().stream()
                .filter(c -> status == null || status.isEmpty() || status.contains(c.getStatus()))
                .filter(c -> q.isBlank()
                        || c.getClaimedFullName().toLowerCase().contains(q.toLowerCase())
                        || c.getClaimedRegistrationNumber().toLowerCase().contains(q.toLowerCase()))
                .toList();

        int from = Math.min(page * size, rows.size());
        int to = Math.min(from + size, rows.size());
        List<Map<String, Object>> content = rows.subList(from, to).stream()
                .map(c -> Map.<String, Object>of(
                        "caseId", c.getId().toString(),
                        "status", c.getStatus(),
                        "claimedFullName", c.getClaimedFullName(),
                        "claimedRegistrationNumber", c.getClaimedRegistrationNumber(),
                        "council", c.getClaimedCouncil(),
                        "routedReasons", verification.ruleResults(c.getId()).stream()
                                .filter(r -> List.of("FAIL", "REVIEW").contains(r.get("outcome")))
                                .map(r -> r.get("rule_code")).toList(),
                        "submittedAt", c.getSubmittedAt().toString()))
                .toList();

        return Map.of("content", content, "totalElements", rows.size(),
                "totalPages", Math.max(1, (int) Math.ceil(rows.size() / (double) size)),
                "number", page, "size", size);
    }

    @GetMapping("/{caseId}")
    public Map<String, Object> detail(@PathVariable UUID caseId) {
        VerificationCase c = verification.require(caseId);

        // A HashMap because several of these are legitimately null on an open
        // case, and Map.of rejects null. Returning "" instead was worse than it
        // looks: the console parsed it as a date, Intl threw RangeError on the
        // Invalid Date, and the whole route fell through to its error element.
        Map<String, Object> detail = new java.util.HashMap<>();
        detail.put("caseId", c.getId().toString());
        detail.put("status", c.getStatus());
        detail.put("submittedAt", c.getSubmittedAt().toString());
        detail.put("decidedAt", c.getDecidedAt() == null ? null : c.getDecidedAt().toString());
        detail.put("decidedBy", c.getDecidedBy());
        detail.put("decisionReason", c.getDecisionReason());
        detail.put("claim", Map.of(
                "fullName", c.getClaimedFullName(),
                "registrationNumber", c.getClaimedRegistrationNumber(),
                "council", c.getClaimedCouncil(),
                "specialty", c.getClaimedSpecialty() == null ? "" : c.getClaimedSpecialty(),
                "normalizedName", Normalizer.normalizeName(c.getClaimedFullName()),
                "normalizedRegistrationNumber",
                Normalizer.normalizeLicenseNumber(c.getClaimedRegistrationNumber(), c.getClaimedCouncil())));
        detail.put("candidates", List.of());
        detail.put("ruleResults", verification.ruleResults(caseId).stream()
                .map(r -> Map.of("ruleCode", r.get("rule_code"),
                        "outcome", r.get("outcome"), "detail", r.get("detail")))
                .toList());
        detail.put("audit", verification.auditFor(caseId).stream().map(a -> {
            Map<String, Object> event = new java.util.HashMap<>();
            // ISO 8601, not the JDBC toString. Postgres hands back
            // "2026-08-05 22:51:06.582" with a space, which Date cannot parse.
            event.put("at", ((java.sql.Timestamp) a.get("created_at")).toInstant().toString());
            event.put("eventType", a.get("event_type"));
            event.put("actor", String.valueOf(a.get("actor_type")).toLowerCase());
            event.put("fromStatus", a.get("from_status"));
            event.put("toStatus", a.get("to_status"));
            event.put("reason", a.get("reason"));
            return event;
        }).toList());

        return detail;
    }

    public record DecideCommand(String decision, String reason) {
    }

    /** Approving here is what issues the Immortal ID for a case a person had to read. */
    @PostMapping("/{caseId}/decide")
    public Map<String, Object> decide(@PathVariable UUID caseId, @RequestBody DecideCommand body) {
        VerificationCase decided = verification.decide(caseId, body.decision(), body.reason(), "reviewer");
        var next = verification.queue().stream()
                .filter(c -> !c.getId().equals(caseId)).findFirst();

        // A HashMap, because Map.of rejects a null value and nextCaseId is null
        // exactly when the queue has just been emptied, which is the moment this
        // response matters most.
        Map<String, Object> response = new java.util.HashMap<>();
        response.put("caseId", decided.getId().toString());
        response.put("status", decided.getStatus());
        response.put("decidedAt", decided.getDecidedAt().toString());
        response.put("nextCaseId", next.map(c -> c.getId().toString()).orElse(null));
        return response;
    }
}

package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.service.VerificationService;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.util.Normalizer;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
@PreAuthorize("hasAnyRole('REVIEWER','ADMIN')")
public class ReviewController {

    private final VerificationService verification;
    private final com.herbimmortal.verification.service.DocumentService documents;
    private final com.herbimmortal.verification.service.IdentityService identity;

    public ReviewController(VerificationService verification,
                            com.herbimmortal.verification.service.DocumentService documents,
                            com.herbimmortal.verification.service.IdentityService identity) {
        this.verification = verification;
        this.documents = documents;
        this.identity = identity;
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
                        // Not a plain FAIL/REVIEW filter. A required rule that
                        // could not run is stored as SKIPPED and promoted to
                        // REVIEW only inside the decision, so filtering on the
                        // stored word omits exactly the checks that sent the
                        // case here. See RuleEngine.isRoutingReason.
                        "routedReasons", verification.ruleResults(c.getId()).stream()
                                .filter(r -> com.herbimmortal.verification.service.RuleEngine
                                        .isRoutingReason(String.valueOf(r.get("rule_code")),
                                                String.valueOf(r.get("outcome"))))
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

        // The identifier this person already holds, null until a first approval.
        // A reviewer looking at a second case for someone who is already
        // verified needs to see that, and the console is where a support ticket
        // quoting an Immortal ID gets answered.
        var practitioner = verification.practitionerFor(c);
        detail.put("immortalId", practitioner.getImmortalId());

        detail.put("claim", Map.of(
                "fullName", c.getClaimedFullName(),
                "registrationNumber", c.getClaimedRegistrationNumber(),
                "council", c.getClaimedCouncil(),
                "specialty", c.getClaimedSpecialty() == null ? "" : c.getClaimedSpecialty(),
                "country", c.getClaimedCountry() == null ? "" : c.getClaimedCountry(),
                "medicalSystem", c.getClaimedMedicalSystem() == null ? "" : c.getClaimedMedicalSystem(),
                "normalizedName", Normalizer.normalizeName(c.getClaimedFullName()),
                "normalizedRegistrationNumber",
                Normalizer.normalizeLicenseNumber(c.getClaimedRegistrationNumber(), c.getClaimedCouncil())));
        double nameScore = c.getMatchConfidence() == null ? 0 : c.getMatchConfidence().doubleValue();
        detail.put("candidates", verification.candidatesFor(c).stream().map(r -> {
            Map<String, Object> candidate = new java.util.HashMap<>();
            candidate.put("registryRecordId", String.valueOf(r.get("id")));
            // Exact, because matching keys on the natural key. Fuzzy licence
            // fallback is phase 7 and would report itself differently here.
            candidate.put("matchedOn", "EXACT_LICENSE");
            candidate.put("nameScore", nameScore);
            candidate.put("fullName", r.get("full_name_raw"));
            candidate.put("registrationNumber", r.get("license_no_raw"));
            candidate.put("council", r.get("council_code"));
            candidate.put("specialty", r.get("specialty_raw") == null ? "" : r.get("specialty_raw"));
            candidate.put("status", r.get("status"));
            candidate.put("validUntil", r.get("valid_until") == null ? null
                    : String.valueOf(r.get("valid_until")));
            candidate.put("sourceBatch", r.get("source_batch"));
            candidate.put("syncedAt", ((java.sql.Timestamp) r.get("synced_at")).toInstant().toString());
            candidate.put("presentInLatestBatch", r.get("present_in_latest_batch"));
            return candidate;
        }).toList());
        detail.put("ruleResults", verification.ruleResults(caseId).stream()
                .map(r -> Map.of("ruleCode", r.get("rule_code"),
                        "outcome", r.get("outcome"), "detail", r.get("detail")))
                .toList());
        // Persona verification. The images themselves are fetched separately
        // from /api/v1/documents/{id}/content, one audited read at a time,
        // rather than inlined here: this endpoint is loaded to triage a queue,
        // and embedding two photographs in it would log a read of every
        // passport a reviewer scrolled past.
        detail.put("documents", documents.forCase(caseId).stream().map(d -> {
            Map<String, Object> document = new java.util.HashMap<>();
            document.put("documentId", String.valueOf(d.get("id")));
            document.put("kind", d.get("kind"));
            document.put("contentType", d.get("content_type"));
            document.put("sizeBytes", d.get("size_bytes"));
            document.put("uploadedAt",
                    ((java.sql.Timestamp) d.get("uploaded_at")).toInstant().toString());
            // The reviewer needs to know the difference between "not uploaded"
            // and "uploaded then erased", because only the second one means the
            // evidence existed and is now gone.
            document.put("erased", d.get("erased"));
            return document;
        }).toList());

        detail.put("identityCheck", identity.forCase(caseId).stream().map(i -> {
            Map<String, Object> check = new java.util.HashMap<>();
            check.put("provider", i.get("provider"));
            check.put("outcome", i.get("outcome"));
            check.put("faceMatchScore", i.get("face_match_score"));
            check.put("livenessScore", i.get("liveness_score"));
            check.put("checkedAt",
                    ((java.sql.Timestamp) i.get("checked_at")).toInstant().toString());
            return check;
        }).findFirst().orElse(null));

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

    /**
     * Approving here is what issues the Immortal ID for a case a person had to
     * read.
     *
     * <p>{@code decided_by} records the actual reviewer's email, taken from the
     * authenticated principal. It used to be the literal string "reviewer" for
     * every decision ever made, which made the audit trail unable to answer the
     * one question it exists for: who approved this practitioner. That was
     * acceptable only while there was no way to know.
     */
    @PostMapping("/{caseId}/decide")
    public Map<String, Object> decide(@PathVariable UUID caseId, @RequestBody DecideCommand body,
                                      @AuthenticationPrincipal UserPrincipal caller) {
        VerificationCase decided = verification.decide(
                caseId, body.decision(), body.reason(), caller.email());
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

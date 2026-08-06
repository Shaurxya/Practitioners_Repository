package com.herbimmortal.verification.service;

import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The rule catalog and the decision that aggregates it.
 *
 * The engine never inspects rule codes. It only counts outcomes, which is what
 * lets a rule be added by writing one method here and nothing else: the
 * decision logic is closed for modification.
 */
@Service
public class RuleEngine {

    public record Result(String ruleCode, String outcome, String detail) {
    }

    /** Rules whose SKIPPED is promoted to REVIEW, per decision rule 4. */
    private static final Set<String> REQUIRED =
            Set.of("LICENSE_ACTIVE", "NOT_EXPIRED", "NOT_SANCTIONED", "NAME_MATCH", "SINGLE_CANDIDATE");

    /** D3: renewals lag the register, so a recent expiry is a question, not a no. */
    private static final int GRACE_DAYS = 30;

    public List<Result> evaluate(Map<String, Object> registryRow, String claimedName,
                                 double nameScore, int candidateCount) {
        List<Result> results = new ArrayList<>();
        String status = String.valueOf(registryRow.get("status"));

        // LICENSE_ACTIVE. UNKNOWN routes to a person rather than failing: some
        // registers publish no standing status at all, and failing them would
        // reject every practitioner in one on a fact never asserted.
        if ("ACTIVE".equals(status)) {
            results.add(new Result("LICENSE_ACTIVE", "PASS", "registry status ACTIVE"));
        } else if ("UNKNOWN".equals(status)) {
            results.add(new Result("LICENSE_ACTIVE", "REVIEW",
                    "this register publishes no standing status, so good standing cannot be read"));
        } else {
            results.add(new Result("LICENSE_ACTIVE", "FAIL",
                    "registry status " + status + ", expected ACTIVE"));
        }

        Object validUntil = registryRow.get("valid_until");
        if (validUntil == null) {
            results.add(new Result("NOT_EXPIRED", "SKIPPED", "this register publishes no expiry date"));
        } else {
            LocalDate expiry = LocalDate.parse(validUntil.toString());
            long days = ChronoUnit.DAYS.between(LocalDate.now(), expiry);
            if (days >= 0) {
                results.add(new Result("NOT_EXPIRED", "PASS", "valid until " + expiry));
            } else if (days >= -GRACE_DAYS) {
                results.add(new Result("NOT_EXPIRED", "REVIEW",
                        "expired " + (-days) + " days ago, inside the " + GRACE_DAYS + " day grace window"));
            } else {
                results.add(new Result("NOT_EXPIRED", "FAIL",
                        "valid_until " + expiry + " is " + (-days) + " days past"));
            }
        }

        if ("SUSPENDED".equals(status) || "REVOKED".equals(status)) {
            results.add(new Result("NOT_SANCTIONED", "FAIL", "registry status " + status));
        } else {
            results.add(new Result("NOT_SANCTIONED", "PASS", "no sanction recorded"));
        }

        String score = String.format("similarity %.2f", nameScore);
        if (nameScore >= 0.90) {
            results.add(new Result("NAME_MATCH", "PASS", score));
        } else if (nameScore >= 0.75) {
            results.add(new Result("NAME_MATCH", "REVIEW", score));
        } else {
            results.add(new Result("NAME_MATCH", "FAIL", score));
        }

        results.add(candidateCount == 1
                ? new Result("SINGLE_CANDIDATE", "PASS", "1 candidate matched")
                : new Result("SINGLE_CANDIDATE", "REVIEW", candidateCount + " candidates matched"));

        // Not required until OCR ships, so its SKIPPED is ignored by the engine.
        results.add(new Result("DOC_CONSISTENT", "SKIPPED", "no OCR available"));

        return results;
    }

    /**
     * Deterministic and order independent: any FAIL rejects, otherwise any
     * REVIEW goes to a person, otherwise approve.
     */
    public String decide(int candidateCount, List<Result> results) {
        // Zero candidates is a matching stage outcome, not a rule. A human
        // closes it. Always.
        if (candidateCount == 0) {
            return "NO_MATCH";
        }

        List<Result> effective = results.stream()
                .map(r -> "SKIPPED".equals(r.outcome()) && REQUIRED.contains(r.ruleCode())
                        ? new Result(r.ruleCode(), "REVIEW", r.detail())
                        : r)
                .toList();

        if (effective.stream().anyMatch(r -> "FAIL".equals(r.outcome()))) {
            return "REJECTED";
        }
        if (effective.stream().anyMatch(r -> "REVIEW".equals(r.outcome()))) {
            return "MANUAL_REVIEW";
        }
        return "APPROVED";
    }
}

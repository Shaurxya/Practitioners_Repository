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
            Set.of("LICENSE_ACTIVE", "NOT_EXPIRED", "NOT_SANCTIONED", "NAME_MATCH", "SINGLE_CANDIDATE",
                   "IDENTITY_DOCUMENTS", "FACE_MATCH", "LIVENESS_PASSED");

    /** D3: renewals lag the register, so a recent expiry is a question, not a no. */
    private static final int GRACE_DAYS = 30;

    /**
     * Whether this stored result is a reason the case is sitting in a queue.
     *
     * <p>Exists because a persisted result and an effective one are not the same
     * thing. Decision rule 4 promotes a SKIPPED required rule to REVIEW, and
     * that promotion happens inside {@link #decide} against a local copy: what
     * reaches {@code case_rule_results} is still the word SKIPPED.
     *
     * <p>So a console listing "why is this here" by filtering on FAIL or REVIEW
     * silently omits every required rule that could not run. The identity rules
     * made that visible: with no provider configured, FACE_MATCH and
     * LIVENESS_PASSED are the entire reason a claim needs a person, and the
     * queue was reporting the case as routed for something else entirely.
     */
    public static boolean isRoutingReason(String ruleCode, String outcome) {
        return "FAIL".equals(outcome)
                || "REVIEW".equals(outcome)
                || ("SKIPPED".equals(outcome) && REQUIRED.contains(ruleCode));
    }

    /** Same thresholds as NAME_MATCH, so one number means one thing across the catalog. */
    private static final double FACE_PASS = 0.90;
    private static final double FACE_FAIL = 0.75;

    public List<Result> evaluate(Map<String, Object> registryRow, String claimedName,
                                 double nameScore, int candidateCount,
                                 IdentityService.Check identity) {
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

        results.addAll(identityRules(identity));

        return results;
    }

    /**
     * Persona verification: did a live person holding a government ID make this
     * claim.
     *
     * <p>Three rules rather than one, because a vendor answers three separate
     * questions and collapsing them would lose the difference between a
     * presentation attack and an honest person who does not resemble their own
     * ten year old passport photo. A reviewer needs those to look different.
     *
     * <p>All three are required, so a SKIPPED becomes REVIEW. With no provider
     * configured that means every claim carrying documents reaches a person,
     * which is the correct outcome when no automated check ran: the images were
     * captured, and a human is the liveness check.
     *
     * <p><b>What is not here.</b> The design sketched an ID_NAME_MATCH
     * comparing the name printed on the photo ID against the claim. Nothing
     * available can produce that name: the extraction sidecar reports
     * {@code "ocr": "UNAVAILABLE"} and no provider is wired, so the rule could
     * only ever return SKIPPED. A rule that can never run is worse than an
     * absent one, because the review console would show a check that looks like
     * it means something. It arrives with whatever first reads a document.
     */
    private List<Result> identityRules(IdentityService.Check identity) {
        List<Result> results = new ArrayList<>();

        if (identity == null || !identity.submitted()) {
            // REVIEW, not FAIL. The scheduled re-verification job legitimately
            // has no new documents, and hard failing would revoke every
            // approved practitioner the first time it ran.
            results.add(new Result("IDENTITY_DOCUMENTS", "REVIEW",
                    "no photo ID and selfie were submitted with this claim"));
            results.add(new Result("FACE_MATCH", "SKIPPED", "no images to compare"));
            results.add(new Result("LIVENESS_PASSED", "SKIPPED", "no images to check"));
            return results;
        }

        results.add(new Result("IDENTITY_DOCUMENTS", "PASS", "photo ID and selfie both supplied"));

        Double face = identity.faceMatchScore();
        if (face == null) {
            results.add(new Result("FACE_MATCH", "SKIPPED",
                    "no provider computed a face match, so the images need a person"));
        } else if (face >= FACE_PASS) {
            results.add(new Result("FACE_MATCH", "PASS",
                    String.format("selfie matches the photo ID, similarity %.2f", face)));
        } else if (face >= FACE_FAIL) {
            results.add(new Result("FACE_MATCH", "REVIEW",
                    String.format("selfie and photo ID are a partial match, similarity %.2f", face)));
        } else {
            results.add(new Result("FACE_MATCH", "FAIL",
                    String.format("selfie does not match the photo ID, similarity %.2f", face)));
        }

        // The outcome, not the score, decides liveness. A vendor that says
        // "spoof" with a high score is still saying spoof.
        results.add(switch (identity.outcome()) {
            case "PASS" -> new Result("LIVENESS_PASSED", "PASS", "provider confirmed a live capture");
            case "FAIL" -> new Result("LIVENESS_PASSED", "FAIL",
                    "provider judged the selfie not to be a live capture");
            case "PENDING_HUMAN" -> new Result("LIVENESS_PASSED", "SKIPPED",
                    "no liveness provider is configured, so a reviewer compares the images");
            default -> new Result("LIVENESS_PASSED", "SKIPPED",
                    "the identity provider could not be reached");
        });

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

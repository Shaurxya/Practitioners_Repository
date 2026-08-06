package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.repository.PractitionerRepository;
import com.herbimmortal.verification.repository.VerificationCaseRepository;
import com.herbimmortal.verification.util.ImmortalId;
import com.herbimmortal.verification.util.Normalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Submit a claim, match it against the live registry, run the catalog, decide.
 *
 * Matching runs against registry_records in Postgres: the rows an admin
 * promoted from a real council register. A claim that matches a current entry
 * cleanly is approved and issued an Immortal ID in the same transaction.
 * Anything else goes to a person.
 */
@Service
public class VerificationService {

    private static final Logger log = LoggerFactory.getLogger(VerificationService.class);
    private static final List<String> TERMINAL = List.of("APPROVED", "REJECTED", "EXPIRED", "REVOKED");
    private static final List<String> OPEN = List.of("MANUAL_REVIEW", "NO_MATCH");

    private final JdbcTemplate jdbc;
    private final PractitionerRepository practitioners;
    private final VerificationCaseRepository cases;
    private final RuleEngine rules;

    public VerificationService(JdbcTemplate jdbc, PractitionerRepository practitioners,
                               VerificationCaseRepository cases, RuleEngine rules) {
        this.jdbc = jdbc;
        this.practitioners = practitioners;
        this.cases = cases;
        this.rules = rules;
    }

    @Transactional
    public VerificationCase submit(String fullName, String registrationNumber, String council,
                                   String specialty) {
        String licence = Normalizer.normalizeLicenseNumber(registrationNumber, council);
        String claimedName = Normalizer.normalizeName(fullName);

        Practitioner practitioner = practitioners
                .findByCouncilCodeAndLicenseNoNormalized(council, licence)
                .orElseGet(() -> practitioners.save(new Practitioner(council, licence, fullName)));

        // At most one open case per practitioner. The partial unique index is
        // the real guard; this is the friendly answer before hitting it.
        cases.findFirstByPractitionerIdAndStatusNotInOrderBySubmittedAtDesc(practitioner.getId(), TERMINAL)
                .ifPresent(open -> {
                    throw new ClaimAlreadyOpenException(open.getId(), open.getSubmittedAt().toString());
                });

        // saveAndFlush, not save. JPA holds the insert in the persistence context
        // until the transaction commits, but the rule results and audit rows go
        // in through JdbcTemplate, which does not see that context: the foreign
        // key fails on a case row that Java thinks exists and Postgres has not
        // been told about yet.
        VerificationCase verificationCase = cases.saveAndFlush(
                new VerificationCase(practitioner.getId(), fullName, registrationNumber, council, specialty));

        List<Map<String, Object>> candidates = match(licence, council);
        verificationCase.setStatus(candidates.isEmpty() ? "NO_MATCH" : "RULES_EVAL");

        String decision;
        if (candidates.isEmpty()) {
            decision = "NO_MATCH";
            verificationCase.recordMatch(null, null, 0);
        } else {
            Map<String, Object> best = candidates.get(0);
            double nameScore = Normalizer.similarity(
                    claimedName, String.valueOf(best.get("full_name_normalized")));

            var results = rules.evaluate(best, claimedName, nameScore, candidates.size());
            decision = rules.decide(candidates.size(), results);

            verificationCase.recordMatch((UUID) best.get("id"), nameScore, candidates.size());
            saveRuleResults(verificationCase.getId(), results);
        }

        if ("APPROVED".equals(decision)) {
            approve(practitioner, verificationCase, "system", "All rules passed against the live registry.");
        } else {
            verificationCase.setStatus(decision.equals("REJECTED") ? "REJECTED" : decision);
            if ("REJECTED".equals(decision)) {
                verificationCase.decide("REJECTED", "system", "A rule failed against the live registry.");
            }
        }

        audit(verificationCase.getId(), "STATUS_CHANGE", "SYSTEM", null, "SUBMITTED", decision, null);
        cases.save(verificationCase);
        log.info("case {} decided {} against {} candidates",
                verificationCase.getId(), decision, verificationCase.getCandidateCount());
        return verificationCase;
    }

    /**
     * Exact match on the natural key. Normalization is applied identically to
     * the claim and to the registry row at ingest, so this is an index lookup
     * rather than a scan.
     */
    private List<Map<String, Object>> match(String licence, String council) {
        return jdbc.queryForList(
                "select id, license_no_raw, full_name_raw, full_name_normalized, council_code,"
                        + " status, valid_until, specialty_raw, source_batch"
                        + " from registry_records"
                        + " where council_code = ? and license_no_normalized = ?"
                        + " and present_in_latest_batch = true",
                council, licence);
    }

    /**
     * Issues the Immortal ID on the first approval, in the same transaction as
     * the status change. Section 8.2 warns that a unique violation aborts the
     * whole transaction in Postgres, so a retry loop has to live outside this
     * method; at 45 bits the retry path is an assertion, not a hot path.
     */
    private void approve(Practitioner practitioner, VerificationCase verificationCase,
                         String by, String reason) {
        boolean firstApproval = practitioner.getImmortalId() == null;
        if (firstApproval) {
            practitioner.issueImmortalId(ImmortalId.generate());
            practitioners.save(practitioner);
            audit(practitioner.getId(), "IMMORTAL_ID_ISSUED", "SYSTEM", "practitioner", null, null, null);
        }
        verificationCase.decide("APPROVED", by, reason);
    }

    @Transactional
    public VerificationCase decide(UUID caseId, String decision, String reason, String by) {
        if (reason == null || reason.trim().length() < 10) {
            throw new IllegalArgumentException("A reason of at least 10 characters is required.");
        }
        VerificationCase verificationCase = cases.findById(caseId)
                .orElseThrow(() -> new IllegalArgumentException("No case " + caseId));

        // Two reviewers opening the same case is normal. The second is told.
        if (verificationCase.getDecidedAt() != null) {
            throw new IllegalStateException("This case was already decided.");
        }

        Practitioner practitioner = practitioners.findById(verificationCase.getPractitionerId())
                .orElseThrow(() -> new IllegalStateException("Case has no practitioner"));

        if ("APPROVE".equals(decision)) {
            approve(practitioner, verificationCase, by, reason);
        } else {
            verificationCase.decide("REJECTED", by, reason);
        }

        audit(caseId, "MANUAL_DECISION", "USER", by, verificationCase.getStatus(),
                "APPROVE".equals(decision) ? "APPROVED" : "REJECTED", reason);
        return cases.save(verificationCase);
    }

    public List<VerificationCase> queue() {
        return cases.findByStatusInOrderBySubmittedAtAsc(OPEN);
    }

    public List<VerificationCase> all() {
        return cases.findAllByOrderBySubmittedAtDesc();
    }

    public VerificationCase require(UUID caseId) {
        return cases.findById(caseId)
                .orElseThrow(() -> new IllegalArgumentException("No case " + caseId));
    }

    public Practitioner practitionerFor(VerificationCase verificationCase) {
        return practitioners.findById(verificationCase.getPractitionerId()).orElseThrow();
    }

    public List<Map<String, Object>> ruleResults(UUID caseId) {
        return jdbc.queryForList(
                "select rule_code, outcome, detail from case_rule_results"
                        + " where case_id = ? order by rule_code", caseId);
    }

    public List<Map<String, Object>> auditFor(UUID subjectId) {
        return jdbc.queryForList(
                "select event_type, actor_type, actor_id, from_status, to_status, reason, created_at"
                        + " from audit_events where subject_id = ? order by created_at", subjectId);
    }

    /** Verified status is read live from the current case. No cached boolean. */
    public Map<String, Object> publicVerify(String immortalId) {
        var practitioner = practitioners.findByImmortalId(immortalId);
        if (practitioner.isEmpty()) {
            return Map.of();
        }
        var approved = cases.findByPractitionerIdOrderBySubmittedAtDesc(practitioner.get().getId())
                .stream().filter(c -> "APPROVED".equals(c.getStatus())).findFirst();
        if (approved.isEmpty()) {
            return Map.of();
        }
        return Map.of("case", approved.get(), "practitioner", practitioner.get());
    }

    private void saveRuleResults(UUID caseId, List<RuleEngine.Result> results) {
        for (RuleEngine.Result r : results) {
            jdbc.update("insert into case_rule_results (case_id, rule_code, outcome, detail)"
                    + " values (?,?,?,?) on conflict (case_id, rule_code) do nothing",
                    caseId, r.ruleCode(), r.outcome(), r.detail());
        }
    }

    private void audit(UUID subjectId, String eventType, String actorType, String actorId,
                       String from, String to, String reason) {
        jdbc.update("insert into audit_events (event_type, subject_type, subject_id, actor_type,"
                + " actor_id, from_status, to_status, reason) values (?,?,?,?,?,?,?,?)",
                eventType, "verification_case", subjectId, actorType, actorId, from, to, reason);
    }

    /** Carries the open case so the portal can link to it rather than dead ending. */
    public static class ClaimAlreadyOpenException extends RuntimeException {
        public final UUID caseId;
        public final String submittedAt;

        public ClaimAlreadyOpenException(UUID caseId, String submittedAt) {
            super("A claim is already open for this registration.");
            this.caseId = caseId;
            this.submittedAt = submittedAt;
        }
    }
}

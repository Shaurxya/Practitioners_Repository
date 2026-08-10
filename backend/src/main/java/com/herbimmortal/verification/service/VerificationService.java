package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.Council;
import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.repository.MedicalSystemRepository;
import com.herbimmortal.verification.repository.PractitionerRepository;
import com.herbimmortal.verification.repository.VerificationCaseRepository;
import com.herbimmortal.verification.util.Normalizer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

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

    /**
     * How many times to re-run a whole transaction that lost an Immortal ID race.
     *
     * Three, from section 8.3. The first attempt already picked a suffix nothing
     * held; losing it means another registration committed the same five
     * characters in the microseconds between. Two more attempts is generous for
     * an event whose lifetime probability across this register is around 1e-4.
     */
    private static final int ID_COLLISION_RETRIES = 3;

    private final JdbcTemplate jdbc;
    private final PractitionerRepository practitioners;
    private final VerificationCaseRepository cases;
    private final CouncilRepository councils;
    private final MedicalSystemRepository medicalSystems;
    private final RuleEngine rules;
    private final ImmortalIdIssuer idIssuer;
    private final DocumentService documents;
    private final IdentityService identityService;

    /**
     * A reference to this same bean, through the Spring proxy.
     *
     * This looks strange and it is load bearing. Spring implements
     * {@code @Transactional} by wrapping the bean in a proxy, so a transaction
     * begins only when a call arrives from outside. A plain {@code this.foo()}
     * inside the class skips the proxy entirely and the annotation does nothing.
     * The retry below has to sit outside the transaction boundary (section 8.3:
     * a unique violation aborts the whole Postgres transaction, so retrying
     * inside one cannot work), which means the retried call must go through the
     * proxy. {@code @Lazy} breaks the circular dependency this would otherwise
     * create at construction time.
     *
     * The FastAPI equivalent is calling the endpoint function directly rather
     * than through the router and wondering where your dependencies went.
     */
    private final VerificationService self;

    public VerificationService(JdbcTemplate jdbc, PractitionerRepository practitioners,
                               VerificationCaseRepository cases, CouncilRepository councils,
                               MedicalSystemRepository medicalSystems, RuleEngine rules,
                               ImmortalIdIssuer idIssuer, DocumentService documents,
                               IdentityService identityService, @Lazy VerificationService self) {
        this.jdbc = jdbc;
        this.practitioners = practitioners;
        this.cases = cases;
        this.councils = councils;
        this.medicalSystems = medicalSystems;
        this.rules = rules;
        this.idIssuer = idIssuer;
        this.documents = documents;
        this.identityService = identityService;
        this.self = self;
    }

    /**
     * Submit a claim. Deliberately NOT transactional: it is the retry loop, and
     * the thing it retries is the transaction.
     */
    public VerificationCase submit(String fullName, String registrationNumber, String council,
                                   String specialty, String country, String medicalSystem,
                                   UUID submittedByUserId,
                                   UUID photoIdDocumentId, UUID selfieDocumentId) {
        return withIdCollisionRetry(() -> self.submitOnce(fullName, registrationNumber, council,
                specialty, country, medicalSystem, submittedByUserId,
                photoIdDocumentId, selfieDocumentId));
    }

    @Transactional
    public VerificationCase submitOnce(String fullName, String registrationNumber, String council,
                                       String specialty, String country, String medicalSystem,
                                       UUID submittedByUserId,
                                       UUID photoIdDocumentId, UUID selfieDocumentId) {
        String licence = Normalizer.normalizeLicenseNumber(registrationNumber, council);
        String claimedName = Normalizer.normalizeName(fullName);
        String system = requireMedicalSystem(medicalSystem);
        String countryCode = resolveCountry(council, country);

        Practitioner practitioner = practitioners
                .findByCouncilCodeAndLicenseNoNormalized(council, licence)
                .orElseGet(() -> practitioners.save(new Practitioner(
                        council, licence, fullName, countryCode, system, submittedByUserId)));

        // A registration that already existed, from a registry row or from a
        // claim made before accounts, is attached to this account now. Claiming
        // one that belongs to someone else throws rather than taking it over:
        // two accounts on one licence is a mistake or an impersonation, and
        // silently moving a verified identity is the wrong answer to both.
        practitioner.claimBy(submittedByUserId);
        practitioners.save(practitioner);

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
                new VerificationCase(practitioner.getId(), submittedByUserId, fullName,
                        registrationNumber, council, specialty, countryCode, system));

        // Documents are linked before the rules run, so a case that ends up in
        // NO_MATCH still shows the reviewer the images. Ownership is re-checked
        // inside: the ids come from the client, and without that check a caller
        // could attach someone else's passport to their own claim.
        documents.linkToCase(verificationCase.getId(), submittedByUserId,
                List.of(photoIdDocumentId, selfieDocumentId).stream().filter(d -> d != null).toList());

        var identity = identityService.verify(verificationCase.getId(), submittedByUserId,
                fullName, photoIdDocumentId, selfieDocumentId);

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

            var results = rules.evaluate(best, claimedName, nameScore, candidates.size(), identity);
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
     * the status change.
     *
     * "First" is the whole rule. Section 8.1: issued exactly once, permanent,
     * and returned unchanged by a re-approval after an expiry or a revocation.
     * The null check is what makes that true, and {@code issueImmortalId} is a
     * no-op on a practitioner who already has one, so it holds even if this is
     * reached twice.
     *
     * The uniqueness retry deliberately does not live here. Section 8.3: a
     * unique violation aborts the entire Postgres transaction, so it has to be
     * caught outside this transaction boundary. See {@link #submit}.
     */
    private void approve(Practitioner practitioner, VerificationCase verificationCase,
                         String by, String reason) {
        boolean firstApproval = practitioner.getImmortalId() == null;
        if (firstApproval) {
            practitioner.issueImmortalId(idIssuer.issueFor(practitioner));
            practitioners.save(practitioner);
            // Its own event, separate from the STATUS_CHANGE for the same
            // transition. Issuance is a fact about a person; the transition is a
            // fact about a case, and they outlive each other.
            audit(practitioner.getId(), "IMMORTAL_ID_ISSUED", "SYSTEM", "practitioner",
                    null, practitioner.getImmortalId(), null);
        }
        verificationCase.decide("APPROVED", by, reason);
    }

    /**
     * The reference data a claim has to agree with, resolved server side.
     *
     * The council is the authority for the country. The form asks the
     * practitioner to pick one, but that answer only narrows the council list:
     * a Maharashtra council is in India whether or not the browser says so.
     * A mismatch is rejected rather than silently resolved, because either half
     * could be the mistake and picking one would hide a broken form.
     */
    private String resolveCountry(String councilCode, String claimedCountry) {
        Council found = councils.findById(councilCode)
                .orElseThrow(() -> new IllegalArgumentException(
                        "No council with code " + councilCode));

        if (claimedCountry != null && !claimedCountry.isBlank()
                && !found.getCountryCode().equalsIgnoreCase(claimedCountry.trim())) {
            throw new IllegalArgumentException(found.getCanonicalName() + " registers in "
                    + found.getCountryCode() + ", not " + claimedCountry.trim().toUpperCase(Locale.ROOT));
        }
        return found.getCountryCode();
    }

    /**
     * Checked against the table, not against a constant in Java. An unknown code
     * has to fail here rather than at the foreign key, because the message
     * "medical system X is not one we hold" is answerable and
     * "violates fk_practitioners_medical_system" is not.
     */
    private String requireMedicalSystem(String code) {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("Select a medical system.");
        }
        String normalized = code.trim().toUpperCase(Locale.ROOT);
        return medicalSystems.findById(normalized)
                .filter(m -> m.isEnabled())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Unknown medical system code: " + code))
                .getCode();
    }

    /**
     * Re-runs a whole transaction that lost the race for an Immortal ID.
     *
     * The generator asks the database whether its candidate is free, so getting
     * here means two registrations picked the same five characters in the gap
     * between that check and the commit. The UNIQUE constraint caught it, which
     * is exactly what it is for.
     *
     * The retry has to be out here rather than inside the transaction. In
     * Postgres a constraint violation aborts the transaction: every later
     * statement fails with "current transaction is aborted", and Hibernate's
     * persistence context is unusable after a ConstraintViolationException. A
     * fresh transaction is the only thing that works.
     */
    private <T> T withIdCollisionRetry(Supplier<T> attempt) {
        DataIntegrityViolationException last = null;

        for (int i = 1; i <= ID_COLLISION_RETRIES; i++) {
            try {
                return attempt.get();
            } catch (DataIntegrityViolationException e) {
                if (!isImmortalIdCollision(e)) {
                    // A different constraint. The open case index and the
                    // registration key both live on these tables, and retrying
                    // one of those would just fail again three times slower.
                    throw e;
                }
                last = e;
                log.warn("Immortal ID collided at commit, attempt {} of {}", i, ID_COLLISION_RETRIES);
            }
        }
        throw last;
    }

    /**
     * True only for losing the race for an identifier, which is the one failure
     * a fresh draw can fix.
     *
     * <p>The SQLSTATE is doing the real work here and it was missing. This used
     * to test whether any message in the chain contained the substring
     * "immortal_id", which is also true of the CHECK constraint
     * {@code practitioners_immortal_id_format}. A format violation is
     * deterministic: the same practitioner produces the same malformed value
     * every time, so the loop redrew a suffix three times, failed identically
     * three times, and logged "Immortal ID collided at commit" for a collision
     * that never happened. An operator reading that log would go looking for a
     * saturated prefix instead of the real fault.
     *
     * <p>23505 is unique_violation, 23514 is check_violation. Only the first is
     * worth another attempt. The name test stays because 23505 also covers
     * {@code uq_practitioner_open_case} and {@code uq_practitioner_registration},
     * and retrying either of those is the same wasted work in a different
     * costume.
     */
    private static boolean isImmortalIdCollision(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof java.sql.SQLException sql
                    && "23505".equals(sql.getSQLState())
                    && sql.getMessage() != null
                    && sql.getMessage().contains("immortal_id")) {
                return true;
            }
        }
        return false;
    }

    /** Not transactional, for the same reason {@link #submit} is not: it is the retry. */
    public VerificationCase decide(UUID caseId, String decision, String reason, String by) {
        return withIdCollisionRetry(() -> self.decideOnce(caseId, decision, reason, by));
    }

    @Transactional
    public VerificationCase decideOnce(UUID caseId, String decision, String reason, String by) {
        if (reason == null || reason.trim().length() < 10) {
            throw new IllegalArgumentException("A reason of at least 10 characters is required.");
        }
        VerificationCase verificationCase = cases.findById(caseId)
                .orElseThrow(() -> new CaseNotFoundException(caseId));

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

    /** Every case, for the console. Never reachable from a practitioner facing endpoint. */
    public List<VerificationCase> all() {
        return cases.findAllByOrderBySubmittedAtDesc();
    }

    /** One person's own claims. What GET /api/v1/verifications answers. */
    public List<VerificationCase> mine(UUID userId) {
        return cases.findBySubmittedByUserIdOrderBySubmittedAtDesc(userId);
    }

    public VerificationCase require(UUID caseId) {
        return cases.findById(caseId)
                .orElseThrow(() -> new CaseNotFoundException(caseId));
    }

    /**
     * One case, if this caller is allowed to see it.
     *
     * <p>A reviewer or admin sees any case, because working the queue is the
     * job. Anyone else sees only their own, and a case belonging to someone
     * else is reported as <b>not found</b> rather than forbidden.
     *
     * <p>That is section 7.3 and it is not pedantry: 403 on someone else's case
     * id and 404 on a made up one is an oracle. A caller walking ids learns
     * exactly which ones exist, without ever seeing their contents.
     */
    public VerificationCase requireVisibleTo(UUID caseId, UUID userId, boolean canReviewAnyCase) {
        VerificationCase found = require(caseId);
        if (canReviewAnyCase || found.isOwnedBy(userId)) {
            return found;
        }
        throw new CaseNotFoundException(caseId);
    }

    /** Distinct from IllegalArgumentException so the handler can answer 404, not 400. */
    public static class CaseNotFoundException extends RuntimeException {
        public CaseNotFoundException(UUID caseId) {
            super("No case " + caseId);
        }
    }

    public Practitioner practitionerFor(VerificationCase verificationCase) {
        return practitioners.findById(verificationCase.getPractitionerId()).orElseThrow();
    }

    public List<Map<String, Object>> ruleResults(UUID caseId) {
        return jdbc.queryForList(
                "select rule_code, outcome, detail from case_rule_results"
                        + " where case_id = ? order by rule_code", caseId);
    }

    /**
     * The registry rows this case matched, for the review console.
     *
     * Returned even when there is exactly one: a reviewer deciding a case needs
     * to see the row they are deciding against, not be told a count. The console
     * shows "no registry rows matched" when this is empty, so returning nothing
     * for a case that did match is a contradiction on screen.
     */
    public List<Map<String, Object>> candidatesFor(VerificationCase verificationCase) {
        if (verificationCase.getMatchedRegistryRecordId() == null) {
            return List.of();
        }
        return jdbc.queryForList(
                "select id, license_no_raw, full_name_raw, council_code, status, valid_until,"
                        + " specialty_raw, source_batch, synced_at, present_in_latest_batch"
                        + " from registry_records where id = ?",
                verificationCase.getMatchedRegistryRecordId());
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

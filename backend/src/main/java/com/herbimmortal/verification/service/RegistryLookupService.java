package com.herbimmortal.verification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.herbimmortal.verification.domain.Council;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.util.Normalizer;
import com.herbimmortal.verification.util.TtlCache;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Answers "is this registration on the register" without handing out the
 * register.
 *
 * <p>This is the step 1 of the claim wizard: a practitioner types their council
 * and registration number and is told whether we hold a matching entry, before
 * filling in anything else. The whole difficulty is that the obvious
 * implementation, returning the matched row, is a registry scraper with a
 * login. See {@link #mask} and the budget below for what stops that.
 *
 * <p><b>This service never decides anything.</b> It does not create a case, it
 * does not run a rule, and the record it found is deliberately not carried
 * forward to submit. {@code VerificationService.submitOnce} re-matches from
 * scratch, because a batch can be promoted between the two calls and
 * {@code registry_snapshot} has to hold what was true at decision time. This is
 * a hint for a human filling in a form, nothing more.
 */
@Service
public class RegistryLookupService {

    private static final Logger log = LoggerFactory.getLogger(RegistryLookupService.class);

    /**
     * Lookups per account per hour.
     *
     * <p>Twenty is roughly ten times what an honest claim needs, including
     * mistyping the number a few times and coming back tomorrow, and far below
     * what makes walking a council's number space worthwhile. It is a starting
     * value to be tuned against real traffic, not a derived one.
     */
    private static final int LOOKUPS_PER_HOUR = 20;

    /**
     * Fixed window, not a sliding one.
     *
     * <p>The known weakness: an account can spend its budget at 10:59 and again
     * at 11:00, so forty in two minutes is reachable. A sliding window would
     * close that and needs a timestamp list per account rather than one integer.
     * Forty is still not a harvest, so the simpler structure wins until the
     * audit log shows someone actually doing it.
     *
     * <p>Per instance, like every other in memory limit here. D5 records that
     * this multiplies by instance count and moves to Redis at instance two.
     */
    private final TtlCache<UUID, AtomicInteger> budget =
            new TtlCache<>(Duration.ofHours(1), 10_000);

    private final JdbcTemplate jdbc;
    private final CouncilRepository councils;
    private final ObjectMapper json;

    public RegistryLookupService(JdbcTemplate jdbc, CouncilRepository councils, ObjectMapper json) {
        this.jdbc = jdbc;
        this.councils = councils;
        this.json = json;
    }

    /** FOUND, NOT_FOUND or AMBIGUOUS. The UI offers a different next action for each. */
    public enum Outcome { FOUND, NOT_FOUND, AMBIGUOUS }

    /**
     * Every field is populated on FOUND and is an empty string otherwise.
     *
     * <p>Section 7.2's rule, applied here: a field present only on the found
     * branch leaks existence through the response <i>shape</i>, which is the
     * version of that bug that survives a review of the values. The outcome code
     * itself does differ between the three, unlike the public verify endpoint
     * where unknown and unverified are byte for byte identical, because the UI
     * has to offer a different next action. What makes that acceptable here is
     * that this endpoint costs a login and a budget to query.
     */
    public record LookupResult(Outcome outcome, String councilName, String maskedName,
                               String standing, String asOfBatch) {

        static LookupResult empty(Outcome outcome) {
            return new LookupResult(outcome, "", "", "", "");
        }
    }

    /**
     * The budget is spent before anything is validated, so a caller cannot probe
     * with malformed input for free.
     *
     * <p>Which makes the catch necessary rather than tidy. A rejected request
     * has still consumed one of the twenty, and an operator reading the audit
     * log to work out what an account did needs those two numbers to agree.
     * Without this, an account that spent its whole budget on invalid councils
     * left no trace at all.
     */
    public LookupResult lookup(String councilCode, String registrationNumber, UUID userId) {
        spendBudget(userId);
        try {
            return lookupOnce(councilCode, registrationNumber, userId);
        } catch (IllegalArgumentException e) {
            auditRejected(userId, councilCode);
            throw e;
        }
    }

    private LookupResult lookupOnce(String councilCode, String registrationNumber, UUID userId) {
        Council council = councils.findById(councilCode)
                .orElseThrow(() -> new IllegalArgumentException("No council with code " + councilCode));

        String licence = Normalizer.normalizeLicenseNumber(registrationNumber, councilCode);
        if (licence.isEmpty()) {
            throw new IllegalArgumentException("Enter your registration number.");
        }

        List<Map<String, Object>> rows = jdbc.queryForList(
                "select full_name_normalized, status, source_batch"
                        + " from registry_records"
                        + " where council_code = ? and license_no_normalized = ?"
                        + " and present_in_latest_batch = true",
                councilCode, licence);

        Outcome outcome = rows.isEmpty() ? Outcome.NOT_FOUND
                : rows.size() == 1 ? Outcome.FOUND
                : Outcome.AMBIGUOUS;

        audit(userId, councilCode, licence, outcome, rows.size());

        // AMBIGUOUS reveals nothing, not even the count. Showing a claimant two
        // masked names side by side would let them pick the one they wanted to
        // be, which is the opposite of what a name check is for. They are told a
        // person will look at it, and SINGLE_CANDIDATE routes the case to
        // MANUAL_REVIEW at submit exactly as it does today.
        if (outcome != Outcome.FOUND) {
            return LookupResult.empty(outcome);
        }

        Map<String, Object> row = rows.get(0);
        return new LookupResult(
                Outcome.FOUND,
                council.getCanonicalName(),
                mask(String.valueOf(row.get("full_name_normalized"))),
                standing(String.valueOf(row.get("status"))),
                String.valueOf(row.get("source_batch")));
    }

    /**
     * First character of each name part, then a fixed four bullets.
     *
     * <pre>
     *   "ANAND SHARMA"        -> "A•••• S••••"
     *   "MEERA RAJAN NAIR"    -> "M•••• R•••• N••••"
     * </pre>
     *
     * <p>Fixed width on purpose. Bullets that track the real length leak it, and
     * name length plus council plus initials narrows a real person a great deal
     * more than it looks like it does.
     *
     * <p>The input is the normalized name, so titles and qualifications are
     * already gone. Masking the raw value would render "Dr Anand Sharma" as
     * "D•••• A•••• S••••", where the first initial belongs to the title and the
     * person cannot recognise themselves.
     *
     * <p>This is what makes the reveal safe enough to ship, and it is also why
     * step 2 asks the person to <i>type</i> their full name rather than
     * confirming a prefilled one. A prefilled name would score NAME_MATCH 1.00
     * against a string we handed them, and that rule is required.
     */
    static String mask(String normalizedName) {
        if (normalizedName == null || normalizedName.isBlank()) {
            return "";
        }
        StringBuilder masked = new StringBuilder();
        for (String part : normalizedName.trim().split("\\s+")) {
            if (part.isEmpty()) {
                continue;
            }
            if (!masked.isEmpty()) {
                masked.append(' ');
            }
            masked.append(part.charAt(0)).append("••••");
        }
        return masked.toString();
    }

    /**
     * Three values out of the registry's six, and the collapse is deliberate.
     *
     * <p>The register distinguishes SUSPENDED, REVOKED, EXPIRED and INACTIVE.
     * At lookup time we do not yet know that the person typing is the person on
     * the row, so telling them which one would disclose a named practitioner's
     * disciplinary history to anyone who guessed their number. NOT_ACTIVE says
     * the only part they need in order to decide whether to continue.
     *
     * <p>Nothing is lost downstream. LICENSE_ACTIVE and NOT_SANCTIONED read the
     * real status at submit, and the review console shows the reviewer the whole
     * row.
     */
    private static String standing(String registryStatus) {
        return switch (registryStatus.toUpperCase(Locale.ROOT)) {
            case "ACTIVE" -> "ACTIVE";
            case "UNKNOWN" -> "UNKNOWN";
            default -> "NOT_ACTIVE";
        };
    }

    /**
     * Increments this account's hourly count and refuses past the cap.
     *
     * <p>{@code TtlCache.get(key, loader)} is read through: it creates the
     * counter on a miss and the entry expires an hour after that creation.
     * Incrementing the AtomicInteger afterwards does not touch the expiry, which
     * is what makes this a window from first lookup rather than a rolling reset
     * that would never expire for an active account.
     */
    private void spendBudget(UUID userId) {
        AtomicInteger used = budget.get(userId, key -> new AtomicInteger());
        int count = used.incrementAndGet();

        if (count <= LOOKUPS_PER_HOUR) {
            return;
        }

        // Audited once per window, on the transition from allowed to refused,
        // rather than on every refused request. Auditing each one would let an
        // account that ignores the 429 write unbounded rows into the audit
        // table, which turns a rate limit into a way to fill a disk. One row
        // carries the whole signal: this account blew its budget.
        if (count == LOOKUPS_PER_HOUR + 1) {
            log.warn("account {} exhausted its lookup budget", userId);
            write(userId, "REGISTRY_LOOKUP_REFUSED",
                    Map.of("refused", true, "limit", LOOKUPS_PER_HOUR));
        }
        throw new LookupBudgetExceededException();
    }

    /**
     * Records what was searched, not just that a search happened.
     *
     * <p>The point of this log is answering "is this account walking the number
     * space", and an event that omits the number cannot answer it.
     */
    private void audit(UUID userId, String councilCode, String licence,
                       Outcome outcome, int candidateCount) {
        write(userId, "REGISTRY_LOOKUP", Map.of(
                "council", councilCode,
                "licenceNormalized", licence,
                "outcome", outcome.name(),
                "candidateCount", candidateCount));
    }

    /** Budget spent, nothing searched. The council is recorded, the bad input is not. */
    private void auditRejected(UUID userId, String councilCode) {
        write(userId, "REGISTRY_LOOKUP_REJECTED",
                Map.of("council", String.valueOf(councilCode), "rejected", true));
    }

    /**
     * One insert, and it must never be the reason a lookup fails.
     *
     * <p>The subject is the account doing the searching. There is no registry
     * record to point at when nothing was found, and an event that existed only
     * for successful lookups is exactly the one an enumeration would not appear
     * in.
     *
     * <p>Facts go in metadata as addressable keys rather than into reason as
     * free text, so a later erasure can redact one field instead of destroying
     * the row. Section 10.
     */
    private void write(UUID userId, String eventType, Map<String, Object> metadata) {
        try {
            jdbc.update("insert into audit_events (event_type, subject_type, subject_id,"
                            + " actor_type, actor_id, metadata) values (?,?,?,?,?,?::jsonb)",
                    eventType, "user", userId, "USER", userId.toString(),
                    json.writeValueAsString(metadata));
        } catch (Exception e) {
            // A lookup is a read. Failing it because the audit insert broke
            // would turn a logging fault into an outage of the claim flow, and
            // this still leaves the operator a record in the application log.
            log.error("could not write {} audit event for {}", eventType, userId, e);
        }
    }

    /** Distinct type so the handler can answer 429 rather than a generic 400. */
    public static class LookupBudgetExceededException extends RuntimeException {
        public LookupBudgetExceededException() {
            super("Too many lookups. Try again in an hour.");
        }
    }
}

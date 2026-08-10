package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.repository.PractitionerRepository;
import com.herbimmortal.verification.util.ImmortalId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.ZoneOffset;

/**
 * Turns a practitioner into an unused Immortal ID.
 *
 * <p>One job, in one place, so the HTTP path, the review console and any future
 * bulk import all issue identifiers the same way. {@code @Service} makes it a
 * Spring managed singleton: the FastAPI equivalent is a module level object you
 * pass around with Depends, except Spring wires it into constructors for you.
 *
 * <h2>Uniqueness, and why the loop alone is not enough</h2>
 *
 * The five random characters are drawn from 36^5 = 60,466,176 values, and that
 * space is per prefix rather than global: everyone registered in the same year,
 * country and medical system draws from one bucket. So this class does the
 * obvious thing and asks the database whether the candidate is taken before
 * handing it back.
 *
 * <p>That check is necessary and it is not sufficient. Two concurrent
 * registrations can both SELECT "not taken" for the same value and both proceed,
 * because nothing between the read and the write stops the other one. The
 * database's UNIQUE constraint is what actually decides, and the loser gets a
 * {@code DataIntegrityViolationException} at commit.
 *
 * <p>Which is why the retry does not live here. Section 8.3: in Postgres a
 * unique violation aborts the whole transaction, so catching it and looping
 * inside the same {@code @Transactional} method does not work. The next
 * statement fails with "current transaction is aborted", and Hibernate's
 * persistence context is unusable afterwards. The caller retries in a fresh
 * transaction instead. See {@link VerificationService#submit}.
 *
 * <p>This class holds no mutable state and {@code SecureRandom} inside
 * {@link ImmortalId} is thread safe, so concurrent registrations need no
 * locking here.
 */
@Service
public class ImmortalIdIssuer {

    private static final Logger log = LoggerFactory.getLogger(ImmortalIdIssuer.class);

    /**
     * How many times to redraw the suffix before giving up.
     *
     * Twelve is not tuning, it is a tripwire. At any realistic occupancy of a
     * 60 million bucket the first draw is free; needing twelve means the bucket
     * is close to full, and the right response to that is an alert and a
     * conversation about widening the format, not a longer loop that hides it.
     */
    private static final int MAX_ATTEMPTS = 12;

    private final PractitionerRepository practitioners;
    private final Clock clock;

    /**
     * {@code @Autowired} is required here, not decoration. Spring picks a
     * constructor automatically only when a class has exactly one; with two it
     * looks for a no-arg constructor, finds none, and the whole context fails
     * to start. This annotation says which one to wire.
     */
    @Autowired
    public ImmortalIdIssuer(PractitionerRepository practitioners) {
        this(practitioners, Clock.systemDefaultZone());
    }

    /**
     * The clock is injectable so a test can pin the registration year. A test
     * that asserts on {@code Year.now()} passes today and fails on 1 January.
     */
    ImmortalIdIssuer(PractitionerRepository practitioners, Clock clock) {
        this.practitioners = practitioners;
        this.clock = clock;
    }

    /**
     * An ID for this practitioner that nothing else holds yet.
     *
     * <p>The prefix is computed once. Only the five random characters are
     * redrawn on a clash, because the other four are facts and redrawing them
     * would produce an identifier that lies about the person it belongs to.
     */
    public String issueFor(Practitioner practitioner) {
        int year = clock.instant().atZone(ZoneOffset.systemDefault()).getYear();
        String prefix = ImmortalId.prefix(year,
                practitioner.getCountryCode(), practitioner.getMedicalSystemCode());

        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            String candidate = prefix + ImmortalId.randomSuffix();

            if (!practitioners.existsByImmortalId(candidate)) {
                if (attempt > 1) {
                    // Worth a line in the log. This is the path that is supposed
                    // to be unreachable, so seeing it means the assumption about
                    // bucket occupancy needs revisiting.
                    log.warn("Immortal ID suffix collided {} time(s) under prefix {}",
                            attempt - 1, prefix);
                }
                return candidate;
            }
        }

        throw new IdSpaceExhaustedException(prefix, MAX_ATTEMPTS);
    }

    /**
     * Thrown when the random space under one prefix is too full to draw from.
     *
     * A distinct type rather than IllegalStateException because it means
     * something specific and actionable: the format needs more characters, or
     * the prefix needs to be narrower. Nothing should catch and retry it.
     */
    public static class IdSpaceExhaustedException extends RuntimeException {
        public IdSpaceExhaustedException(String prefix, int attempts) {
            super("Could not find a free Immortal ID under " + prefix + " in "
                    + attempts + " attempts. That prefix is saturated.");
        }
    }
}

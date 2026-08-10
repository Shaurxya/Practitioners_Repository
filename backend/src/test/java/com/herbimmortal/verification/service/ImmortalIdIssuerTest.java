package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.repository.PractitionerRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The uniqueness loop.
 *
 * The repository is a mock rather than a real database, deliberately. What is
 * under test is the decision the issuer makes when a value is taken, and a real
 * table would make provoking that decision a matter of generating 60 million
 * rows. The database's own half of the guarantee, the UNIQUE constraint, is
 * exercised by the Testcontainers lifecycle suite instead.
 */
class ImmortalIdIssuerTest {

    /** 2026-08-06, so the assertions do not change on 1 January. */
    private static final Clock FIXED =
            Clock.fixed(Instant.parse("2026-08-06T10:15:30Z"), ZoneOffset.UTC);

    private static Practitioner practitioner(String country, String system) {
        // Null owner: a registration with no account attached is a normal state,
        // and the issuer has no business caring which account claimed it.
        return new Practitioner("MH", "MH28409", "Anita Sharma", country, system, null);
    }

    @Test
    void issuesAnIdCarryingTheYearCountryAndSystem() {
        var repository = mock(PractitionerRepository.class);
        when(repository.existsByImmortalId(anyString())).thenReturn(false);

        String id = new ImmortalIdIssuer(repository, FIXED).issueFor(practitioner("IN", "A"));

        assertThat(id).startsWith("HI-26INA-");
        assertThat(id).matches("^HI-26INA-[A-Z0-9]{5}$");
    }

    @Test
    void readsTheYearFromTheClockRatherThanTheCalendar() {
        var repository = mock(PractitionerRepository.class);
        when(repository.existsByImmortalId(anyString())).thenReturn(false);

        Clock later = Clock.fixed(Instant.parse("2031-01-01T00:00:01Z"), ZoneOffset.UTC);
        assertThat(new ImmortalIdIssuer(repository, later).issueFor(practitioner("US", "T")))
                .startsWith("HI-31UST-");
    }

    @Test
    void regeneratesOnlyTheSuffixWhenTheIdIsTaken() {
        var repository = mock(PractitionerRepository.class);
        var seen = new HashSet<String>();
        var attempts = new AtomicInteger();

        // The first three candidates are taken, the fourth is free.
        when(repository.existsByImmortalId(anyString())).thenAnswer(call -> {
            seen.add(call.getArgument(0));
            return attempts.incrementAndGet() <= 3;
        });

        String id = new ImmortalIdIssuer(repository, FIXED).issueFor(practitioner("IN", "U"));

        assertThat(attempts.get()).isEqualTo(4);
        assertThat(id).startsWith("HI-26INU-");
        // Every rejected candidate carried the same prefix. Redrawing the four
        // fixed characters would produce an identifier that lies about the
        // person it belongs to, which is worse than a collision.
        assertThat(seen).allSatisfy(candidate -> assertThat(candidate).startsWith("HI-26INU-"));
        assertThat(seen).hasSize(4);
    }

    @Test
    void givesUpLoudlyWhenAPrefixIsSaturated() {
        var repository = mock(PractitionerRepository.class);
        when(repository.existsByImmortalId(anyString())).thenReturn(true);

        // A loop that never terminates is the wrong answer to a full bucket, and
        // so is a silent duplicate. This is an ops alert, not a retry.
        assertThatThrownBy(() -> new ImmortalIdIssuer(repository, FIXED).issueFor(practitioner("IN", "A")))
                .isInstanceOf(ImmortalIdIssuer.IdSpaceExhaustedException.class)
                .hasMessageContaining("HI-26INA-");
    }

    /**
     * Concurrent registrations, against a repository that actually remembers
     * what it was told.
     *
     * This is the closest a unit test gets to the real race. It proves the
     * issuer holds no state that two threads can corrupt and that a value
     * already recorded is never handed out again. It does NOT prove the system
     * cannot issue a duplicate: two threads can still both be told "free" for
     * the same value before either records it, and the database's UNIQUE
     * constraint plus the retry in VerificationService is what covers that gap.
     */
    @Test
    void isSafeUnderConcurrentRegistrations() throws Exception {
        Set<String> taken = ConcurrentHashMap.newKeySet();
        var repository = mock(PractitionerRepository.class);
        when(repository.existsByImmortalId(anyString()))
                .thenAnswer(call -> taken.contains(call.<String>getArgument(0)));

        var issuer = new ImmortalIdIssuer(repository, FIXED);
        int threads = 16;
        int perThread = 40;

        Set<String> issued = Collections.synchronizedSet(new HashSet<>());
        var start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);

        for (int t = 0; t < threads; t++) {
            pool.submit(() -> {
                start.await();
                for (int i = 0; i < perThread; i++) {
                    String id = issuer.issueFor(practitioner("IN", "A"));
                    // Stands in for the INSERT. synchronized so the check and
                    // the record are one step, which is what the UNIQUE
                    // constraint does in the real thing.
                    synchronized (taken) {
                        assertThat(taken).doesNotContain(id);
                        taken.add(id);
                    }
                    issued.add(id);
                }
                return null;
            });
        }

        start.countDown();
        pool.shutdown();
        assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();

        assertThat(issued).hasSize(threads * perThread);
        assertThat(issued).allSatisfy(id -> assertThat(id).matches("^HI-26INA-[A-Z0-9]{5}$"));
    }
}

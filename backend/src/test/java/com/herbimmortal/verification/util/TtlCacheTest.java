package com.herbimmortal.verification.util;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The cache in front of the API key lookup and the login attempt counter.
 *
 * <p>Two properties matter and both are security properties rather than
 * performance ones: an entry must actually expire, because the TTL is the
 * maximum delay between revoking a key and it stopping, and the map must not
 * grow without bound, because it is keyed on values an anonymous caller
 * supplies.
 */
class TtlCacheTest {

    @Test
    void returnsWhatWasPutIn() {
        var cache = new TtlCache<String, String>(Duration.ofMinutes(1), 10);
        cache.put("k", "v");
        assertThat(cache.get("k")).isEqualTo("v");
    }

    @Test
    void missesAreNull() {
        var cache = new TtlCache<String, String>(Duration.ofMinutes(1), 10);
        assertThat(cache.get("absent")).isNull();
    }

    @Test
    void entriesExpire() throws Exception {
        // The TTL is the revocation delay for an API key, so an entry that
        // outlives it is a revoked key that still works.
        var cache = new TtlCache<String, String>(Duration.ofMillis(50), 10);
        cache.put("k", "v");
        assertThat(cache.get("k")).isEqualTo("v");

        Thread.sleep(80);
        assertThat(cache.get("k")).isNull();
    }

    @Test
    void invalidateIsImmediate() {
        // Revoking on this instance must not wait for the TTL.
        var cache = new TtlCache<String, String>(Duration.ofMinutes(10), 10);
        cache.put("k", "v");
        cache.invalidate("k");
        assertThat(cache.get("k")).isNull();
    }

    @Test
    void neverGrowsPastItsBound() {
        // Keyed on caller supplied values, so unbounded growth is a memory
        // exhaustion bug rather than a tuning question.
        var cache = new TtlCache<String, Integer>(Duration.ofMinutes(10), 16);
        for (int i = 0; i < 10_000; i++) {
            cache.put("key-" + i, i);
        }
        assertThat(cache.size()).isLessThanOrEqualTo(16);
    }

    @Test
    void loaderRunsOnlyOnAMiss() {
        var cache = new TtlCache<String, String>(Duration.ofMinutes(1), 10);
        var calls = new AtomicInteger();

        for (int i = 0; i < 5; i++) {
            cache.get("k", key -> {
                calls.incrementAndGet();
                return "loaded";
            });
        }
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void aLoaderReturningNullIsNotCached() {
        // An absent key is exactly what an attacker probes repeatedly. Caching
        // the absence would be the useful thing here, and not caching it is the
        // deliberate cost of never letting a miss look like a hit.
        var cache = new TtlCache<String, String>(Duration.ofMinutes(1), 10);
        var calls = new AtomicInteger();

        for (int i = 0; i < 3; i++) {
            assertThat(cache.get("missing", key -> {
                calls.incrementAndGet();
                return null;
            })).isNull();
        }
        assertThat(calls.get()).isEqualTo(3);
    }

    @Test
    void survivesConcurrentUse() throws Exception {
        var cache = new TtlCache<String, Integer>(Duration.ofSeconds(30), 1_000);
        int threads = 16;
        var start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(threads);

        for (int t = 0; t < threads; t++) {
            final int id = t;
            pool.submit(() -> {
                start.await();
                for (int i = 0; i < 500; i++) {
                    cache.put("k" + (i % 50), id);
                    cache.get("k" + (i % 50));
                }
                return null;
            });
        }
        start.countDown();
        pool.shutdown();

        assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        assertThat(cache.size()).isLessThanOrEqualTo(1_000);
    }

    @Test
    void refusesNonsenseConfiguration() {
        assertThatThrownBy(() -> new TtlCache<>(Duration.ZERO, 10))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new TtlCache<>(Duration.ofMinutes(1), 0))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

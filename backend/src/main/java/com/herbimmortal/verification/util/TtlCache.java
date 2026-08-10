package com.herbimmortal.verification.util;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * A bounded map whose entries expire. That is the whole feature.
 *
 * <p>Two things in this service want caching and neither wants a cache library:
 * the API key lookup, so a request authenticated by a key does not read Postgres
 * on every call, and the login attempt counter, which has to survive between
 * requests but must not survive a restart. Both are "remember this for N
 * minutes, and never grow without limit".
 *
 * <h2>Why bounded matters more than the eviction policy</h2>
 *
 * Both caches are keyed on something an anonymous caller controls: a supplied
 * API key, an attempted email address. An unbounded map keyed on attacker input
 * is a memory exhaustion bug with extra steps. So there is a hard cap, and when
 * it is reached the cache clears rather than evicting cleverly.
 *
 * <p>Clearing wholesale sounds crude and is the right trade here. Reaching the
 * cap means either a flood of distinct keys, in which case the cache was going
 * to miss on everything anyway, or the cap is too small and should be raised.
 * An LRU would spend memory on bookkeeping to serve a workload that, at this
 * size, does not have a working set worth tracking. The correctness of the
 * system never depends on a hit: every caller re-reads the database on a miss.
 *
 * <h2>What this is not</h2>
 *
 * Not distributed. Two instances have two caches, which is fine for the key
 * lookup (both read the same table) and is a real weakness for the attempt
 * counter (an attacker gets N tries per instance). That is the same limitation
 * D5 records for in memory rate limiting, and it moves to Redis at the same
 * moment and for the same reason.
 */
public final class TtlCache<K, V> {

    private record Entry<V>(V value, long expiresAtNanos) {
        boolean isLive(long now) {
            return now < expiresAtNanos;
        }
    }

    private final ConcurrentHashMap<K, Entry<V>> entries = new ConcurrentHashMap<>();
    private final long ttlNanos;
    private final int maxEntries;

    /** Cleanup is amortised across writes rather than run on a timer thread. */
    private final AtomicLong writesSinceSweep = new AtomicLong();
    private static final int SWEEP_EVERY = 256;

    public TtlCache(Duration ttl, int maxEntries) {
        if (ttl.isNegative() || ttl.isZero()) {
            throw new IllegalArgumentException("TTL must be positive");
        }
        if (maxEntries < 1) {
            throw new IllegalArgumentException("maxEntries must be at least 1");
        }
        this.ttlNanos = ttl.toNanos();
        this.maxEntries = maxEntries;
    }

    /** Null when absent or expired. An expired entry is removed as it is read. */
    public V get(K key) {
        Entry<V> entry = entries.get(key);
        if (entry == null) {
            return null;
        }
        if (!entry.isLive(System.nanoTime())) {
            // Remove the exact entry we read. remove(key) alone would drop a
            // fresher value written by another thread between the read and here.
            entries.remove(key, entry);
            return null;
        }
        return entry.value();
    }

    public void put(K key, V value) {
        if (entries.size() >= maxEntries) {
            sweepExpired();
            if (entries.size() >= maxEntries) {
                // Still full of live entries. See the class comment: clearing
                // costs a cold cache, growing costs the process.
                entries.clear();
            }
        }
        entries.put(key, new Entry<>(value, System.nanoTime() + ttlNanos));

        if (writesSinceSweep.incrementAndGet() % SWEEP_EVERY == 0) {
            sweepExpired();
        }
    }

    /**
     * Read through. The loader runs on a miss, and its null return is cached as
     * an absence would not be: a lookup for a key that does not exist is
     * exactly the request an attacker repeats, and re-reading the database for
     * every one of them is the cost this cache exists to avoid.
     */
    public V get(K key, Function<K, V> loader) {
        V cached = get(key);
        if (cached != null) {
            return cached;
        }
        V loaded = loader.apply(key);
        if (loaded != null) {
            put(key, loaded);
        }
        return loaded;
    }

    public void invalidate(K key) {
        entries.remove(key);
    }

    public void clear() {
        entries.clear();
    }

    public int size() {
        sweepExpired();
        return entries.size();
    }

    private void sweepExpired() {
        long now = System.nanoTime();
        for (Map.Entry<K, Entry<V>> entry : entries.entrySet()) {
            if (!entry.getValue().isLive(now)) {
                entries.remove(entry.getKey(), entry.getValue());
            }
        }
    }
}

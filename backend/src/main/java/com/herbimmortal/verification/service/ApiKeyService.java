package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.ApiKey;
import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import com.herbimmortal.verification.domain.UserStatus;
import com.herbimmortal.verification.repository.ApiKeyRepository;
import com.herbimmortal.verification.repository.UserRepository;
import com.herbimmortal.verification.security.AuthProperties;
import com.herbimmortal.verification.security.Digests;
import com.herbimmortal.verification.security.JwtService;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.util.TtlCache;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Mints, resolves and revokes API keys.
 *
 * <h2>The key is shown once</h2>
 *
 * {@link #create} is the only moment the full key exists outside the caller's
 * hands. The database gets a SHA-256 digest and a short non secret prefix, so
 * nobody, including us, can read a key back afterwards. "I lost my key" is
 * answered by issuing a new one and revoking the old, which is the only honest
 * answer a system that stores digests can give.
 *
 * <h2>Why there is a cache in front of the lookup</h2>
 *
 * An API key is checked on every request that uses it, and unlike a JWT it has
 * to be looked up, because it is revocable. Without a cache, a machine polling
 * once a second reads the users and api_keys tables once a second forever, and
 * the account page's "is this key still used" column turns every read into a
 * write.
 *
 * <p>The cache TTL is therefore two things at once: how much database traffic is
 * avoided, and the maximum delay between revoking a key and the revocation
 * taking effect. Sixty seconds by default. {@link #revoke} evicts the entry
 * directly, so the delay only applies to a revocation that happened on another
 * instance.
 */
@Service
public class ApiKeyService {

    private static final Logger log = LoggerFactory.getLogger(ApiKeyService.class);

    /**
     * hi_live_ marks this as a HerbImmortal credential to a secret scanner
     * reading a commit or a paste. An opaque base64 blob is invisible to every
     * one of them, and the first person to notice would be whoever found it.
     */
    private static final String KEY_PREFIX = "hi_live_";

    /** Characters of the random body kept as the visible handle in a key list. */
    private static final int VISIBLE_CHARS = 6;

    /** One person does not need more than this, and a runaway script does. */
    private static final int MAX_LIVE_KEYS_PER_USER = 20;

    private final ApiKeyRepository apiKeys;
    private final UserRepository users;
    private final JwtService jwt;
    private final AuthProperties properties;

    /**
     * Digest of the presented key, to the caller it authenticates.
     *
     * Keyed on the digest rather than the key so the cache never holds a usable
     * credential in memory. Bounded, because the key is supplied by an
     * anonymous caller and an unbounded map keyed on attacker input is a memory
     * exhaustion bug.
     */
    private final TtlCache<String, UserPrincipal> resolved;

    public ApiKeyService(ApiKeyRepository apiKeys, UserRepository users,
                         JwtService jwt, AuthProperties properties) {
        this.apiKeys = apiKeys;
        this.users = users;
        this.jwt = jwt;
        this.properties = properties;
        this.resolved = new TtlCache<>(properties.apiKeyCacheTtl(), 10_000);
    }

    /** The full key, returned once and never recoverable. */
    public record Created(ApiKey record, String plaintextKey) {
    }

    @Transactional
    public Created create(UUID userId, String name, Duration ttl) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Give the key a name you will recognise later.");
        }
        if (apiKeys.countByUserIdAndRevokedAtIsNull(userId) >= MAX_LIVE_KEYS_PER_USER) {
            throw new IllegalArgumentException(
                    "You already have " + MAX_LIVE_KEYS_PER_USER + " live keys. Revoke one first.");
        }

        String body = jwt.randomSecret();
        String plaintext = KEY_PREFIX + body;
        String visible = KEY_PREFIX + body.substring(0, VISIBLE_CHARS);

        ApiKey saved = apiKeys.save(new ApiKey(
                userId,
                name.trim(),
                visible,
                Digests.sha256(plaintext),
                ttl == null ? null : Instant.now().plus(ttl)));

        log.info("API key {} created for user {}", saved.getId(), userId);
        return new Created(saved, plaintext);
    }

    /**
     * Who this key authenticates, or empty.
     *
     * <p>Empty for every failure and the reasons are never distinguished:
     * unknown key, revoked key, expired key, disabled owner. A caller learning
     * which of those applies learns whether a guessed key exists.
     */
    @Transactional
    public Optional<UserPrincipal> resolve(String presentedKey) {
        String digest = Digests.sha256(presentedKey);

        UserPrincipal cached = resolved.get(digest);
        if (cached != null) {
            return Optional.of(cached);
        }

        Instant now = Instant.now();
        Optional<ApiKey> found = apiKeys.findByKeyHash(digest).filter(k -> k.isUsable(now));
        if (found.isEmpty()) {
            return Optional.empty();
        }

        ApiKey key = found.get();
        Optional<User> owner = users.findById(key.getUserId())
                .filter(u -> u.getStatus() == UserStatus.ACTIVE);
        if (owner.isEmpty()) {
            // A key outlives its owner's ability to use it. Disabling an
            // account has to stop the keys it minted, or the account is not
            // really disabled.
            return Optional.empty();
        }

        // Written at most once per window rather than on every call. See
        // ApiKey.shouldRecordUse: otherwise every read authenticated by a key
        // becomes a write, and concurrent requests sharing a key serialise on
        // the same row lock.
        if (key.shouldRecordUse(now, properties.apiKeyUseWindow())) {
            key.recordUse(now);
            apiKeys.save(key);
        }

        UserPrincipal principal = UserPrincipal.apiKey(owner.get());
        resolved.put(digest, principal);
        return Optional.of(principal);
    }

    /** Newest first. Revoked keys stay in the list, marked, rather than vanishing. */
    public List<ApiKey> list(UUID userId) {
        return apiKeys.findByUserIdOrderByCreatedAtDesc(userId);
    }

    /**
     * Revokes a key the caller owns.
     *
     * <p>Ownership is part of the query rather than a check afterwards, and the
     * failure is the same "no such key" whether it does not exist or belongs to
     * someone else. Section 7.3: a denial that distinguishes the two confirms
     * that another account's key id exists.
     */
    @Transactional
    public void revoke(UUID userId, UUID keyId, Role callerRole) {
        ApiKey key = apiKeys.findById(keyId)
                .filter(k -> k.getUserId().equals(userId) || callerRole == Role.ADMIN)
                .orElseThrow(() -> new IllegalArgumentException("No such API key."));

        key.revoke(Instant.now());
        apiKeys.save(key);

        // Evicted rather than left to expire, so revoking on this instance is
        // immediate. Another instance's cache still has up to one TTL to run.
        resolved.invalidate(key.getKeyHash());
        log.info("API key {} revoked by user {}", keyId, userId);
    }

    /** Called when an account is locked or disabled: its keys stop with it. */
    public void evictCacheFor(UUID userId) {
        // The cache is keyed on digest, not on user, so there is nothing
        // targeted to remove. Clearing costs a cold cache and a few extra
        // lookups; leaving a disabled account's key working for a minute costs
        // more than that.
        resolved.clear();
    }
}

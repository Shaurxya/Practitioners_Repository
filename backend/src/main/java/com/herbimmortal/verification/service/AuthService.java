package com.herbimmortal.verification.service;

import com.herbimmortal.verification.domain.RefreshToken;
import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import com.herbimmortal.verification.domain.UserStatus;
import com.herbimmortal.verification.repository.RefreshTokenRepository;
import com.herbimmortal.verification.repository.UserRepository;
import com.herbimmortal.verification.security.AuthProperties;
import com.herbimmortal.verification.security.Digests;
import com.herbimmortal.verification.security.JwtService;
import com.herbimmortal.verification.util.TtlCache;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Sign up, sign in, refresh, sign out.
 *
 * <h2>The two rules everything here follows</h2>
 *
 * <b>1. A failure never says which half was wrong.</b> "No such email" and
 * "wrong password" are one message and one status code, and they take
 * comparable time. Answering differently, or faster, turns this endpoint into a
 * way to enumerate who holds an account, which for a register of named medical
 * practitioners is a real disclosure and not a theoretical one.
 *
 * <p><b>2. A session can be withdrawn.</b> The access token cannot be, so it is
 * short. Everything that should end a session ends the refresh token, and the
 * access token dies of old age within one TTL. Non negotiable 3 in miniature.
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    /**
     * A real bcrypt hash of a value nobody knows, used to spend the same time
     * on an unknown email as on a known one.
     *
     * <p>Without this, sign in for an address that has no account returns as
     * soon as the lookup misses, and one for an address that does takes the
     * ~60ms bcrypt costs. That difference is measurable over the network and it
     * answers "does this person have an account here" precisely, no matter how
     * carefully the response body is worded.
     *
     * <p>Generated once at startup rather than hardcoded, so this constant is
     * not a hash of a password that appears in the source of every deployment.
     */
    private final String decoyHash;

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder passwords;
    private final JwtService jwt;
    private final AuthProperties properties;
    private final ApiKeyService apiKeys;
    private final JdbcTemplate jdbc;

    /**
     * Failed attempts per email, in memory, on top of the persistent counter on
     * the user row.
     *
     * <p>Two layers because they stop different things. The database counter
     * locks one account after N failures and survives a restart. This one is
     * checked before the database is touched at all, so a flood of attempts
     * against a thousand different addresses is refused without a thousand
     * queries and a thousand bcrypt runs. That flood is the shape of a real
     * credential stuffing run, and the persistent counter alone answers it by
     * doing all the work and then saying no.
     */
    private final TtlCache<String, AtomicInteger> recentFailures;

    public AuthService(UserRepository users, RefreshTokenRepository refreshTokens,
                       PasswordEncoder passwords, JwtService jwt, AuthProperties properties,
                       ApiKeyService apiKeys, JdbcTemplate jdbc) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.passwords = passwords;
        this.jwt = jwt;
        this.properties = properties;
        this.apiKeys = apiKeys;
        this.jdbc = jdbc;
        this.decoyHash = passwords.encode(jwt.randomSecret());
        this.recentFailures = new TtlCache<>(properties.lockDuration(), 50_000);
    }

    /** What a successful sign in or refresh hands back. */
    public record Session(User user, String accessToken, String refreshToken,
                          long expiresInSeconds) {
    }

    /** One message, one status, for every way authentication can fail. */
    public static class AuthenticationFailedException extends RuntimeException {
        public AuthenticationFailedException(String message) {
            super(message);
        }
    }

    // ------------------------------------------------------------------
    // Sign up
    // ------------------------------------------------------------------

    /**
     * Creates an account. Always a PRACTITIONER: role is never taken from the
     * request body.
     *
     * <p>That is not a defensive nicety, it is the difference between a signup
     * form and an admin factory. A {@code role} field bound from JSON here means
     * anyone who can POST to a public endpoint can mint themselves an
     * administrator, and the request looks entirely ordinary in the logs.
     * Promotion is a separate, authenticated, audited action.
     */
    @Transactional
    public Session register(String email, String password, String fullName,
                            String userAgent, String ip) {
        String normalized = User.normalizeEmail(email);
        validateEmail(normalized);
        validatePassword(password, normalized, fullName);

        if (fullName == null || fullName.trim().length() < 2) {
            throw new IllegalArgumentException("Enter your full name.");
        }

        // Checked here for a readable message, and enforced by the unique index
        // regardless. This check loses the race between two simultaneous
        // signups; the index does not, which is why the catch below exists.
        if (users.existsByEmail(normalized)) {
            throw new EmailAlreadyRegisteredException();
        }

        User user;
        try {
            user = users.saveAndFlush(new User(
                    normalized, passwords.encode(password), fullName.trim(), Role.PRACTITIONER));
        } catch (DataIntegrityViolationException raced) {
            throw new EmailAlreadyRegisteredException();
        }

        audit(user.getId(), "AUTH_REGISTER", null);
        log.info("account {} registered", user.getId());

        // Signed in immediately. Making someone type the password they just
        // chose, on the next screen, is friction with no security value: they
        // demonstrably have the credential.
        return startSession(user, userAgent, ip);
    }

    // ------------------------------------------------------------------
    // Sign in
    // ------------------------------------------------------------------

    /**
     * {@code noRollbackFor} is load bearing here, and its absence was a silent
     * hole.
     *
     * <p>Spring rolls a transaction back when a RuntimeException escapes a
     * {@code @Transactional} method. This method deliberately writes and then
     * throws: it increments the failed attempt counter, possibly locks the
     * account, possibly revokes every session, and then reports failure to the
     * caller. Without this annotation every one of those writes was discarded
     * by the throw, so the lockout counter reset to zero after each wrong
     * password and the account never locked, no matter how many guesses.
     *
     * <p>Nothing about that failure was visible: the endpoint returned the right
     * status, the right message, and the right timing. Only counting rows
     * afterwards shows it.
     */
    @Transactional(noRollbackFor = AuthenticationFailedException.class)
    public Session login(String email, String password, String userAgent, String ip) {
        String normalized = User.normalizeEmail(email);
        Instant now = Instant.now();

        AtomicInteger recent = recentFailures.get(normalized);
        if (recent != null && recent.get() >= properties.maxFailedLogins()) {
            // Refused before the database is touched. Same message as any other
            // failure: telling someone they have been rate limited tells them
            // the address was worth rate limiting.
            throw new AuthenticationFailedException(genericFailure());
        }

        Optional<User> found = users.findByEmail(normalized);

        if (found.isEmpty()) {
            // Spend the same time as a real check. See decoyHash.
            passwords.matches(password == null ? "" : password, decoyHash);
            countFailure(normalized);
            throw new AuthenticationFailedException(genericFailure());
        }

        User user = found.get();

        if (!passwords.matches(password == null ? "" : password, user.getPasswordHash())) {
            user.recordFailedLogin(now, properties.maxFailedLogins(), properties.lockDuration());

            // saveAndFlush, not save, and the difference is the whole lockout.
            //
            // save() only marks the entity dirty in the persistence context.
            // revokeAllForUser below is a @Modifying bulk update declared with
            // clearAutomatically = true, which discards that context before it
            // has flushed: the increment and the LOCKED status went with it, so
            // the counter stuck one short of the threshold forever and no
            // account ever locked. Nothing failed, nothing logged, and the
            // endpoint returned exactly the right status the whole time.
            //
            // Same trap VerificationService.submitOnce documents for its case
            // insert. Anything that writes through a second mechanism in the
            // same transaction has to flush first.
            users.saveAndFlush(user);
            countFailure(normalized);

            if (user.getStatus() == UserStatus.LOCKED) {
                // Every live session goes too. If the password is being
                // guessed, an existing session may already be the attacker's.
                refreshTokens.revokeAllForUser(user.getId(), now);
                apiKeys.evictCacheFor(user.getId());
                log.warn("account {} locked after {} failed attempts",
                        user.getId(), user.getFailedLoginCount());
            }
            throw new AuthenticationFailedException(genericFailure());
        }

        if (!user.canSignIn(now)) {
            // Correct password, account locked or disabled. Still the same
            // message: "your account is locked" confirms the password was right
            // to whoever just guessed it.
            throw new AuthenticationFailedException(genericFailure());
        }

        user.recordSuccessfulLogin(now);
        users.save(user);
        recentFailures.invalidate(normalized);

        audit(user.getId(), "AUTH_LOGIN", null);
        return startSession(user, userAgent, ip);
    }

    // ------------------------------------------------------------------
    // Refresh
    // ------------------------------------------------------------------

    /**
     * Exchanges a refresh token for a new pair, and rotates it.
     *
     * <h2>Reuse detection</h2>
     *
     * Every refresh invalidates the token it consumed and records its
     * successor. Presenting an already rotated token means one of two things: a
     * client retried after a dropped response, or a stolen copy is being used
     * alongside the real one. Nothing here can tell those apart, so it assumes
     * the worse and revokes every session for the account.
     *
     * <p>That is a deliberate trade against a rare false positive. The
     * legitimate user signs in again, which is an annoyance; the alternative is
     * a thief holding a valid session for thirty days with nothing to notice it.
     *
     * <p>See {@link #login} for why {@code noRollbackFor} is on this method too.
     * The family revocation below is a write followed by a throw, and without it
     * the throw undoes the revocation: reuse was detected, logged, audited, and
     * then quietly not acted upon.
     */
    @Transactional(noRollbackFor = AuthenticationFailedException.class)
    public Session refresh(String presentedToken, String userAgent, String ip) {
        Instant now = Instant.now();
        String digest = Digests.sha256(presentedToken == null ? "" : presentedToken);

        RefreshToken token = refreshTokens.findByTokenHash(digest)
                .orElseThrow(() -> new AuthenticationFailedException("That session is no longer valid."));

        if (token.isAlreadyRotated()) {
            refreshTokens.revokeAllForUser(token.getUserId(), now);
            audit(token.getUserId(), "AUTH_TOKEN_REUSE", "A rotated refresh token was presented again.");
            log.warn("refresh token reuse detected for user {}, all sessions revoked",
                    token.getUserId());
            throw new AuthenticationFailedException("That session is no longer valid.");
        }

        if (!token.isUsable(now)) {
            throw new AuthenticationFailedException("That session is no longer valid.");
        }

        User user = users.findById(token.getUserId())
                .orElseThrow(() -> new AuthenticationFailedException("That session is no longer valid."));

        // The live account state, checked here rather than trusted from the
        // token. This is the moment a lock or a disable actually bites, and it
        // is why the access token TTL is the bound on how stale authorization
        // can be.
        if (!user.canSignIn(now)) {
            refreshTokens.revokeAllForUser(user.getId(), now);
            throw new AuthenticationFailedException("That session is no longer valid.");
        }

        Session next = startSession(user, userAgent, ip);
        token.rotateTo(refreshTokens.findByTokenHash(Digests.sha256(next.refreshToken()))
                .map(RefreshToken::getId).orElse(null), now);
        refreshTokens.save(token);

        return next;
    }

    // ------------------------------------------------------------------
    // Sign out
    // ------------------------------------------------------------------

    /** Ends one session. The access token still has up to one TTL to live, by design. */
    @Transactional
    public void logout(String presentedToken) {
        if (presentedToken == null || presentedToken.isBlank()) {
            return;
        }
        refreshTokens.findByTokenHash(Digests.sha256(presentedToken))
                .ifPresent(token -> {
                    token.revoke(Instant.now());
                    refreshTokens.save(token);
                });
    }

    /** Ends every session for an account. Used by "sign out everywhere" and by admin action. */
    @Transactional
    public int logoutEverywhere(UUID userId) {
        apiKeys.evictCacheFor(userId);
        return refreshTokens.revokeAllForUser(userId, Instant.now());
    }

    public List<RefreshToken> sessionsFor(UUID userId) {
        return refreshTokens.findByUserIdAndRevokedAtIsNullOrderByIssuedAtDesc(userId);
    }

    public Optional<User> byId(UUID userId) {
        return users.findById(userId);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    private Session startSession(User user, String userAgent, String ip) {
        Instant now = Instant.now();
        String refresh = jwt.randomSecret();

        refreshTokens.saveAndFlush(new RefreshToken(
                user.getId(),
                Digests.sha256(refresh),
                now.plus(properties.refreshTokenTtl()),
                userAgent,
                ip));

        return new Session(
                user,
                jwt.issueAccessToken(user, now),
                refresh,
                properties.accessTokenTtl().toSeconds());
    }

    private void countFailure(String email) {
        AtomicInteger counter = recentFailures.get(email);
        if (counter == null) {
            counter = new AtomicInteger();
            recentFailures.put(email, counter);
        }
        counter.incrementAndGet();
    }

    private static String genericFailure() {
        return "That email and password do not match an account.";
    }

    private static void validateEmail(String email) {
        if (email.isBlank() || !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            throw new IllegalArgumentException("Enter a valid email address.");
        }
        if (email.length() > 254) {
            throw new IllegalArgumentException("That email address is too long.");
        }
    }

    /**
     * Length first, and no composition rules.
     *
     * <p>Twelve characters with nothing else required, rather than eight with a
     * digit and a symbol. Composition rules push people towards
     * {@code Password1!}, which is short, predictable and satisfies every one of
     * them. Length is the property that actually costs an attacker anything.
     *
     * <p>The two content checks that remain are the ones that catch a password
     * an attacker would try in their first hundred guesses for this specific
     * person: their own email address, and their own name.
     */
    private static void validatePassword(String password, String email, String fullName) {
        if (password == null || password.length() < 12) {
            throw new IllegalArgumentException("Use a password of at least 12 characters.");
        }
        if (password.length() > 200) {
            // Bcrypt truncates past 72 bytes anyway, and an unbounded password
            // is an unbounded amount of hashing per request.
            throw new IllegalArgumentException("That password is too long.");
        }
        String lower = password.toLowerCase();
        String localPart = email.contains("@") ? email.substring(0, email.indexOf('@')) : email;
        if (!localPart.isBlank() && lower.contains(localPart.toLowerCase())) {
            throw new IllegalArgumentException("Your password cannot contain your email address.");
        }
        if (fullName != null && fullName.trim().length() > 3
                && lower.contains(fullName.trim().toLowerCase())) {
            throw new IllegalArgumentException("Your password cannot contain your name.");
        }
    }

    /**
     * Append only, and through JdbcTemplate for the same reason
     * VerificationService does it: these rows have to land whether or not the
     * surrounding JPA context flushes.
     */
    private void audit(UUID subjectId, String eventType, String reason) {
        jdbc.update("insert into audit_events (event_type, subject_type, subject_id, actor_type,"
                        + " actor_id, reason) values (?,?,?,?,?,?)",
                eventType, "user", subjectId, "USER", subjectId.toString(), reason);
    }

    /** Distinct from a generic bad request so the controller can answer 409. */
    public static class EmailAlreadyRegisteredException extends RuntimeException {
        public EmailAlreadyRegisteredException() {
            super("An account already exists for that email address.");
        }
    }

    /** Housekeeping hook for the scheduled sweep. */
    @Transactional
    public int purgeExpiredTokens(Duration keepFor) {
        return refreshTokens.deleteExpiredBefore(Instant.now().minus(keepFor));
    }
}

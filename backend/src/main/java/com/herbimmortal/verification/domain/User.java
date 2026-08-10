package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

/**
 * A login. Maps the users table from V10.
 *
 * <p>Deliberately not the same thing as a {@link Practitioner}. A user is
 * someone who signs in; a practitioner is a registration on a council register.
 * A reviewer has no registration, a registry row has no login, and a person who
 * signs up before claiming is a user with no practitioner for as long as they
 * like. The link is a nullable pointer on Practitioner.
 *
 * <p>{@code @Enumerated(EnumType.STRING)} stores the enum name as text rather
 * than its ordinal. Ordinals are a trap: reordering the enum silently rewrites
 * the meaning of every row already stored, and nothing fails at the time.
 */
@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(nullable = false, unique = true)
    private String email;

    /**
     * BCrypt output. Never logged, never serialized, never compared with
     * {@code equals}: {@code PasswordEncoder.matches} exists because a plain
     * comparison of a hash is both wrong and timing-leaky.
     */
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role = Role.PRACTITIONER;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private UserStatus status = UserStatus.ACTIVE;

    @Column(name = "email_verified_at")
    private Instant emailVerifiedAt;

    @Column(name = "failed_login_count", nullable = false)
    private int failedLoginCount;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    protected User() {
    }

    public User(String email, String passwordHash, String fullName, Role role) {
        this.email = normalizeEmail(email);
        this.passwordHash = passwordHash;
        this.fullName = fullName.trim();
        this.role = role;
    }

    /**
     * One definition of what two email addresses being "the same" means, used
     * by signup, by sign in and by the unique index.
     *
     * <p>Lowercased and trimmed, and nothing cleverer. Stripping dots or
     * plus-addressing would be a guess about someone else's mail server: those
     * are Gmail conventions, not rules, and applying them would merge two
     * genuinely different addresses on providers that treat them as distinct.
     */
    public static String normalizeEmail(String raw) {
        return raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
    }

    /** Only ACTIVE accounts may hold a session, and a lock expires on its own. */
    public boolean canSignIn(Instant now) {
        if (status == UserStatus.DISABLED) {
            return false;
        }
        if (status == UserStatus.LOCKED) {
            return lockedUntil != null && now.isAfter(lockedUntil);
        }
        return true;
    }

    public void recordSuccessfulLogin(Instant now) {
        this.failedLoginCount = 0;
        this.lockedUntil = null;
        this.status = UserStatus.ACTIVE;
        this.lastLoginAt = now;
        this.updatedAt = now;
    }

    /**
     * Counts a failure, and locks the account once the threshold is crossed.
     *
     * <p>The lock is temporary on purpose. A permanent lock after five wrong
     * passwords hands anyone who knows an email address a way to shut that
     * person out of their own account, which turns a brute force defence into
     * a denial of service tool.
     */
    public void recordFailedLogin(Instant now, int threshold, java.time.Duration lockFor) {
        this.failedLoginCount += 1;
        if (this.failedLoginCount >= threshold) {
            this.status = UserStatus.LOCKED;
            this.lockedUntil = now.plus(lockFor);
        }
        this.updatedAt = now;
    }

    public void changePassword(String newHash) {
        this.passwordHash = newHash;
        this.updatedAt = Instant.now();
    }

    public void setRole(Role role) {
        this.role = role;
        this.updatedAt = Instant.now();
    }

    public void setStatus(UserStatus status) {
        this.status = status;
        this.updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public String getFullName() { return fullName; }
    public Role getRole() { return role; }
    public UserStatus getStatus() { return status; }
    public Instant getEmailVerifiedAt() { return emailVerifiedAt; }
    public int getFailedLoginCount() { return failedLoginCount; }
    public Instant getLockedUntil() { return lockedUntil; }
    public Instant getLastLoginAt() { return lastLoginAt; }
    public Instant getCreatedAt() { return createdAt; }
}

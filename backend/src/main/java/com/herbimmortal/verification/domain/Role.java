package com.herbimmortal.verification.domain;

/**
 * What an account may do. Section 7.3.
 *
 * An enum rather than a table, unlike councils and medical systems, and the
 * difference is real: those are data the registry grows, this is a branch in
 * the code. Every role here corresponds to {@code @PreAuthorize} expressions and
 * to route guards in the console, so adding one is a change to authorization
 * logic that has to be written and reviewed, not a row someone inserts.
 *
 * Spring Security expects authorities prefixed with {@code ROLE_} when you use
 * {@code hasRole}. That prefix lives in {@link #authority()} and nowhere else,
 * so no call site has to remember it.
 */
public enum Role {

    /** The default for anyone who signs up. Can claim a registration and read their own cases. */
    PRACTITIONER,

    /** Owns a partner organization. Does not grant reviewer or administrator access. */
    DEVELOPER,

    /** Works the review queue. Sees claims and registry rows, cannot import registers. */
    REVIEWER,

    /** Everything a reviewer can do, plus registry import and account administration. */
    ADMIN;

    public String authority() {
        return "ROLE_" + name();
    }

    /**
     * Reviewer work is a subset of admin work, and the console asks this
     * question in several places. Encoding it once here stops
     * {@code role == ADMIN || role == REVIEWER} drifting apart across screens.
     */
    public boolean canReview() {
        return this == REVIEWER || this == ADMIN;
    }
}

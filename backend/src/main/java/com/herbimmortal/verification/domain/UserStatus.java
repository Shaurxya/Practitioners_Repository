package com.herbimmortal.verification.domain;

/**
 * Three states rather than an {@code enabled} boolean.
 *
 * "Locked out by repeated failed sign ins" and "shut down by an administrator"
 * need different messages, different exits and different lifetimes, and a
 * boolean forces them to share all three. The visible cost of collapsing them
 * is a support conversation where nobody can tell whether an account will come
 * back on its own.
 */
public enum UserStatus {

    /** The only state that may sign in. */
    ACTIVE,

    /**
     * Temporary and automatic. Set by the failed attempt counter, cleared by
     * {@code locked_until} passing. Nobody has to do anything.
     */
    LOCKED,

    /**
     * Deliberate and indefinite. Only an administrator can undo it, and it
     * survives any number of correct passwords.
     */
    DISABLED
}

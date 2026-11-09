package com.herbimmortal.verification.partner;

import java.util.Map;
import java.util.Set;

/** Stored by name, never ordinal. Wire scopes intentionally use colon-separated values. */
public final class PartnerTypes {
    private PartnerTypes() { }

    public enum Environment { TEST, LIVE }

    public enum ClientStatus {
        PENDING, ACTIVE, SUSPENDED;

        private static final Map<ClientStatus, Set<ClientStatus>> TRANSITIONS = Map.of(
                PENDING, Set.of(ACTIVE), ACTIVE, Set.of(SUSPENDED), SUSPENDED, Set.of(ACTIVE));

        public boolean canTransitionTo(ClientStatus next) {
            return TRANSITIONS.getOrDefault(this, Set.of()).contains(next);
        }
    }

    public enum LiveAccessStatus {
        NOT_REQUESTED, PENDING, APPROVED, REJECTED;

        private static final Map<LiveAccessStatus, Set<LiveAccessStatus>> TRANSITIONS = Map.of(
                NOT_REQUESTED, Set.of(PENDING), PENDING, Set.of(APPROVED, REJECTED),
                REJECTED, Set.of(PENDING));

        public boolean canTransitionTo(LiveAccessStatus next) {
            return TRANSITIONS.getOrDefault(this, Set.of()).contains(next);
        }
    }

    public enum KeyStatus {
        ACTIVE, REVOKED, EXPIRED;

        private static final Map<KeyStatus, Set<KeyStatus>> TRANSITIONS = Map.of(
                ACTIVE, Set.of(REVOKED, EXPIRED));

        public boolean canTransitionTo(KeyStatus next) {
            return TRANSITIONS.getOrDefault(this, Set.of()).contains(next);
        }
    }

    public enum Scope {
        VERIFY_BASIC("verify:basic"), VERIFY_DETAIL("verify:detail");

        private final String value;

        Scope(String value) { this.value = value; }
        public String value() { return value; }

        public static Scope fromValue(String value) {
            for (Scope scope : values()) {
                if (scope.value.equals(value)) return scope;
            }
            throw new IllegalArgumentException("Unsupported partner scope.");
        }
    }
}

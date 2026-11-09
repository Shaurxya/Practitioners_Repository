package com.herbimmortal.verification.partner;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static com.herbimmortal.verification.partner.PartnerTypes.*;
import static org.assertj.core.api.Assertions.*;

class PartnerLifecycleTest {
    private static final Instant NOW = Instant.parse("2026-11-08T04:00:00Z");

    @Test
    void expiryIsEnforcedAtTheBoundaryWithoutWaitingForAJob() {
        PartnerApiKey key = key(NOW.plusSeconds(10));
        assertThat(key.isUsable(NOW.plusSeconds(9))).isTrue();
        assertThat(key.isUsable(NOW.plusSeconds(10))).isFalse();
        assertThat(key.getStatus()).isEqualTo(KeyStatus.ACTIVE);
        assertThatThrownBy(() -> key.transition(KeyStatus.EXPIRED, null, NOW))
                .isInstanceOf(IllegalStateException.class);
        key.transition(KeyStatus.EXPIRED, null, NOW.plusSeconds(10));
        assertThatThrownBy(() -> key.transition(KeyStatus.ACTIVE, null, NOW.plusSeconds(11)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void revokedKeysCannotBeResurrected() {
        PartnerApiKey key = key(null);
        UUID admin = UUID.randomUUID();
        key.transition(KeyStatus.REVOKED, admin, NOW.plusSeconds(1));
        assertThat(key.isUsable(NOW.plusSeconds(2))).isFalse();
        assertThat(key.getRevokedBy()).isEqualTo(admin);
        assertThatThrownBy(() -> key.transition(KeyStatus.ACTIVE, admin, NOW.plusSeconds(3)))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void suspendedClientBlocksBothEnvironmentsAndInvalidTransitionsDoNotMutateIt() {
        ApiClient client = client();
        client.transition(ClientStatus.ACTIVE, NOW);
        client.transitionLiveAccess(LiveAccessStatus.PENDING, UUID.randomUUID(), null, NOW);
        assertThatThrownBy(() -> client.transitionLiveAccess(LiveAccessStatus.APPROVED, UUID.randomUUID(), " ", NOW))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(client.getLiveAccessStatus()).isEqualTo(LiveAccessStatus.PENDING);
        client.transitionLiveAccess(LiveAccessStatus.APPROVED, UUID.randomUUID(), "approved purpose", NOW);
        assertThat(client.permits(Environment.LIVE)).isTrue();
        client.transition(ClientStatus.SUSPENDED, NOW);
        assertThat(client.permits(Environment.TEST)).isFalse();
        assertThat(client.permits(Environment.LIVE)).isFalse();
        assertThatThrownBy(() -> client.transition(ClientStatus.PENDING, NOW)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void rejectedLiveApplicationCanBeResubmittedWithoutReusingOldApprovalMetadata() {
        ApiClient client = client();
        client.transition(ClientStatus.ACTIVE, NOW);
        client.transitionLiveAccess(LiveAccessStatus.PENDING, UUID.randomUUID(), null, NOW);
        client.transitionLiveAccess(LiveAccessStatus.REJECTED, UUID.randomUUID(), "More detail required", NOW);
        client.transitionLiveAccess(LiveAccessStatus.PENDING, UUID.randomUUID(), null, NOW.plusSeconds(1));
        assertThat(client.getLiveDecidedBy()).isNull();
        assertThat(client.getLiveDecidedAt()).isNull();
        assertThat(client.getLiveDecisionReason()).isNull();
        assertThat(client.permits(Environment.LIVE)).isFalse();
    }

    @Test
    void credentialsCannotBePastedIntoPersistedMetadataOrAuditReasons() {
        String pasted = "hi_live_abcdefghijklmnopqrstuv.secret-do-not-store";
        assertThatThrownBy(() -> new ApiClient(UUID.randomUUID(), pasted, "contact@example.test",
                "purpose", "terms-v1", NOW)).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credentials cannot be used as organization name.");
        ApiClient client = client();
        client.transition(ClientStatus.ACTIVE, NOW);
        client.transitionLiveAccess(LiveAccessStatus.PENDING, UUID.randomUUID(), null, NOW);
        assertThatThrownBy(() -> client.transitionLiveAccess(LiveAccessStatus.APPROVED,
                UUID.randomUUID(), pasted, NOW)).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Credentials cannot be used as decision reason.");
        assertThat(client.getLiveAccessStatus()).isEqualTo(LiveAccessStatus.PENDING);
    }

    private ApiClient client() {
        return new ApiClient(UUID.randomUUID(), "Fixture", "contact@example.test", "Fixture integration",
                "fixture-terms", NOW);
    }

    private PartnerApiKey key(Instant expiry) {
        return new PartnerApiKey(UUID.randomUUID(), "Fixture", Environment.TEST,
                "abcdefghijklmnopqrstuv", new byte[32], Set.of(Scope.VERIFY_BASIC), NOW, expiry, null);
    }
}

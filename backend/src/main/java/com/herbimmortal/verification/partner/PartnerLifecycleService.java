package com.herbimmortal.verification.partner;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.security.UserPrincipal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

import static com.herbimmortal.verification.partner.PartnerTypes.*;

/**
 * The only writer of lifecycle states. JPA changes and the JDBC audit insert
 * share Spring's transaction, like using one SQLAlchemy transaction for both.
 * The caller must be supplied from the authenticated session, never request JSON.
 */
@Service
public class PartnerLifecycleService {
    private final ApiClientRepository clients;
    private final PartnerApiKeyRepository keys;
    private final JdbcTemplate jdbc;

    public PartnerLifecycleService(ApiClientRepository clients, PartnerApiKeyRepository keys, JdbcTemplate jdbc) {
        this.clients = clients;
        this.keys = keys;
        this.jdbc = jdbc;
    }

    @Transactional
    public void transitionClient(UUID clientId, ClientStatus next, UserPrincipal caller) {
        requireSession(caller);
        ApiClient client = accessibleClient(clientId, caller);
        if (client.getStatus() != ClientStatus.PENDING) requireAdmin(caller);
        Instant now = Instant.now();
        apply(() -> client.transition(next, now), client.getId(), "api_client", "PARTNER_CLIENT_STATUS",
                client.getStatus().name(), next.name(), caller, "CLIENT_STATUS_CHANGED", now, null, null);
    }

    @Transactional
    public void transitionLiveAccess(UUID clientId, LiveAccessStatus next, UserPrincipal caller, String reason) {
        requireSession(caller);
        ApiClient client = accessibleClient(clientId, caller);
        boolean decision = next == LiveAccessStatus.APPROVED || next == LiveAccessStatus.REJECTED;
        if (decision) requireAdmin(caller);
        String decisionReason = decision ? PartnerValidation.text(reason, "decision reason", 2000) : null;
        Instant now = Instant.now();
        apply(() -> client.transitionLiveAccess(next, caller.id(), reason, now), client.getId(),
                "api_client", "PARTNER_LIVE_ACCESS", client.getLiveAccessStatus().name(), next.name(),
                caller, "LIVE_ACCESS_" + next.name(), now, null, decisionReason);
    }

    @Transactional
    public void transitionKey(UUID keyId, KeyStatus next, UserPrincipal caller) {
        requireSession(caller);
        PartnerApiKey key = (caller.role() == Role.ADMIN ? keys.findById(keyId)
                : keys.findOwnedById(keyId, caller.id())).orElseThrow(PartnerLifecycleService::notFound);
        accessibleClient(key.getClientId(), caller);
        if (next == KeyStatus.EXPIRED) requireAdmin(caller);
        Instant now = Instant.now();
        apply(() -> key.transition(next, caller.id(), now), key.getId(), "partner_api_key", "PARTNER_KEY_STATUS",
                key.getStatus().name(), next.name(), caller, "KEY_" + next.name(), now, key.getDisplayPrefix(), null);
    }

    private ApiClient accessibleClient(UUID id, UserPrincipal caller) {
        return (caller.role() == Role.ADMIN ? clients.findById(id)
                : clients.findByIdAndOwnerUserId(id, caller.id())).orElseThrow(PartnerLifecycleService::notFound);
    }

    private static void requireSession(UserPrincipal caller) {
        if (caller == null || caller.authenticatedBy() != UserPrincipal.AuthMethod.SESSION
                || caller.role() != Role.ADMIN && caller.role() != Role.DEVELOPER) {
            throw new AccessDeniedException("A developer or administrator session is required.");
        }
    }

    private static void requireAdmin(UserPrincipal caller) {
        if (caller.role() != Role.ADMIN) throw new AccessDeniedException("Administrator approval is required.");
    }

    private static IllegalArgumentException notFound() {
        return new IllegalArgumentException("No such partner resource.");
    }

    private void apply(Runnable change, UUID subjectId, String subjectType, String eventType,
                       String from, String to, UserPrincipal caller, String reasonCode, Instant now,
                       String publicPrefix, String decisionReason) {
        change.run();
        // Explicit safe metadata only. Never serialize a request body or credential.
        jdbc.update("""
                insert into audit_events(event_type, subject_type, subject_id, actor_type, actor_id,
                                         from_status, to_status, reason, created_at, metadata)
                values (?, ?, ?, 'USER', ?, ?, ?, ?, ?,
                        jsonb_strip_nulls(jsonb_build_object('prefix', cast(? as text),
                                                           'decisionReason', cast(? as text))))
                """, eventType, subjectType, subjectId, caller.id().toString(), from, to, reasonCode,
                java.sql.Timestamp.from(now), publicPrefix, decisionReason);
    }
}

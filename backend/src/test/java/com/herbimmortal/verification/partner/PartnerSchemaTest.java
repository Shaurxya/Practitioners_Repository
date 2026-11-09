package com.herbimmortal.verification.partner;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import com.herbimmortal.verification.repository.UserRepository;
import com.herbimmortal.verification.security.UserPrincipal;
import jakarta.persistence.EntityManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.context.transaction.TestTransaction;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import javax.sql.DataSource;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;

import static com.herbimmortal.verification.partner.PartnerTypes.*;
import static org.assertj.core.api.Assertions.*;

/** Real PostgreSQL/Flyway/Hibernate checks; uses the configured test datasource. */
@DataJpaTest(properties = {"spring.jpa.hibernate.ddl-auto=validate", "spring.jpa.show-sql=false",
        "logging.level.org.hibernate.orm.jdbc.bind=OFF"}, showSql = false)
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Import(PartnerLifecycleService.class)
class PartnerSchemaTest {
    @Autowired ApiClientRepository clients;
    @Autowired PartnerApiKeyRepository keys;
    @Autowired UserRepository users;
    @Autowired EntityManager em;
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @Autowired PartnerLifecycleService lifecycle;

    private User user(Role role) {
        return users.saveAndFlush(new User("partner-" + UUID.randomUUID() + "@example.test",
                "test-fixture-hash", "Partner fixture", role));
    }

    private ApiClient client(User owner) {
        return clients.saveAndFlush(new ApiClient(owner.getId(), "Fixture organization",
                "contact@example.test", "Integration testing", "fixture-terms-v1", Instant.now()));
    }

    private PartnerApiKey key(ApiClient client, Environment environment, UUID rotatedFrom) {
        String publicId = UUID.randomUUID().toString().replace("-", "").substring(0, 22);
        byte[] digest = com.herbimmortal.verification.security.Digests.sha256(publicId)
                .transform(java.util.HexFormat.of()::parseHex);
        return keys.saveAndFlush(new PartnerApiKey(client.getId(), "Fixture key", environment,
                publicId, digest, Set.of(Scope.VERIFY_BASIC), Instant.now(), null, rotatedFrom));
    }

    @Test
    void allMappingsRoundTripWithDeveloperRoleAndWireScopeValues() {
        User owner = user(Role.DEVELOPER);
        ApiClient client = client(owner);
        PartnerApiKey key = key(client, Environment.TEST, null);
        ApiUsageDaily usage = new ApiUsageDaily(new ApiUsageDaily.Id(key.getId(),
                LocalDate.of(2026, 11, 8), "PARTNER_LOOKUP", "2xx"));
        ApiQuotaMonthly quota = new ApiQuotaMonthly(new ApiQuotaMonthly.Id(client.getId(),
                Environment.TEST, LocalDate.of(2026, 11, 1)), 1000);
        em.persist(usage);
        em.persist(quota);
        em.flush();
        em.clear();

        assertThat(users.findById(owner.getId()).orElseThrow().getRole()).isEqualTo(Role.DEVELOPER);
        assertThat(clients.findByOwnerUserId(owner.getId()).orElseThrow().getAllowedScopes())
                .containsExactly(Scope.VERIFY_BASIC);
        PartnerApiKey loaded = keys.findByPublicKeyId(key.getPublicKeyId()).orElseThrow();
        assertThat(loaded.getSecretHash()).hasSize(32).isEqualTo(key.getSecretHash());
        assertThat(loaded.getScopes()).containsExactly(Scope.VERIFY_BASIC);
        assertThat(jdbc.queryForObject("select scope from partner_api_key_scope where key_id = ?",
                String.class, key.getId())).isEqualTo("verify:basic");
        assertThat(em.find(ApiUsageDaily.class, usage.getId()).getRequestCount()).isZero();
        assertThat(em.find(ApiQuotaMonthly.class, quota.getId()).getLimitUnits()).isEqualTo(1000);
    }

    @Test
    void lifecycleEnforcesApprovalAndWritesSafeAuditEvents() {
        User owner = user(Role.DEVELOPER);
        User admin = user(Role.ADMIN);
        ApiClient client = client(owner);
        assertThat(client.permits(Environment.TEST)).isFalse();
        lifecycle.transitionClient(client.getId(), ClientStatus.ACTIVE, UserPrincipal.session(owner));
        assertThat(client.permits(Environment.TEST)).isTrue();
        assertThat(client.permits(Environment.LIVE)).isFalse();
        lifecycle.transitionLiveAccess(client.getId(), LiveAccessStatus.PENDING, UserPrincipal.session(owner), null);
        lifecycle.transitionLiveAccess(client.getId(), LiveAccessStatus.APPROVED,
                UserPrincipal.session(admin), "Reviewed stated integration purpose.");
        em.flush();
        assertThat(client.permits(Environment.LIVE)).isTrue();
        assertThat(jdbc.queryForList("select from_status, to_status, reason from audit_events where subject_id = ?",
                client.getId())).hasSize(3);
        assertThat(jdbc.queryForObject("select live_decided_by from api_client where id = ?",
                UUID.class, client.getId())).isEqualTo(admin.getId());
        assertThat(jdbc.queryForObject("select reason from audit_events where subject_id = ? and to_status = 'APPROVED'",
                String.class, client.getId())).isEqualTo("LIVE_ACCESS_APPROVED");
        assertThat(jdbc.queryForObject("select metadata->>'decisionReason' from audit_events where subject_id = ? and to_status = 'APPROVED'",
                String.class, client.getId())).isEqualTo("Reviewed stated integration purpose.");
    }

    @Test
    void crossClientLifecycleActionsCannotTouchAnotherOwnersResources() {
        User alice = user(Role.DEVELOPER);
        User bob = user(Role.DEVELOPER);
        ApiClient client = client(alice);
        PartnerApiKey key = key(client, Environment.TEST, null);
        assertThat(keys.findByClientIdOrderByCreatedAtDesc(client(bob).getId())).isEmpty();
        assertThat(keys.findOwnedById(key.getId(), bob.getId())).isEmpty();
        assertThat(keys.findOwnedById(key.getId(), alice.getId())).isPresent();
        assertThatThrownBy(() -> lifecycle.transitionClient(client.getId(), ClientStatus.ACTIVE,
                UserPrincipal.session(bob))).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("No such partner resource.");
        assertThatThrownBy(() -> lifecycle.transitionKey(key.getId(), KeyStatus.REVOKED,
                UserPrincipal.session(bob))).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("No such partner resource.");
        assertThat(key.getStatus()).isEqualTo(KeyStatus.ACTIVE);
    }

    @Test
    void ownerCannotApproveLiveAccessOrUseAnApiKeyToManageIt() {
        User owner = user(Role.DEVELOPER);
        ApiClient client = client(owner);
        lifecycle.transitionClient(client.getId(), ClientStatus.ACTIVE, UserPrincipal.session(owner));
        lifecycle.transitionLiveAccess(client.getId(), LiveAccessStatus.PENDING, UserPrincipal.session(owner), null);
        assertThatThrownBy(() -> lifecycle.transitionLiveAccess(client.getId(), LiveAccessStatus.APPROVED,
                UserPrincipal.session(owner), "self approval")).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> lifecycle.transitionClient(client.getId(), ClientStatus.ACTIVE,
                UserPrincipal.apiKey(owner))).isInstanceOf(AccessDeniedException.class);
        assertThat(client.getLiveAccessStatus()).isEqualTo(LiveAccessStatus.PENDING);
    }

    @Test
    void rollbackRemovesStateChangesAndTheirAuditTogether() {
        User owner = user(Role.DEVELOPER);
        ApiClient client = client(owner);
        lifecycle.transitionClient(client.getId(), ClientStatus.ACTIVE, UserPrincipal.session(owner));
        em.flush();
        assertThat(jdbc.queryForObject("select count(*) from audit_events where subject_id = ?",
                Long.class, client.getId())).isEqualTo(1);
        TestTransaction.flagForRollback();
        TestTransaction.end();
        assertThat(jdbc.queryForObject("select count(*) from audit_events where subject_id = ?",
                Long.class, client.getId())).isZero();
        assertThat(clients.findById(client.getId())).isEmpty();
    }

    @Test
    void databaseRejectsCrossClientRotationEvenIfTheServiceIsBypassed() {
        ApiClient alice = client(user(Role.DEVELOPER));
        ApiClient bob = client(user(Role.DEVELOPER));
        PartnerApiKey original = key(alice, Environment.TEST, null);
        assertThatThrownBy(() -> key(bob, Environment.TEST, original.getId()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void databaseRejectsInvalidHashLength() {
        ApiClient client = client(user(Role.DEVELOPER));
        PartnerApiKey key = key(client, Environment.TEST, null);
        assertThatThrownBy(() -> jdbc.update("update partner_api_key set secret_hash = ? where id = ?",
                new byte[31], key.getId())).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void ownerRevocationKeepsOnlyPublicKeyMetadataInAudit() {
        User owner = user(Role.DEVELOPER);
        PartnerApiKey key = key(client(owner), Environment.TEST, null);
        lifecycle.transitionKey(key.getId(), KeyStatus.REVOKED, UserPrincipal.session(owner));
        em.flush();
        assertThat(key.isUsable(Instant.now())).isFalse();
        assertThat(jdbc.queryForObject("select metadata->>'prefix' from audit_events where subject_id = ?",
                String.class, key.getId())).isEqualTo(key.getDisplayPrefix());
        assertThat(key.getRevokedBy()).isEqualTo(owner.getId());
    }

    @Test
    void quotaBudgetsAreSeparatedByEnvironmentAndCannotExceedTheirLimit() {
        ApiClient client = client(user(Role.DEVELOPER));
        jdbc.update("""
                insert into api_quota_monthly(client_id,environment,month_start,limit_units)
                values (?, 'TEST', '2026-11-01', 10), (?, 'LIVE', '2026-11-01', 20)
                """, client.getId(), client.getId());
        assertThat(jdbc.queryForObject("select count(*) from api_quota_monthly where client_id = ?",
                Long.class, client.getId())).isEqualTo(2);
        assertThatThrownBy(() -> jdbc.update("""
                update api_quota_monthly set consumed_units = 11
                where client_id = ? and environment = 'TEST'
                """, client.getId())).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void keyDigestCannotLeakThroughJacksonOrMutableArrays() throws Exception {
        ApiClient client = client(user(Role.DEVELOPER));
        PartnerApiKey key = key(client, Environment.TEST, null);
        byte[] original = key.getSecretHash();
        byte[] copy = key.getSecretHash();
        copy[0] ^= 1;
        assertThat(key.getSecretHash()).isEqualTo(original);
        String wire = new ObjectMapper().findAndRegisterModules().writeValueAsString(key);
        assertThat(wire).doesNotContain("secretHash", "secret_hash", java.util.Base64.getEncoder().encodeToString(original));
    }

    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void migrationUpgradesV13WithoutAlteringExistingPersonalKeys() {
        String schema = "partner_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        Flyway v13 = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                .target("13").cleanDisabled(false).load();
        try {
            v13.migrate();
            UUID userId = UUID.randomUUID();
            UUID keyId = UUID.randomUUID();
            jdbc.update("insert into " + schema + ".users(id,email,password_hash,full_name) values (?,?,?,?)",
                    userId, "existing@example.test", "fixture-hash", "Existing account");
            jdbc.update("insert into " + schema + ".api_keys(id,user_id,name,key_prefix,key_hash) values (?,?,?,?,?)",
                    keyId, userId, "Existing integration", "safe-prefix", "existing-digest");
            Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema).load().migrate();
            assertThat(jdbc.queryForObject("select key_hash from " + schema + ".api_keys where id = ?",
                    String.class, keyId)).isEqualTo("existing-digest");
            assertThat(jdbc.queryForObject("select count(*) from " + schema + ".partner_api_key", Long.class)).isZero();
        } finally {
            v13.clean();
        }
    }
}

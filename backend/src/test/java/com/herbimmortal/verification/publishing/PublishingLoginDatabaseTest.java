package com.herbimmortal.verification.publishing;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.util.HexFormat;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;

/** Requires the configured PostgreSQL service. All fixture data rolls back. */
@SpringBootTest
@Transactional
class PublishingLoginDatabaseTest {
    @Autowired JdbcTemplate db;
    @Autowired PublishingLoginService service;
    static final String SECRET = "database-test-only-client-secret";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("PUBLISHING_CLIENT_SECRET_SHA256", () -> HexFormat.of().formatHex(PublishingLoginService.hash(SECRET)));
    }
    UUID owner, subject, registryId;
    String immortalId, licence;
    UserPrincipal caller;
    @BeforeEach void fixture() {
        owner=UUID.randomUUID(); subject=UUID.randomUUID(); registryId=UUID.randomUUID();
        licence="GAPUBLISH"+subject.toString().replace("-","").toUpperCase();
        immortalId="HI-26INA-"+subject.toString().substring(0,5).toUpperCase();
        db.update("insert into users(id,email,password_hash,full_name) values (?,?,?,?)",owner,owner+"@example.test","test-only-no-login","TEST OWNER");
        db.update("insert into practitioners(id,council_code,license_no_normalized,full_name_raw,country_code,medical_system_code,immortal_id,immortal_id_issued_at,user_id) values (?, 'GA', ?, 'TEST OWNER', 'IN', 'A', ?, now(), ?)",subject,licence,immortalId,owner);
        db.update("insert into registry_records(id,license_no_raw,full_name_raw,council_raw,license_no_normalized,full_name_normalized,council_code,status,source_batch,source_row_number,raw_payload,content_hash) values (?,?,'TEST OWNER','GA',?,'TESTOWNER','GA','ACTIVE','publishing-test',1,'{}'::jsonb,?)",registryId,licence,licence,subject.toString().replace("-","").repeat(2));
        db.update("insert into verification_cases(practitioner_id,status,claimed_full_name,claimed_registration_number,claimed_council,matched_registry_record_id,submitted_at,decided_at) values (?,'APPROVED','TEST OWNER',?,'GA',?,now()-interval '1 hour',now()-interval '1 hour')",subject,licence,registryId);
        caller=new UserPrincipal(owner,owner+"@example.test","TEST OWNER",Role.PRACTITIONER,UserPrincipal.AuthMethod.SESSION);
    }
    @Test void acceptsCurrentApprovedActiveRegistration() { assertThat(service.identity(subject).verified()).isTrue(); }
    @ParameterizedTest @ValueSource(strings={"REVOKED","EXPIRED","REJECTED","SUBMITTED","MANUAL_REVIEW"})
    void newerNonApprovedCaseCannotBeMaskedByHistoricalApproval(String status) {
        db.update("insert into verification_cases(practitioner_id,status,claimed_full_name,claimed_registration_number,claimed_council,submitted_at) values (?,?,'TEST OWNER',?,'GA',now())",subject,status,licence);
        assertThat(service.identity(subject).verified()).isFalse();
    }
    @ParameterizedTest @ValueSource(strings={"REVOKED","EXPIRED","SUSPENDED","INACTIVE","UNKNOWN"})
    void inactiveRegistryCannotVerify(String status) { db.update("update registry_records set status=? where id=?",status,registryId);assertThat(service.identity(subject).verified()).isFalse(); }
    @Test void missingOrExpiredCurrentRegistryCannotVerify() {
        db.update("update registry_records set present_in_latest_batch=false where id=?",registryId);assertThat(service.identity(subject).verified()).isFalse();
        db.update("update registry_records set present_in_latest_batch=true,valid_until=(now() at time zone 'UTC')::date-1 where id=?",registryId);assertThat(service.identity(subject).verified()).isFalse();
    }
    @Test void anotherAccountCannotAuthorizeThisVerifiedId() {
        var stranger=new UserPrincipal(UUID.randomUUID(),"stranger@example.test","Stranger",Role.PRACTITIONER,UserPrincipal.AuthMethod.SESSION);
        assertThatThrownBy(()->service.authorize(stranger,"publishing-org","http://localhost:5001/api/auth/immortal/callback",immortalId,"s".repeat(43),PublishingLoginService.challenge("v".repeat(43)),"S256")).isInstanceOf(ResponseStatusException.class);
    }
    @Test void pkceCodeCanBeExchangedOnlyOnceWithoutSharingProviderTokens() {
        String redirect=service.authorize(caller,"publishing-org","http://localhost:5001/api/auth/immortal/callback",immortalId,"s".repeat(43),PublishingLoginService.challenge("v".repeat(43)),"S256");
        String code=redirect.substring(redirect.indexOf("code=")+5,redirect.indexOf("&state="));
        var identity=service.exchange(SECRET,"publishing-org","http://localhost:5001/api/auth/immortal/callback",code,"v".repeat(43));
        assertThat(identity.get("subject")).isEqualTo(subject.toString());assertThat(identity).doesNotContainKeys("accessToken","refreshToken","password");
        assertThatThrownBy(()->service.exchange(SECRET,"publishing-org","http://localhost:5001/api/auth/immortal/callback",code,"v".repeat(43))).isInstanceOf(ResponseStatusException.class);
    }
    @Test void wrongPkceCannotConsumeTheOwnersCode() {
        String callback=service.authorize(caller,"publishing-org","http://localhost:5001/api/auth/immortal/callback",immortalId,"s".repeat(43),PublishingLoginService.challenge("v".repeat(43)),"S256");
        String code=callback.substring(callback.indexOf("code=")+5,callback.indexOf("&state="));
        assertThatThrownBy(()->service.exchange(SECRET,"publishing-org","http://localhost:5001/api/auth/immortal/callback",code,"w".repeat(43))).isInstanceOf(ResponseStatusException.class);
        assertThat(db.queryForObject("select count(*) from publishing_login_code where code_hash = ?",Integer.class,PublishingLoginService.hash(code))).isEqualTo(1);
    }
    @Test void expiredCodesCannotBeExchanged() {
        String callback=service.authorize(caller,"publishing-org","http://localhost:5001/api/auth/immortal/callback",immortalId,"s".repeat(43),PublishingLoginService.challenge("v".repeat(43)),"S256");
        String code=callback.substring(callback.indexOf("code=")+5,callback.indexOf("&state="));
        db.update("update publishing_login_code set expires_at = now()-interval '1 second' where code_hash=?",PublishingLoginService.hash(code));
        assertThatThrownBy(()->service.exchange(SECRET,"publishing-org","http://localhost:5001/api/auth/immortal/callback",code,"v".repeat(43))).isInstanceOf(ResponseStatusException.class);
    }
    @Test void disabledOwnerAndAmbiguousCurrentRecordsCannotVerify() {
        db.update("update users set status='DISABLED' where id=?",owner);
        assertThat(service.identity(subject).verified()).isFalse();
        db.update("update users set status='ACTIVE' where id=?",owner);
        db.update("""
            insert into registry_records(license_no_raw,full_name_raw,council_raw,license_no_normalized,
              full_name_normalized,council_code,status,source_batch,source_row_number,raw_payload,content_hash)
            values (?,'TEST OWNER','GA',?,'TESTOWNER','GA','ACTIVE','publishing-test-duplicate',2,'{}'::jsonb,?)
            """,licence,licence,UUID.randomUUID().toString().replace("-","").repeat(2));
        assertThat(service.identity(subject).verified()).isFalse();
    }
}

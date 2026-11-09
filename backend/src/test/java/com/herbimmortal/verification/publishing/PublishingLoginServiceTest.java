package com.herbimmortal.verification.publishing;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.security.UserPrincipal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PublishingLoginServiceTest {
    JdbcTemplate db;
    PublishingLoginService service;
    final String secret = "test-only-first-party-client-secret";
    final String redirect = "http://localhost:5001/api/auth/immortal/callback";
    final UUID owner = UUID.randomUUID(), subject = UUID.randomUUID();
    final String verifier = "v".repeat(43), state = "s".repeat(43);
    UserPrincipal person;
    @BeforeEach void setup() {
        db = mock(JdbcTemplate.class);
        service = spy(new PublishingLoginService(db,"publishing-org",redirect,"http://localhost:8080",HexFormat.of().formatHex(PublishingLoginService.hash(secret))));
        person = new UserPrincipal(owner,"owner@example.test","Owner",Role.PRACTITIONER,UserPrincipal.AuthMethod.SESSION);
    }
    @Test void rejectsApiKeysAsPersonAuthentication() {
        var machine = new UserPrincipal(owner,"owner@example.test","Owner",Role.PRACTITIONER,UserPrincipal.AuthMethod.API_KEY);
        assertThatThrownBy(() -> service.authorize(machine,"publishing-org",redirect,"HI-26INA-K3M7Q",state,PublishingLoginService.challenge(verifier),"S256")).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(db);
    }
    @Test void rejectsExactRedirectMismatchAndPlainPkce() {
        assertThatThrownBy(() -> service.authorize(person,"publishing-org",redirect+"/extra","HI-26INA-K3M7Q",state,PublishingLoginService.challenge(verifier),"S256")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.authorize(person,"publishing-org",redirect,"HI-26INA-K3M7Q",state,verifier,"plain")).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(db);
    }
    @Test void rejectsWrongClientSecrets() {
        assertThatThrownBy(() -> service.authenticateClient("wrong")).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.authenticateClient(null)).isInstanceOf(ResponseStatusException.class);
        service.authenticateClient(secret);
    }
    @Test void refusesUnownedVerifiedId() {
        when(db.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());
        assertThatThrownBy(() -> service.authorize(person,"publishing-org",redirect,"HI-26INA-K3M7Q",state,PublishingLoginService.challenge(verifier),"S256")).isInstanceOf(ResponseStatusException.class);
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void refusesCurrentUnverifiedIdentityEvenWhenAccountOwnsIt() {
        when(db.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(subject));
        doReturn(new PublishingLoginService.Identity(subject,owner,"HI-26INA-K3M7Q","owner@example.test","Owner",false,null)).when(service).identity(subject);
        assertThatThrownBy(() -> service.authorize(person,"publishing-org",redirect,"HI-26INA-K3M7Q",state,PublishingLoginService.challenge(verifier),"S256")).isInstanceOf(ResponseStatusException.class);
        verify(db,never()).update(anyString(),any(Object[].class));
    }
    @Test void storesOnlyCodeDigestAndReturnsNoSessionTokens() {
        when(db.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(subject));
        doReturn(new PublishingLoginService.Identity(subject,owner,"HI-26INA-K3M7Q","owner@example.test","Owner",true,null)).when(service).identity(subject);
        String result = service.authorize(person,"publishing-org",redirect,"HI-26INA-K3M7Q",state,PublishingLoginService.challenge(verifier),"S256");
        assertThat(result).startsWith(redirect+"?code=").contains("&state="+state).doesNotContain("token",secret);
        verify(db).update(contains("insert into publishing_login_code"), any(byte[].class), eq("publishing-org"), eq(subject), eq(PublishingLoginService.challenge(verifier)));
    }
    @Test void singleUseCodeIsConsumedByAtomicDeleteBoundToPkceClientAndExpiry() {
        when(db.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of(subject),List.of());
        doReturn(new PublishingLoginService.Identity(subject,owner,"HI-26INA-K3M7Q","owner@example.test","Owner",true,null)).when(service).identity(subject);
        when(db.queryForObject(anyString(),eq(Boolean.class),any(Object[].class))).thenReturn(true);
        var result = service.exchange(secret,"publishing-org",redirect,"c".repeat(43),verifier);
        assertThat(result.get("status")).isEqualTo("VERIFIED");
        assertThatThrownBy(() -> service.exchange(secret,"publishing-org",redirect,"c".repeat(43),verifier)).isInstanceOf(ResponseStatusException.class);
        verify(db,times(2)).query(contains("pkce_challenge = ? and expires_at > now() returning"),any(RowMapper.class),any(byte[].class),eq("publishing-org"),eq(PublishingLoginService.challenge(verifier)));
    }
    @Test void absenceOfConsentCannotReturnVerification() {
        doReturn(new PublishingLoginService.Identity(subject,owner,"HI-26INA-K3M7Q","owner@example.test","Owner",true,null)).when(service).identity(subject);
        when(db.queryForObject(anyString(),eq(Boolean.class),any(Object[].class))).thenReturn(false);
        var result = service.status(secret,"publishing-org",subject);
        assertThat(result.get("status")).isEqualTo("NOT_VERIFIED"); assertThat(result).doesNotContainKey("email");
    }
}

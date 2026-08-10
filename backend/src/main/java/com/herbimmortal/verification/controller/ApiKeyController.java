package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.ApiKey;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.service.ApiKeyService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * API key management, for the account page.
 *
 * <p>Reachable only with an account, which is the whole premise: a key is a
 * long lived credential that acts as its owner, so minting one has to be
 * something a known person did.
 *
 * <h2>Why a key cannot mint another key</h2>
 *
 * Every method here refuses a caller authenticated by an API key. A stolen key
 * that can create more keys is a stolen account: revoking the one that leaked
 * accomplishes nothing, because the thief minted three others before anyone
 * noticed. Requiring a browser session to manage keys means revocation actually
 * ends access.
 */
@RestController
@RequestMapping("/api/v1/me/api-keys")
public class ApiKeyController {

    /** A year. Long enough not to be a nuisance, short enough that a forgotten key expires. */
    private static final Duration DEFAULT_TTL = Duration.ofDays(365);

    private final ApiKeyService apiKeys;

    public ApiKeyController(ApiKeyService apiKeys) {
        this.apiKeys = apiKeys;
    }

    public record CreateRequest(String name, Integer expiresInDays) {
    }

    /**
     * Mints a key and returns it in full. This is the only time that happens.
     *
     * <p>The response says so explicitly rather than leaving the client to know
     * it, because the failure mode is silent: someone closes the dialog, comes
     * back for the value, and there is nothing to come back to.
     */
    @PostMapping
    public ResponseEntity<?> create(@AuthenticationPrincipal UserPrincipal caller,
                                    @RequestBody CreateRequest body) {
        var refusal = refuseIfKeyAuthenticated(caller);
        if (refusal != null) {
            return refusal;
        }

        Duration ttl = body.expiresInDays() == null
                ? DEFAULT_TTL
                : Duration.ofDays(Math.max(1, Math.min(body.expiresInDays(), 3650)));

        ApiKeyService.Created created = apiKeys.create(caller.id(), body.name(), ttl);

        Map<String, Object> response = new LinkedHashMap<>(view(created.record()));
        response.put("key", created.plaintextKey());
        response.put("warning", "Copy this key now. It cannot be shown again.");
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /** Never includes the key itself. There is nothing stored that could. */
    @GetMapping
    public List<Map<String, Object>> list(@AuthenticationPrincipal UserPrincipal caller) {
        return apiKeys.list(caller.id()).stream().map(this::view).toList();
    }

    @DeleteMapping("/{keyId}")
    public ResponseEntity<?> revoke(@AuthenticationPrincipal UserPrincipal caller,
                                    @PathVariable UUID keyId) {
        var refusal = refuseIfKeyAuthenticated(caller);
        if (refusal != null) {
            return refusal;
        }
        apiKeys.revoke(caller.id(), keyId, caller.role());
        return ResponseEntity.noContent().build();
    }

    private ResponseEntity<?> refuseIfKeyAuthenticated(UserPrincipal caller) {
        if (caller.authenticatedBy() == UserPrincipal.AuthMethod.API_KEY) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                    "code", "SESSION_REQUIRED",
                    "message", "Sign in from a browser to manage API keys."));
        }
        return null;
    }

    private Map<String, Object> view(ApiKey key) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", key.getId().toString());
        row.put("name", key.getName());
        // The non secret handle, so a list of keys can be told apart and the
        // right one revoked. Not a prefix of the real key: see ApiKey.
        row.put("prefix", key.getKeyPrefix());
        row.put("createdAt", key.getCreatedAt().toString());
        row.put("expiresAt", key.getExpiresAt() == null ? null : key.getExpiresAt().toString());
        row.put("revokedAt", key.getRevokedAt() == null ? null : key.getRevokedAt().toString());
        // Written at most once every few minutes, so this is "recently used",
        // not "last used". Shown that way in the console.
        row.put("lastUsedAt", key.getLastUsedAt() == null ? null : key.getLastUsedAt().toString());
        row.put("status", key.isUsable(java.time.Instant.now()) ? "ACTIVE"
                : key.getRevokedAt() != null ? "REVOKED" : "EXPIRED");
        return row;
    }
}

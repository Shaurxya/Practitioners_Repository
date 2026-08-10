package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.User;
import com.herbimmortal.verification.repository.PractitionerRepository;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sign up, sign in, refresh, sign out, and "who am I".
 *
 * <p>Everything except {@code /me} is reachable without a credential, which is
 * unavoidable: they are how a credential is obtained. That makes them the most
 * exposed endpoints in the system, and the reasoning about timing, message
 * uniformity and rate limiting lives in {@link AuthService}, not here. This
 * class validates shapes and maps outcomes to status codes.
 */
@RestController
@RequestMapping("/api/v1")
public class AuthController {

    private final AuthService auth;
    private final PractitionerRepository practitioners;

    public AuthController(AuthService auth, PractitionerRepository practitioners) {
        this.auth = auth;
        this.practitioners = practitioners;
    }

    /**
     * No role field, and there must never be one.
     *
     * <p>Binding a role from a public request body means anyone who can POST
     * here can make themselves an administrator, and the request looks entirely
     * ordinary in an access log. Promotion is a separate authenticated action.
     */
    public record RegisterRequest(String email, String password, String fullName) {
    }

    public record LoginRequest(String email, String password) {
    }

    public record RefreshRequest(String refreshToken) {
    }

    @PostMapping("/auth/register")
    public ResponseEntity<?> register(@RequestBody RegisterRequest body, HttpServletRequest request) {
        try {
            var session = auth.register(body.email(), body.password(), body.fullName(),
                    request.getHeader("User-Agent"), clientIp(request));
            return ResponseEntity.status(HttpStatus.CREATED).body(sessionBody(session));

        } catch (AuthService.EmailAlreadyRegisteredException e) {
            // 409 rather than the generic failure used at sign in.
            //
            // This does disclose that an address has an account, and that is a
            // considered trade rather than an oversight: a signup form that
            // refuses without saying why is unusable, and the same fact is
            // obtainable from any password reset flow ever built. Sign in stays
            // uniform, because that is where guessing happens at volume.
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "code", "EMAIL_IN_USE",
                    "message", e.getMessage()));
        }
    }

    @PostMapping("/auth/login")
    public ResponseEntity<?> login(@RequestBody LoginRequest body, HttpServletRequest request) {
        try {
            var session = auth.login(body.email(), body.password(),
                    request.getHeader("User-Agent"), clientIp(request));
            return ResponseEntity.ok(sessionBody(session));

        } catch (AuthService.AuthenticationFailedException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                    "code", "BAD_CREDENTIALS",
                    "message", e.getMessage()));
        }
    }

    /**
     * Exchanges a refresh token for a new pair.
     *
     * <p>This is the endpoint that lets the access token be short. The client
     * calls it silently on a 401 and the person never sees it happen.
     */
    @PostMapping("/auth/refresh")
    public ResponseEntity<?> refresh(@RequestBody RefreshRequest body, HttpServletRequest request) {
        try {
            var session = auth.refresh(body.refreshToken(),
                    request.getHeader("User-Agent"), clientIp(request));
            return ResponseEntity.ok(sessionBody(session));

        } catch (AuthService.AuthenticationFailedException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                    "code", "SESSION_EXPIRED",
                    "message", e.getMessage()));
        }
    }

    /**
     * Always 204, whether or not the token was real.
     *
     * <p>Signing out is not a place to report failure. A client that has decided
     * to end its session has already thrown the credential away, and answering
     * 401 to "please forget this token" only tells a caller whether the token
     * they hold is live.
     */
    @PostMapping("/auth/logout")
    public ResponseEntity<Void> logout(@RequestBody(required = false) RefreshRequest body) {
        auth.logout(body == null ? null : body.refreshToken());
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/auth/logout-all")
    public Map<String, Object> logoutEverywhere(@AuthenticationPrincipal UserPrincipal caller) {
        return Map.of("sessionsEnded", auth.logoutEverywhere(caller.id()));
    }

    /**
     * The caller, read live from the database rather than decoded from the
     * token they presented.
     *
     * <p>The token is a snapshot up to fifteen minutes old. Roles change,
     * accounts get locked, and an Immortal ID gets issued in between. This is
     * the endpoint the client trusts for all of that, which is why it is worth
     * one query.
     */
    @GetMapping("/me")
    public ResponseEntity<?> me(@AuthenticationPrincipal UserPrincipal caller) {
        return auth.byId(caller.id())
                .<ResponseEntity<?>>map(user -> ResponseEntity.ok(userBody(user, caller)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                        "code", "UNAUTHENTICATED",
                        "message", "Sign in to continue.")));
    }

    /** Live sessions, so someone can see where they are signed in and end it. */
    @GetMapping("/me/sessions")
    public List<Map<String, Object>> sessions(@AuthenticationPrincipal UserPrincipal caller) {
        return auth.sessionsFor(caller.id()).stream().map(token -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", token.getId().toString());
            row.put("issuedAt", token.getIssuedAt().toString());
            row.put("expiresAt", token.getExpiresAt().toString());
            row.put("userAgent", token.getUserAgent());
            row.put("ipAddress", token.getIpAddress());
            return row;
        }).toList();
    }

    private Map<String, Object> sessionBody(AuthService.Session session) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("accessToken", session.accessToken());
        body.put("refreshToken", session.refreshToken());
        body.put("expiresInSeconds", session.expiresInSeconds());
        body.put("user", userBody(session.user(), null));
        return body;
    }

    private Map<String, Object> userBody(User user, UserPrincipal caller) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", user.getId().toString());
        body.put("email", user.getEmail());
        body.put("fullName", user.getFullName());
        body.put("role", user.getRole().name());

        // The Immortal ID belongs to a registration, not to a login, so it is
        // looked up rather than stored on the account. Null is the normal
        // answer: nobody has one until a first approval, and reviewers and
        // admins never do. Section 3.1, every read path handles the absence.
        body.put("immortalId", practitioners
                .findFirstByUserIdAndImmortalIdIsNotNullOrderByImmortalIdIssuedAtAsc(user.getId())
                .map(p -> p.getImmortalId())
                .orElse(null));

        // Lets the client tell a browser session from a machine holding an API
        // key, which matters for screens that offer to end the current session.
        body.put("authenticatedBy", caller == null ? "SESSION" : caller.authenticatedBy().name());
        return body;
    }

    /**
     * The caller's address, honouring one proxy hop.
     *
     * <p>X-Forwarded-For is set by the client when nothing strips it, so this
     * value is advisory: it is recorded next to a session for a human to read,
     * and nothing authorizes on it. The moment something does, this has to
     * become a trusted-proxy configuration instead of a header read.
     */
    private static String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma > 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        return request.getRemoteAddr();
    }
}

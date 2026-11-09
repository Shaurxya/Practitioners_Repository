package com.herbimmortal.verification.publishing;

import com.herbimmortal.verification.security.UserPrincipal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/publishing")
public class PublishingLoginController {
    private final PublishingLoginService service;
    public PublishingLoginController(PublishingLoginService service) { this.service = service; }
    public record Authorization(String clientId, String redirectUri, String immortalId, String state, String codeChallenge, String codeChallengeMethod) {}
    public record Exchange(String clientId, String redirectUri, String code, String codeVerifier) {}
    public record Status(String clientId, UUID subject) {}
    @PostMapping("/authorize")
    public ResponseEntity<?> authorize(@AuthenticationPrincipal UserPrincipal user, @RequestBody Authorization body) {
        return reply(Map.of("redirectUrl", service.authorize(user, body.clientId(), body.redirectUri(), body.immortalId(), body.state(), body.codeChallenge(), body.codeChallengeMethod())));
    }
    @PostMapping("/exchange")
    public ResponseEntity<?> exchange(@RequestHeader(value="X-Publishing-Secret", required=false) String secret, @RequestBody Exchange body) {
        return reply(service.exchange(secret, body.clientId(), body.redirectUri(), body.code(), body.codeVerifier()));
    }
    @PostMapping("/status")
    public ResponseEntity<?> status(@RequestHeader(value="X-Publishing-Secret", required=false) String secret, @RequestBody Status body) {
        return reply(service.status(secret, body.clientId(), body.subject()));
    }
    private ResponseEntity<?> reply(Object body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("Referrer-Policy", "no-referrer").body(body);
    }
}

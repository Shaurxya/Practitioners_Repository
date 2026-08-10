package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.service.VerificationService;
import com.herbimmortal.verification.util.ImmortalId;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The platform lookup: "is this Immortal ID verified right now, and what is
 * behind that answer".
 *
 * <p>This is the endpoint D4 is about, and the resolution has moved on from what
 * D4 recorded. It proposed a single shared static API key for v1. What exists
 * now is a per-account key, which is strictly better for the same effort:
 * revoking one consumer does not break every other consumer, the audit log can
 * say which integration asked, and there is no shared secret sitting in several
 * teams' configuration at once. The IP allowlist D4 also wanted is deployment
 * configuration and still applies.
 *
 * <h2>Why this is not just the public endpoint</h2>
 *
 * {@code /api/v1/public/verify} answers a patient: an initial, a surname, a date
 * and a batch. This answers a platform that already has a relationship with the
 * practitioner, so it can carry the council, the medical system and the case
 * that decided it. Two audiences, two shapes, and the narrower one must never
 * grow fields because the wider one needed them.
 *
 * <p>The path says {@code /internal/} so the authentication mechanism is visible
 * in the URL and easy to block at a gateway, which is exactly why section 7
 * moved it off {@code /api/v1/practitioners/}.
 */
@RestController
@RequestMapping("/api/v1/internal")
public class InternalController {

    private final VerificationService verification;
    private final CouncilRepository councils;

    public InternalController(VerificationService verification, CouncilRepository councils) {
        this.verification = verification;
        this.councils = councils;
    }

    @GetMapping("/practitioners/{immortalId}")
    public ResponseEntity<?> lookup(@PathVariable String immortalId,
                                    @AuthenticationPrincipal UserPrincipal caller) {

        if (!ImmortalId.isIssuable(immortalId)) {
            // Refused before the query. A string no generator could have
            // produced is not a lookup, and answering it costs an index probe
            // per request from anyone willing to spend them.
            return notFound();
        }

        Map<String, Object> found = verification.publicVerify(immortalId);
        if (found.isEmpty()) {
            return notFound();
        }

        VerificationCase decided = (VerificationCase) found.get("case");
        Practitioner practitioner = (Practitioner) found.get("practitioner");

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("immortalId", practitioner.getImmortalId());
        body.put("status", "VERIFIED");
        body.put("fullName", decided.getClaimedFullName());
        body.put("councilCode", decided.getClaimedCouncil());
        body.put("council", councils.findById(decided.getClaimedCouncil())
                .map(c -> c.getCanonicalName()).orElse(decided.getClaimedCouncil()));
        body.put("countryCode", practitioner.getCountryCode());
        body.put("medicalSystemCode", practitioner.getMedicalSystemCode());
        body.put("registrationNumber", decided.getClaimedRegistrationNumber());
        body.put("verifiedAsOf", decided.getDecidedAt().toString().substring(0, 10));
        body.put("caseId", decided.getId().toString());
        // Read live from the current case every time, never cached and never a
        // stored flag. Non negotiable 3: a revoked practitioner has to stop
        // reading as verified here the moment the case flips, and a consumer
        // caching this response is making its own decision about that.
        body.put("checkedAt", java.time.Instant.now().toString());
        return ResponseEntity.ok(body);
    }

    /**
     * 404 for both "no such ID" and "not verified".
     *
     * <p>Same rule as the public endpoint. A caller holding a valid key still
     * must not be able to walk the ID space and learn which identifiers exist,
     * because a key is a credential for asking about practitioners you already
     * know, not for enumerating the register.
     */
    private static ResponseEntity<?> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "code", "NOT_VERIFIED",
                "message", "No verified practitioner for that Immortal ID."));
    }
}

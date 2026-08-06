package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.service.VerificationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * The public answer to "is this practitioner verified right now".
 *
 * No auth, and deliberately so: this is what a patient or an employer calls.
 *
 * Two rules it must never break. An unknown ID and an unverified one produce
 * the same body, so the endpoint cannot be walked to discover which IDs exist.
 * And status is read live from the current case rather than a stored flag, so a
 * revoked practitioner stops reading as verified the moment the case flips.
 */
@RestController
@RequestMapping("/api/v1/public")
public class PublicVerifyController {

    private final VerificationService verification;
    private final CouncilRepository councils;

    public PublicVerifyController(VerificationService verification, CouncilRepository councils) {
        this.verification = verification;
        this.councils = councils;
    }

    @GetMapping("/verify")
    public Map<String, Object> verify(@RequestParam(defaultValue = "") String immortalId) {
        Map<String, Object> found = verification.publicVerify(immortalId);

        if (found.isEmpty()) {
            return notVerified(immortalId);
        }

        VerificationCase approved = (VerificationCase) found.get("case");
        String council = councils.findById(approved.getClaimedCouncil())
                .map(c -> c.getCanonicalName())
                .orElse(approved.getClaimedCouncil());

        return Map.of(
                "immortalId", immortalId,
                // Initial plus surname. A verification answer needs enough to
                // recognise the person in front of you and no more.
                "displayName", displayName(approved.getClaimedFullName()),
                "status", "VERIFIED",
                "verifiedAsOf", approved.getDecidedAt().toString().substring(0, 10),
                "registrySourceBatch", "live-registry",
                "council", council);
    }

    private static Map<String, Object> notVerified(String immortalId) {
        return Map.of("immortalId", immortalId, "displayName", "", "status", "NOT_VERIFIED",
                "verifiedAsOf", "", "registrySourceBatch", "", "council", "");
    }

    private static String displayName(String fullName) {
        String[] parts = fullName.trim().split("\\s+");
        if (parts.length < 2) {
            return parts.length == 1 ? parts[0] : "";
        }
        return parts[0].charAt(0) + ". " + parts[parts.length - 1];
    }
}

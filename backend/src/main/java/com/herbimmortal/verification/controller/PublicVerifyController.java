package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.repository.CouncilRepository;
import com.herbimmortal.verification.repository.CountryRepository;
import com.herbimmortal.verification.repository.MedicalSystemRepository;
import com.herbimmortal.verification.service.VerificationService;
import com.herbimmortal.verification.util.ImmortalId;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
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
    private final CountryRepository countries;
    private final MedicalSystemRepository medicalSystems;

    public PublicVerifyController(VerificationService verification, CouncilRepository councils,
                                  CountryRepository countries, MedicalSystemRepository medicalSystems) {
        this.verification = verification;
        this.councils = councils;
        this.countries = countries;
        this.medicalSystems = medicalSystems;
    }

    @GetMapping("/verify")
    public Map<String, Object> verify(@RequestParam(defaultValue = "") String immortalId) {
        // Shape check before the query. A string that no generator could ever
        // have produced is not a lookup, and answering it costs an index probe
        // per request from anyone who wants to spend them.
        if (!ImmortalId.isIssuable(immortalId)) {
            return notVerified(immortalId);
        }

        Map<String, Object> found = verification.publicVerify(immortalId);

        if (found.isEmpty()) {
            return notVerified(immortalId);
        }

        VerificationCase approved = (VerificationCase) found.get("case");
        Practitioner practitioner = (Practitioner) found.get("practitioner");

        String council = councils.findById(approved.getClaimedCouncil())
                .map(c -> c.getCanonicalName())
                .orElse(approved.getClaimedCouncil());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("immortalId", immortalId);
        // Initial plus surname. A verification answer needs enough to recognise
        // the person in front of you and no more.
        body.put("displayName", displayName(approved.getClaimedFullName()));
        body.put("status", "VERIFIED");
        body.put("verifiedAsOf", approved.getDecidedAt().toString().substring(0, 10));
        body.put("registrySourceBatch", "live-registry");
        body.put("council", council);
        // Read from the practitioner, not decoded from the string in the query.
        // Decoding would make the caller's own input the source of the answer,
        // and a legacy ID carries neither segment at all.
        body.put("country", countryName(practitioner.getCountryCode()));
        body.put("countryCode", practitioner.getCountryCode());
        body.put("medicalSystem", medicalSystemName(practitioner.getMedicalSystemCode()));
        return body;
    }

    /**
     * Byte for byte the same keys as a verified answer, so an unknown ID and an
     * unverified one cannot be told apart. A missing key here would leak
     * existence through the response shape rather than through its values,
     * which is the version of this bug that survives a review of the values.
     */
    private static Map<String, Object> notVerified(String immortalId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("immortalId", immortalId);
        body.put("displayName", "");
        body.put("status", "NOT_VERIFIED");
        body.put("verifiedAsOf", "");
        body.put("registrySourceBatch", "");
        body.put("council", "");
        body.put("country", "");
        body.put("countryCode", "");
        body.put("medicalSystem", "");
        return body;
    }

    private String countryName(String code) {
        return countries.findById(code).map(c -> c.getName()).orElse(code);
    }

    private String medicalSystemName(String code) {
        return medicalSystems.findById(code).map(m -> m.getName()).orElse(code);
    }

    private static String displayName(String fullName) {
        String[] parts = fullName.trim().split("\\s+");
        if (parts.length < 2) {
            return parts.length == 1 ? parts[0] : "";
        }
        return parts[0].charAt(0) + ". " + parts[parts.length - 1];
    }
}

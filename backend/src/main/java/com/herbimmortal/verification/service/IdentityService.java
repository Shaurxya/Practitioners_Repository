package com.herbimmortal.verification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.herbimmortal.verification.identity.IdentityVerificationProvider;
import com.herbimmortal.verification.identity.ManualIdentityProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Runs the identity check for one case and records what came back.
 *
 * <p>Chooses the provider deterministically: any real provider on the classpath
 * beats {@link ManualIdentityProvider}. Spring injects every implementation of
 * an interface as a {@code List} when asked, which is the same collection
 * injection the rule catalog is built on. The FastAPI equivalent is collecting
 * implementations from a registry rather than importing one by name.
 *
 * <p>Selecting here rather than with {@code @ConditionalOnMissingBean} is on
 * purpose. That annotation resolves against bean definition order, and "which
 * system verified this person's identity" is not a question whose answer should
 * depend on classpath scanning order.
 */
@Service
public class IdentityService {

    private static final Logger log = LoggerFactory.getLogger(IdentityService.class);

    private final JdbcTemplate jdbc;
    private final DocumentService documents;
    private final ObjectMapper json;
    private final IdentityVerificationProvider provider;

    public IdentityService(JdbcTemplate jdbc, DocumentService documents, ObjectMapper json,
                           List<IdentityVerificationProvider> providers) {
        this.jdbc = jdbc;
        this.documents = documents;
        this.json = json;
        this.provider = providers.stream()
                .filter(p -> !ManualIdentityProvider.NAME.equals(p.name()))
                .findFirst()
                .orElseGet(() -> providers.stream()
                        .filter(p -> ManualIdentityProvider.NAME.equals(p.name()))
                        .findFirst()
                        .orElseThrow(() -> new IllegalStateException(
                                "No IdentityVerificationProvider is available")));
        log.info("identity verification provider: {}", provider.name());
    }

    /**
     * The outcome of checking one case's documents, in the shape the rules read.
     *
     * @param submitted whether the claimant supplied both images at all. False
     *                  is different from a provider that could not decide, and
     *                  the rules answer differently for each.
     */
    public record Check(boolean submitted, String outcome,
                        Double faceMatchScore, Double livenessScore) {

        public static Check notSubmitted() {
            return new Check(false, "UNAVAILABLE", null, null);
        }
    }

    /**
     * Verifies and persists, returning what the rule catalog needs.
     *
     * <p>The images are handed over as suppliers so a provider that does not
     * look at pixels causes neither a decryption nor the audit event that every
     * read requires. The manual provider takes that path, which is why storing
     * a passport does not by itself produce a read of it.
     */
    public Check verify(UUID caseId, UUID ownerUserId, String claimedName,
                        UUID photoIdDocumentId, UUID selfieDocumentId) {

        if (photoIdDocumentId == null || selfieDocumentId == null) {
            return Check.notSubmitted();
        }

        var result = provider.verify(new IdentityVerificationProvider.Request(
                caseId,
                () -> documents.read(photoIdDocumentId, ownerUserId, "identity check").content(),
                () -> documents.read(selfieDocumentId, ownerUserId, "identity check").content(),
                claimedName));

        persist(caseId, result);
        return new Check(true, result.outcome(), result.faceMatchScore(), result.livenessScore());
    }

    private void persist(UUID caseId, IdentityVerificationProvider.Result result) {
        try {
            jdbc.update("insert into identity_checks (case_id, provider, provider_ref, outcome,"
                            + " face_match_score, liveness_score, evidence)"
                            + " values (?,?,?,?,?,?,?::jsonb)"
                            + " on conflict (case_id) do nothing",
                    caseId, provider.name(), result.providerRef(), result.outcome(),
                    result.faceMatchScore(), result.livenessScore(),
                    json.writeValueAsString(result.evidence() == null ? Map.of() : result.evidence()));
        } catch (Exception e) {
            // The verdict is already reflected in the rules and the decision.
            // Losing the audit row is bad and is not a reason to fail a claim
            // that has otherwise been decided.
            log.error("could not record identity check for case {}", caseId, e);
        }
    }

    /** What the review console shows a person about the automated check. */
    public List<Map<String, Object>> forCase(UUID caseId) {
        return jdbc.queryForList(
                "select provider, outcome, face_match_score, liveness_score, checked_at"
                        + " from identity_checks where case_id = ?", caseId);
    }
}

package com.herbimmortal.verification.identity;

import org.springframework.stereotype.Component;

/**
 * The fallback provider: store both images and route the case to a person.
 *
 * <p><b>This is not a stub.</b> It is the honest answer to "no KYC vendor is
 * configured", and the resulting system works end to end: the photo ID and the
 * selfie are captured, encrypted and linked to the case, the three identity
 * rules read PENDING_HUMAN as REVIEW, the case lands in MANUAL_REVIEW, and a
 * reviewer opens the two images side by side and decides. A human is the
 * liveness check until a provider replaces them.
 *
 * <p>Returning PASS here would have been the easy way to keep auto approval
 * working through this phase, and it would be a lie recorded in a column that
 * claims a liveness check happened. Returning FAIL would reject every honest
 * practitioner. PENDING_HUMAN is the only true answer, and non negotiable 8
 * already says ambiguity goes to a person.
 *
 * <p>Note it never calls {@code get()} on either image supplier. It has no
 * opinion about the pixels, so it must not cause a decryption or the audit
 * event that every read requires. The reviewer's own read is the one that gets
 * logged, against their name, which is the read that actually happened.
 *
 * <p>Selection is by {@link IdentityService}, which prefers any other provider
 * on the classpath over this one. That is deliberate rather than
 * {@code @ConditionalOnMissingBean}: that annotation is an auto-configuration
 * mechanism whose result depends on bean definition order, and "which thing
 * verified this person's identity" is not a question to leave to scan order.
 */
@Component
public class ManualIdentityProvider implements IdentityVerificationProvider {

    public static final String NAME = "manual";

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public Result verify(Request request) {
        return Result.pendingHuman(
                "No identity verification provider is configured, so the photo ID and selfie "
                        + "were stored for a reviewer to compare.");
    }
}

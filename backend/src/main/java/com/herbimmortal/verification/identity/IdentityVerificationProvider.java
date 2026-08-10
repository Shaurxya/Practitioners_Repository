package com.herbimmortal.verification.identity;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Decides whether the person who uploaded a selfie is the person on the photo ID.
 *
 * <h2>Why this is an interface</h2>
 *
 * Section 2 of CLAUDE.md fixes the stack and no KYC vendor is in it. Liveness
 * detection is not something to write: it is a specialist product, and a
 * home made version is worse than none because it looks like a control and is
 * not one. So the vendor sits behind this port, and the system ships with
 * {@link ManualIdentityProvider}, which is not a stub. The whole flow runs on a
 * laptop today with no contract signed, and turning a vendor on is a config
 * change rather than a rewrite.
 *
 * <h2>What any implementation of this can and cannot prove</h2>
 *
 * The chain is: a live person, holding this government ID, whose name matches
 * the name on the register.
 *
 * <p><b>The registry holds no photograph.</b> So the face is bound to the ID
 * document and never to the registration; the only link from the ID to the
 * registration is the name. Two people with the same name in the same council
 * is the residual attack and no provider behind this interface closes it. Only
 * a register that publishes photographs would. Worth knowing before anyone
 * concludes that liveness makes impersonation impossible: it makes it
 * expensive.
 */
public interface IdentityVerificationProvider {

    /**
     * Recorded on every check. A case decided under the manual provider and one
     * decided by a vendor are different evidence, and in a year nobody will
     * remember which was running when.
     */
    String name();

    /**
     * The two images, and what the claimant says their name is.
     *
     * <p>The images are {@link Supplier}s rather than byte arrays on purpose.
     * Every document read costs a decryption and, per non negotiable 5, an
     * audit event. A provider that does not look at the pixels, which is
     * exactly what the manual one does, must not cause either. Calling
     * {@code get()} is the act of reading someone's passport, so it should be
     * something an implementation does deliberately.
     */
    record Request(UUID caseId,
                   Supplier<byte[]> photoId,
                   Supplier<byte[]> selfie,
                   String claimedName) {
    }

    /**
     * @param outcome         PASS, FAIL, PENDING_HUMAN or UNAVAILABLE
     * @param faceMatchScore  null when nothing computed one. Null is not zero:
     *                        "nobody looked" and "looked and found no
     *                        resemblance" must never collapse into one value
     * @param livenessScore   same
     * @param providerRef     the vendor's own id for this check, for support
     * @param evidence        the raw response, kept verbatim so a later change
     *                        to the provider's shape or thresholds cannot
     *                        rewrite what we were told at decision time
     */
    record Result(String outcome,
                  Double faceMatchScore,
                  Double livenessScore,
                  String providerRef,
                  Map<String, Object> evidence) {

        public static Result pendingHuman(String why) {
            return new Result("PENDING_HUMAN", null, null, null, Map.of("reason", why));
        }

        public static Result unavailable(String why) {
            return new Result("UNAVAILABLE", null, null, null, Map.of("reason", why));
        }
    }

    Result verify(Request request);
}

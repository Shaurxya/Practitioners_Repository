package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.service.RegistryLookupService;
import com.herbimmortal.verification.service.VerificationService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The practitioner facing API.
 *
 * Note what this response does NOT carry: candidates, rule codes, match
 * confidence, the registry snapshot. Those live only on the admin response.
 * Mapping NAME_MATCH or NOT_EXPIRED straight to a message would confirm that a
 * guessed registration number exists on the register, which turns this endpoint
 * into a lookup oracle. Every pre-approval failure collapses into one code.
 */
@RestController
@RequestMapping("/api/v1/verifications")
public class VerificationController {

    private final VerificationService verification;
    private final RegistryLookupService lookup;

    public VerificationController(VerificationService verification, RegistryLookupService lookup) {
        this.verification = verification;
        this.lookup = lookup;
    }

    public record LookupRequest(String council, String registrationNumber) {
    }

    /**
     * Step 1 of the claim wizard: does the register hold this registration.
     *
     * <p>POST rather than GET, and it is not an oversight. A registration number
     * in a query string ends up in the browser history, the access log, the
     * referrer header of any outbound link on the page, and every proxy in
     * between. The body keeps it out of all four. The resource being created is
     * the audit event.
     *
     * <p>Signed in, budgeted and audited, all three enforced in
     * {@code RegistryLookupService}. Without them this endpoint is the lookup
     * oracle the class comment above warns about, just with a friendlier
     * response body.
     *
     * <p>Nothing here is remembered. No case is created, and the record this
     * found is not carried to submit: {@code uq_practitioner_open_case} allows
     * one open case per practitioner, so a draft made here and abandoned would
     * lock that person out permanently.
     */
    @PostMapping("/lookup")
    public RegistryLookupService.LookupResult lookup(@RequestBody LookupRequest body,
                                                     @AuthenticationPrincipal UserPrincipal caller) {
        return lookup.lookup(body.council(), body.registrationNumber(), caller.id());
    }

    /**
     * country and medicalSystem are new in V9 and both feed the Immortal ID.
     *
     * country is checked against the council rather than trusted: the council
     * knows which country it registers in, and a claim whose two answers
     * disagree is rejected instead of silently resolved.
     */
    /**
     * photoIdDocumentId and selfieDocumentId are the persona verification step.
     *
     * <p>Both are optional at this layer and that is deliberate. The portal
     * always sends them, but the scheduled re-verification job re-checks an
     * approved practitioner against a fresh registry batch with nobody at a
     * keyboard, so it has no new images to offer. Rejecting a claim without
     * them here would make that job impossible; instead IDENTITY_DOCUMENTS
     * returns REVIEW and a person looks, which is non negotiable 8.
     */
    public record SubmitRequest(String fullName, String registrationNumber, String council,
                                String specialty, String country, String medicalSystem,
                                UUID photoIdDocumentId, UUID selfieDocumentId) {
    }

    @PostMapping
    public ResponseEntity<?> submit(@RequestBody SubmitRequest body,
                                    @AuthenticationPrincipal UserPrincipal caller) {
        try {
            VerificationCase created = verification.submit(body.fullName(), body.registrationNumber(),
                    body.council(), body.specialty(), body.country(), body.medicalSystem(),
                    caller.id(), body.photoIdDocumentId(), body.selfieDocumentId());
            // 202: accepted. The decision is already made because matching is an
            // indexed lookup, but the contract stays 202 so the portal keeps
            // polling and an asynchronous version needs no client change.
            return ResponseEntity.status(HttpStatus.ACCEPTED).body(view(created));
        } catch (VerificationService.ClaimAlreadyOpenException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "code", "CLAIM_ALREADY_OPEN",
                    "caseId", e.caseId.toString(),
                    "submittedAt", e.submittedAt));
        }
    }

    /**
     * Someone else's case answers 404, not 403. See
     * {@code VerificationService.requireVisibleTo}: the difference between the
     * two status codes is an oracle for which case ids exist.
     */
    @GetMapping("/{caseId}")
    public CaseView get(@PathVariable UUID caseId, @AuthenticationPrincipal UserPrincipal caller) {
        return view(verification.requireVisibleTo(caseId, caller.id(), caller.role().canReview()));
    }

    /**
     * The caller's own claims.
     *
     * <p>This used to call {@code verification.all()}, which returned every case
     * in the database to every caller: other people's claimed names,
     * registration numbers and councils, on an endpoint any browser could hit.
     * The filter belongs in the query rather than after it, so a page of
     * results is a page of this person's results.
     */
    @GetMapping
    public List<CaseView> mine(@AuthenticationPrincipal UserPrincipal caller) {
        return verification.mine(caller.id()).stream().map(this::view).toList();
    }

    private CaseView view(VerificationCase c) {
        var practitioner = verification.practitionerFor(c);
        boolean approved = "APPROVED".equals(c.getStatus());
        boolean open = List.of("MANUAL_REVIEW", "NO_MATCH", "SUBMITTED", "RULES_EVAL").contains(c.getStatus());

        String outcome = approved ? "VERIFIED"
                : "REJECTED".equals(c.getStatus()) ? "COULD_NOT_VERIFY"
                : open ? "IN_REVIEW" : "IN_PROGRESS";

        return new CaseView(
                c.getId().toString(),
                c.getStatus(),
                outcome,
                c.getSubmittedAt().toString(),
                c.getDecidedAt() == null ? null : c.getDecidedAt().toString(),
                new Claim(c.getClaimedFullName(), c.getClaimedRegistrationNumber(),
                        c.getClaimedCouncil(), c.getClaimedSpecialty(),
                        c.getClaimedCountry(), c.getClaimedMedicalSystem()),
                List.of(
                        new Step("SUBMITTED", "DONE"),
                        new Step("CHECKING", "DONE"),
                        new Step("REVIEW", open ? "ACTIVE" : approved && c.getDecidedBy() != null
                                && !"system".equals(c.getDecidedBy()) ? "DONE" : "SKIPPED"),
                        new Step("DECISION", open ? "PENDING" : "DONE")),
                approved ? c.getDecidedAt().toString().substring(0, 10) : null,
                approved ? "live-registry" : null,
                approved ? practitioner.getImmortalId() : null);
    }

    public record Claim(String fullName, String registrationNumber, String council, String specialty,
                        String country, String medicalSystem) {
    }

    public record Step(String step, String state) {
    }

    public record CaseView(String caseId, String status, String outcomeCode, String submittedAt,
                           String decidedAt, Claim claim, List<Step> progress, String verifiedAsOf,
                           String registrySourceBatch, String immortalId) {
    }
}

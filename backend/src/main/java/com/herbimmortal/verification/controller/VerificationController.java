package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.domain.VerificationCase;
import com.herbimmortal.verification.service.VerificationService;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
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
@Profile("!prod")
public class VerificationController {

    private final VerificationService verification;

    public VerificationController(VerificationService verification) {
        this.verification = verification;
    }

    public record SubmitRequest(String fullName, String registrationNumber, String council,
                                String specialty) {
    }

    @PostMapping
    public ResponseEntity<?> submit(@RequestBody SubmitRequest body) {
        try {
            VerificationCase created = verification.submit(body.fullName(), body.registrationNumber(),
                    body.council(), body.specialty());
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

    @GetMapping("/{caseId}")
    public CaseView get(@PathVariable UUID caseId) {
        return view(verification.require(caseId));
    }

    @GetMapping
    public List<CaseView> mine() {
        return verification.all().stream().map(this::view).toList();
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
                        c.getClaimedCouncil(), c.getClaimedSpecialty()),
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

    public record Claim(String fullName, String registrationNumber, String council, String specialty) {
    }

    public record Step(String step, String state) {
    }

    public record CaseView(String caseId, String status, String outcomeCode, String submittedAt,
                           String decidedAt, Claim claim, List<Step> progress, String verifiedAsOf,
                           String registrySourceBatch, String immortalId) {
    }
}

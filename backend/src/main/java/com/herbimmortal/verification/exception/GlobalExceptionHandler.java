package com.herbimmortal.verification.exception;

import com.herbimmortal.verification.domain.Practitioner;
import com.herbimmortal.verification.extraction.ExtractionException;
import com.herbimmortal.verification.service.RegistryLookupService;
import com.herbimmortal.verification.service.VerificationService;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.time.Instant;
import java.util.Map;

/**
 * One place that turns an exception into an HTTP response.
 *
 * {@code @RestControllerAdvice} applies across every controller, which is what
 * FastAPI's exception_handler decorators or an Express error middleware do. The
 * body shape matches what the React apiClient already parses: code, message,
 * timestamp.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ExtractionException.class)
    public ResponseEntity<Map<String, Object>> extraction(ExtractionException e) {
        // 502: this service is fine, the one it depends on is not. A 500 would
        // send an operator looking in the wrong log.
        return body(HttpStatus.BAD_GATEWAY, e.failureCode(), e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> badRequest(IllegalArgumentException e) {
        return body(HttpStatus.BAD_REQUEST, "BAD_REQUEST", e.getMessage());
    }

    /**
     * 404 for a case that does not exist AND for one belonging to somebody
     * else. Section 7.3.
     *
     * <p>The two have to be indistinguishable. If a case someone else owns
     * answered 403 while a made up id answered 404, a caller walking ids learns
     * precisely which ones are real without ever seeing their contents. The
     * message is deliberately the same for both.
     */
    @ExceptionHandler(VerificationService.CaseNotFoundException.class)
    public ResponseEntity<Map<String, Object>> caseNotFound(VerificationService.CaseNotFoundException e) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "No such case.");
    }

    /**
     * 404 for a document that does not exist AND for one belonging to somebody
     * else, for the same reason cases answer 404. A caller attaching document
     * ids to a claim must not learn which ids are real by the difference
     * between 403 and 404.
     */
    @ExceptionHandler(com.herbimmortal.verification.service.DocumentService.DocumentNotFoundException.class)
    public ResponseEntity<Map<String, Object>> documentNotFound(
            com.herbimmortal.verification.service.DocumentService.DocumentNotFoundException e) {
        return body(HttpStatus.NOT_FOUND, "NOT_FOUND", "No such document.");
    }

    /**
     * 413. The file is bigger than the servlet container will accept, which is
     * a different problem from a file this application chose to refuse.
     */
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> tooLarge(
            org.springframework.web.multipart.MaxUploadSizeExceededException e) {
        return body(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE",
                "That file is too large. Upload a photo under 10 MB.");
    }

    /**
     * 409. Two accounts claiming one registration is a mistake or an
     * impersonation attempt, and either way a person has to look at it.
     */
    @ExceptionHandler(Practitioner.RegistrationAlreadyClaimedException.class)
    public ResponseEntity<Map<String, Object>> alreadyClaimed(
            Practitioner.RegistrationAlreadyClaimedException e) {
        return body(HttpStatus.CONFLICT, "REGISTRATION_CLAIMED", e.getMessage());
    }

    /**
     * 429. The account is fine, the request is fine, there have just been too
     * many of them.
     *
     * <p>Deliberately not 403. The React apiClient treats 403 as "your account
     * cannot do that", which is permanent and sends the user nowhere useful.
     * 429 is a wait, and the message says how long.
     */
    @ExceptionHandler(RegistryLookupService.LookupBudgetExceededException.class)
    public ResponseEntity<Map<String, Object>> lookupBudget(
            RegistryLookupService.LookupBudgetExceededException e) {
        return body(HttpStatus.TOO_MANY_REQUESTS, "LOOKUP_RATE_LIMITED", e.getMessage());
    }

    /** A duplicate upload is a conflict, not a failure: the batch already exists. */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> conflict(IllegalStateException e) {
        return body(HttpStatus.CONFLICT, "ALREADY_EXISTS", e.getMessage());
    }

    /**
     * A body that is not JSON, or not the JSON this endpoint expects.
     *
     * <p>Handled here only so the response carries {code, message, timestamp}.
     * Spring's default answer is already a 400, but its body is
     * {timestamp, status, error, path} with no message field, and
     * {@code ApiRequestError} is constructed from {@code body.message}. So the
     * status was right and every such error reached the user as an empty
     * string.
     *
     * <p>The parser's own message is not passed through: it names Java classes
     * and character offsets, which tells a user nothing and an attacker a little.
     */
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> unreadable(
            org.springframework.http.converter.HttpMessageNotReadableException e) {
        return body(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST",
                "That request could not be read. Check the fields and try again.");
    }

    /**
     * A constraint the application did not anticipate. 500, and deliberately
     * vague to the caller.
     *
     * <p>Without this, a violation escaped to the container, which forwarded to
     * /error, which used to come back 401. Even with that forward now permitted,
     * the default body is a Spring error page rather than the {code, message,
     * timestamp} shape the React apiClient parses.
     *
     * <p>The message is not passed through. A constraint violation message names
     * tables, columns and index names, and this handler covers unique indexes on
     * registrations and open cases, so echoing it would tell a caller which
     * registrations already exist. The detail goes to the log, where an operator
     * can read it and a claimant cannot.
     */
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    public ResponseEntity<Map<String, Object>> dataIntegrity(
            org.springframework.dao.DataIntegrityViolationException e) {
        LoggerFactory.getLogger(GlobalExceptionHandler.class)
                .error("unhandled constraint violation", e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
                "Something went wrong at our end. Your details were not saved.");
    }

    private ResponseEntity<Map<String, Object>> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "code", code,
                "message", message == null ? status.getReasonPhrase() : message,
                "timestamp", Instant.now().toString()));
    }
}

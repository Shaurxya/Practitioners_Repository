package com.herbimmortal.verification.exception;

import com.herbimmortal.verification.extraction.ExtractionException;
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

    /** A duplicate upload is a conflict, not a failure: the batch already exists. */
    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> conflict(IllegalStateException e) {
        return body(HttpStatus.CONFLICT, "ALREADY_EXISTS", e.getMessage());
    }

    private ResponseEntity<Map<String, Object>> body(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(Map.of(
                "code", code,
                "message", message == null ? status.getReasonPhrase() : message,
                "timestamp", Instant.now().toString()));
    }
}

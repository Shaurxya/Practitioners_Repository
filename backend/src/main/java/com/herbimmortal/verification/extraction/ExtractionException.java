package com.herbimmortal.verification.extraction;

/**
 * Carries one of the failure codes from the import_batch schema, so the console
 * can render a specific screen rather than "something went wrong".
 *
 * A RuntimeException rather than a checked one on purpose: every caller in the
 * import pipeline handles this the same way, by recording the code on the batch
 * and moving it to a failed state. Forcing a catch at each level would add
 * noise without adding a decision.
 */
public class ExtractionException extends RuntimeException {

    private final String failureCode;

    public ExtractionException(String failureCode, String detail, Throwable cause) {
        super(detail, cause);
        this.failureCode = failureCode;
    }

    public String failureCode() {
        return failureCode;
    }
}

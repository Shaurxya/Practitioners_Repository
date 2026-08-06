package com.herbimmortal.verification.extraction;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Where the extraction sidecar is, and how long to wait for it.
 *
 * {@code @ConfigurationProperties} binds a block of application.yml to a typed
 * object, validated at startup. The FastAPI equivalent is a pydantic Settings
 * class; the Express equivalent is reading process.env by hand and hoping.
 *
 * Two timeouts because the two calls are nothing alike. Classification reads
 * character counts and returns in seconds. Extraction on a scanned 400 page
 * register is an OCR run, and a timeout tuned for the first would kill every
 * one of the second.
 */
@ConfigurationProperties(prefix = "app.extraction")
public record ExtractionProperties(
        String baseUrl,
        Duration classifyTimeout,
        Duration extractTimeout,
        String uploadDir) {

    public ExtractionProperties {
        if (baseUrl == null || baseUrl.isBlank()) {
            baseUrl = "http://localhost:8000";
        }
        if (classifyTimeout == null) {
            classifyTimeout = Duration.ofMinutes(2);
        }
        if (extractTimeout == null) {
            extractTimeout = Duration.ofMinutes(30);
        }
        if (uploadDir == null || uploadDir.isBlank()) {
            uploadDir = "../data/uploads";
        }
    }
}

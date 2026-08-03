package com.herbimmortal.verification.ingestion;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Binds the app.ingest.* block from application.yml into a typed object.
 *
 * @ConfigurationProperties is Spring's answer to pydantic-settings: keys are
 * bound and converted once at startup, so a typo surfaces as a boot failure
 * rather than a null at 3am.
 *
 * @param file      path to the registry export
 * @param batchSize rows per JDBC batch, see RegistryIngestionService
 */
@ConfigurationProperties(prefix = "app.ingest")
public record IngestionProperties(String file, int batchSize) {

    public IngestionProperties {
        if (batchSize <= 0) {
            batchSize = 500;
        }
    }
}

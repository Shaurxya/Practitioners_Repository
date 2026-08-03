package com.herbimmortal.verification.ingestion;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/**
 * Runs the registry import once, at startup, then leaves the app running.
 *
 * ApplicationRunner is a Spring Boot interface with a single run method that
 * fires after the context is fully started but before the app is considered
 * ready. The nearest FastAPI equivalent is a lifespan startup hook, except this
 * one is really a CLI entry point that happens to boot the whole container so
 * it can reuse the same DataSource, the same Normalizer, and the same
 * configuration as the web app. That reuse is the point: an import that
 * normalizes differently from the matcher is the bug this design prevents.
 *
 * @Profile("import") means the bean is only created when that profile is
 * active. Not disabled, not skipped: never constructed. A normal boot has no
 * importer in it at all, so it cannot fire by accident.
 *
 *     mvnw spring-boot:run -Dspring-boot.run.profiles=local,import
 *
 * Profiles compose, so "local,import" gets local's SQL logging as well.
 */
@Component
@Profile("import")
public class RegistryIngestionRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RegistryIngestionRunner.class);

    private final RegistryIngestionService service;

    public RegistryIngestionRunner(RegistryIngestionService service) {
        this.service = service;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        log.info("Import profile active, starting registry ingestion");
        IngestionReport report = service.ingest();
        if (!report.reconciles()) {
            // Non-zero exit would be better in a real CLI, but throwing here
            // would also kill the web context. Loud logging is the compromise
            // until this becomes a proper job in step 10.
            log.error("RECONCILIATION FAILED for batch {}", report.sourceBatch());
        }
    }
}

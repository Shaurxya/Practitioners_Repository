package com.herbimmortal.verification.config;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;

class SecretSafetyConfigurationTest {
    private static final String SIGNING = Base64.getEncoder().encodeToString(
            "herbimmortal-test-only-signing-key-not-for-production".getBytes(StandardCharsets.UTF_8));
    private static final String MASTER = "aGVyYmltbW9ydGFsLXRlc3Qtb25seS1tYXN0ZXIta2U=";

    private ApplicationContextRunner runner(String... profiles) {
        return new ApplicationContextRunner().withUserConfiguration(SecretSafetyConfiguration.class)
                .withInitializer(context -> context.getEnvironment().setActiveProfiles(profiles))
                .withPropertyValues("spring.profiles.active=" + String.join(",", profiles),
                        "app.auth.secret=" + SIGNING, "app.documents.master-key=" + MASTER);
    }

    private String randomKey() {
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    @Test void permitsPublicFixturesOnlyInTest() {
        runner("test").run(context -> assertThat(context).hasNotFailed());
        runner("local").run(context -> assertThat(context).hasFailed());
        runner("prod").run(context -> assertThat(context).hasFailed());
        runner("test", "prod").run(context -> assertThat(context).hasFailed());
        runner("test", "production").run(context -> assertThat(context).hasFailed());
        runner().run(context -> assertThat(context).hasFailed());
    }

    @Test void rejectsMissingAndShortSecretsEvenWhenTestsAreRunning() {
        for (String value : new String[] {"", "short"}) {
            runner("test").withPropertyValues("app.auth.secret=" + value)
                    .run(context -> assertThat(context).hasFailed());
            runner("test").withPropertyValues("app.documents.master-key=" + value)
                    .run(context -> assertThat(context).hasFailed());
        }
    }

    @Test void rejectsKnownTestMasterEvenWithADifferentValidSigningKey() {
        runner("prod").withPropertyValues("app.auth.secret=" + randomKey())
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure()).hasMessageContaining("DOCUMENT_MASTER_KEY");
                });
    }

    @Test void acceptsValidNonFixtureConfigurationWithoutStartingARealApplication() {
        runner("prod").withPropertyValues(
                "app.auth.secret=" + randomKey(),
                "app.documents.master-key=" + randomKey())
                .run(context -> assertThat(context).hasNotFailed());
    }

    @Test void rejectsFixtureStorageDatabaseAndPublishingConfigurationOutsideTest() {
        for (String property : new String[] {
                "spring.datasource.password=herbimmortal-test-only-postgres",
                "app.documents.secret-key=herbimmortal-test-only-storage",
                "PUBLISHING_CLIENT_SECRET_SHA256=aaa443120c3126decc3d65a9cd4b6700a525f1ee5fa6233a6189f119cc077c5d"}) {
            runner("prod").withPropertyValues(
                    "app.auth.secret=" + randomKey(),
                    "app.documents.master-key=" + randomKey(), property)
                    .run(context -> assertThat(context).hasFailed());
        }
    }
}

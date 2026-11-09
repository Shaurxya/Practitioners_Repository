package com.herbimmortal.verification.config;

import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Set;
import com.herbimmortal.verification.security.Digests;

/** Validates configuration before datasource, storage, or authentication beans are instantiated. */
@Configuration(proxyBeanMethods = false)
public class SecretSafetyConfiguration {
    private static final String TEST_MARKER = "herbimmortal-test-only";
    private static final String TEST_PUBLISHING_DIGEST =
            "aaa443120c3126decc3d65a9cd4b6700a525f1ee5fa6233a6189f119cc077c5d";
    private static final Set<String> TEST_PUBLISHING_DIGESTS = Set.of(TEST_PUBLISHING_DIGEST,
            Digests.sha256("test-only-first-party-client-secret"),
            Digests.sha256("database-test-only-client-secret"));

    @Bean
    static BeanFactoryPostProcessor validateRequiredSecrets(Environment environment) {
        return factory -> validate(environment);
    }

    static void validate(Environment environment) {
        // Adding test alongside prod must not permit fixture credentials in production.
        boolean testOnly = environment.acceptsProfiles(Profiles.of("test"))
                && !environment.acceptsProfiles(Profiles.of("prod", "production"));
        String signing = required(environment, "app.auth.secret", "AUTH_SECRET");
        byte[] signingBytes = decodeOrPlain(signing);
        // Match JwtService's documented plain-text/base64 input semantics.
        if (signingBytes.length < 32) signingBytes = signing.getBytes(StandardCharsets.UTF_8);
        if (signingBytes.length < 32 || allZero(signingBytes)) invalid("AUTH_SECRET");
        rejectTestValue(signing, signingBytes, testOnly, "AUTH_SECRET");

        String master = required(environment, "app.documents.master-key", "DOCUMENT_MASTER_KEY");
        byte[] masterBytes;
        try { masterBytes = Base64.getDecoder().decode(master); }
        catch (IllegalArgumentException e) { throw invalid("DOCUMENT_MASTER_KEY"); }
        if (masterBytes.length != 32 || allZero(masterBytes)) invalid("DOCUMENT_MASTER_KEY");
        rejectTestValue(master, masterBytes, testOnly, "DOCUMENT_MASTER_KEY");

        for (String property : new String[] {"spring.datasource.password", "app.documents.secret-key"}) {
            String value = environment.getProperty(property);
            if (value != null) {
                if (value.isBlank() || value.length() < 8) invalid(property);
                rejectTestValue(value, decodeOrPlain(value), testOnly, property);
            }
        }
        // Publishing is optional. A supplied digest must be valid and not the CI fixture.
        String publishing = environment.getProperty("PUBLISHING_CLIENT_SECRET_SHA256", "");
        if (!publishing.isBlank() && (!publishing.matches("[a-fA-F0-9]{64}")
                || publishing.matches("0{64}")
                || !testOnly && TEST_PUBLISHING_DIGESTS.contains(publishing.toLowerCase(java.util.Locale.ROOT)))) {
            invalid("PUBLISHING_CLIENT_SECRET_SHA256");
        }
    }

    private static String required(Environment environment, String property, String label) {
        String value = environment.getProperty(property);
        if (value == null || value.isBlank()) throw invalid(label);
        return value.trim();
    }

    private static byte[] decodeOrPlain(String value) {
        try { return Base64.getDecoder().decode(value); }
        catch (IllegalArgumentException ignored) { return value.getBytes(StandardCharsets.UTF_8); }
    }

    private static boolean allZero(byte[] bytes) {
        for (byte b : bytes) if (b != 0) return false;
        return true;
    }

    private static void rejectTestValue(String value, byte[] decoded, boolean testOnly, String label) {
        if (!testOnly && (value.contains(TEST_MARKER)
                || new String(decoded, StandardCharsets.UTF_8).contains(TEST_MARKER))) invalid(label);
    }

    private static IllegalStateException invalid(String label) {
        // Never include configured values, decoded bytes, or an underlying parser message.
        throw new IllegalStateException(label + " is missing, invalid, or a test-only value outside the test profile.");
    }
}

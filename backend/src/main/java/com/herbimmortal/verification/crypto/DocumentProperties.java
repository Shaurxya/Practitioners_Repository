package com.herbimmortal.verification.crypto;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Where identity documents go and what protects them.
 *
 * <p>{@code @ConfigurationProperties} binds a block of application.yml to a
 * typed object at startup. The FastAPI equivalent is a pydantic Settings class.
 *
 * @param masterKey  base64, 32 bytes, wraps every per document key. No default.
 * @param bucket     the S3 bucket, created at startup if absent
 * @param endpoint   MinIO locally; leave unset for real S3
 * @param accessKey  storage credential, not a user credential
 * @param secretKey  storage credential, not a user credential
 * @param region     S3 requires one even when MinIO ignores it
 * @param maxBytes   per file, before encryption
 * @param retainAfterDecisionDays  how long a key survives a terminal case
 */
@ConfigurationProperties(prefix = "app.documents")
public record DocumentProperties(
        String masterKey,
        String bucket,
        String endpoint,
        String accessKey,
        String secretKey,
        String region,
        long maxBytes,
        int retainAfterDecisionDays) {

    public DocumentProperties {
        if (bucket == null || bucket.isBlank()) {
            bucket = "identity-documents";
        }
        if (region == null || region.isBlank()) {
            region = "us-east-1";
        }
        if (maxBytes <= 0) {
            // 10 MB. A phone photo of a passport is one to four; anything past
            // this is either a video or a mistake, and both should be refused
            // before they are read into memory rather than after.
            maxBytes = 10L * 1024 * 1024;
        }
        if (retainAfterDecisionDays <= 0) {
            // 90 days after the case goes terminal, then the key is destroyed.
            // There is no reason to hold a government ID forever: the decision,
            // the rule results and the registry snapshot are the durable
            // record, and the scan was evidence for one decision.
            retainAfterDecisionDays = 90;
        }
    }
}

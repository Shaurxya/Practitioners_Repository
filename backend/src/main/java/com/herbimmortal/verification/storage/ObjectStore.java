package com.herbimmortal.verification.storage;

import com.herbimmortal.verification.crypto.DocumentProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.ResponseBytes;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadBucketRequest;
import software.amazon.awssdk.services.s3.model.NoSuchBucketException;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.net.URI;

/**
 * The only class that talks to object storage.
 *
 * <p>The AWS SDK rather than the MinIO client, because MinIO speaks the S3 API:
 * the same code runs against a container on this laptop and against real S3
 * with nothing changed but {@code app.documents.endpoint}. Choosing the MinIO
 * client would have meant rewriting this class the day it went to production.
 *
 * <p><b>This class never sees a plaintext document.</b> Bytes arrive already
 * encrypted from {@link com.herbimmortal.verification.crypto.DocumentCipher},
 * so a stolen volume, a misconfigured bucket policy, or a MinIO console left
 * open all yield ciphertext. That ordering is the entire security argument for
 * uploading through the application instead of handing the browser a presigned
 * URL, and it is why this class has no encryption of its own to get wrong.
 */
@Component
public class ObjectStore {

    private static final Logger log = LoggerFactory.getLogger(ObjectStore.class);

    private final DocumentProperties properties;
    private final S3Client s3;

    public ObjectStore(DocumentProperties properties) {
        this.properties = properties;
        this.s3 = build(properties);
    }

    private static S3Client build(DocumentProperties properties) {
        var builder = S3Client.builder()
                .region(Region.of(properties.region()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create(properties.accessKey(), properties.secretKey())));

        if (properties.endpoint() != null && !properties.endpoint().isBlank()) {
            builder.endpointOverride(URI.create(properties.endpoint()))
                    // Path style puts the bucket in the path rather than the
                    // hostname. Virtual host style needs DNS for
                    // <bucket>.localhost, which does not resolve, so without
                    // this every call to MinIO fails to connect.
                    .serviceConfiguration(S3Configuration.builder()
                            .pathStyleAccessEnabled(true).build());
        }
        return builder.build();
    }

    /**
     * Creates the bucket if it is missing, at startup rather than on first
     * upload.
     *
     * <p>{@code @PostConstruct} runs once after the bean is wired. Doing this
     * lazily would mean the first practitioner to upload a passport is the one
     * who discovers that storage was misconfigured, and they would discover it
     * as a failed claim.
     */
    @PostConstruct
    void ensureBucket() {
        try {
            s3.headBucket(HeadBucketRequest.builder().bucket(properties.bucket()).build());
            log.info("document bucket {} is present", properties.bucket());
        } catch (NoSuchBucketException e) {
            s3.createBucket(CreateBucketRequest.builder().bucket(properties.bucket()).build());
            log.info("created document bucket {}", properties.bucket());
        } catch (Exception e) {
            // Do not fail startup. Storage being down must not take the whole
            // service with it: lookups, the review queue and public verify all
            // keep working, and only uploads fail, with a message that says so.
            log.error("could not reach object storage at {}. Uploads will fail until it is up.",
                    properties.endpoint(), e);
        }
    }

    public void put(String key, byte[] ciphertext) {
        s3.putObject(PutObjectRequest.builder()
                        .bucket(properties.bucket())
                        .key(key)
                        // Deliberately not the document's real content type.
                        // The bucket holds ciphertext, and labelling an object
                        // image/jpeg invites something downstream to try to
                        // render it.
                        .contentType("application/octet-stream")
                        .build(),
                RequestBody.fromBytes(ciphertext));
    }

    public byte[] get(String key) {
        try {
            ResponseBytes<?> object = s3.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(properties.bucket()).key(key).build());
            return object.asByteArray();
        } catch (NoSuchKeyException e) {
            throw new ObjectMissingException(key);
        }
    }

    /**
     * Removes the object itself. Rarely the right call.
     *
     * <p>Erasure is done by destroying the document's key, not by deleting
     * bytes: the row and its audit trail have to survive, and an object nobody
     * holds a key for is already unreadable. This exists for the narrower case
     * of an upload that failed after the put and before the row was committed,
     * where the object has no row and no key and is genuinely orphaned.
     */
    public void delete(String key) {
        s3.deleteObject(DeleteObjectRequest.builder()
                .bucket(properties.bucket()).key(key).build());
    }

    /** The row says there is an object and storage disagrees. Never normal. */
    public static class ObjectMissingException extends RuntimeException {
        public ObjectMissingException(String key) {
            super("No stored object for key " + key);
        }
    }
}

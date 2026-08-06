package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.ImportBatch;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data generates the implementation from the interface at startup. The
 * method name IS the query: findBySourceSha256 becomes
 * "select ... where source_sha256 = ?". Nearest equivalents are a SQLAlchemy
 * session query or a Prisma model method, except nothing is written by hand.
 */
public interface ImportBatchRepository extends JpaRepository<ImportBatch, UUID> {

    /**
     * Uploading the same PDF twice is a mistake, not an intention, and identity
     * comes from content rather than filename. Cancelled batches are excluded so
     * a cancelled upload does not block a corrected re-upload.
     */
    Optional<ImportBatch> findBySourceSha256AndStatusNot(String sourceSha256, String status);
}

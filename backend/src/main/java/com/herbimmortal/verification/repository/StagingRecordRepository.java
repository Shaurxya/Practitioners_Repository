package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.StagingRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface StagingRecordRepository extends JpaRepository<StagingRecord, UUID> {

    /** Worst first, which is what the diff preview promises regardless of the sort asked for. */
    Page<StagingRecord> findByImportBatchIdOrderByRowConfidenceAsc(UUID importBatchId, Pageable pageable);

    Page<StagingRecord> findByImportBatchIdAndNeedsConfirmationTrueAndConfirmedAtIsNullOrderByRowConfidenceAsc(
            UUID importBatchId, Pageable pageable);

    long countByImportBatchIdAndNeedsConfirmationTrueAndConfirmedAtIsNull(UUID importBatchId);

    void deleteByImportBatchId(UUID importBatchId);
}

package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.ImportPage;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface ImportPageRepository extends JpaRepository<ImportPage, UUID> {

    List<ImportPage> findByImportBatchIdOrderByPageNumberAsc(UUID importBatchId);

    long countByImportBatchIdAndAnomalyCodeIsNotNull(UUID importBatchId);

    void deleteByImportBatchId(UUID importBatchId);
}

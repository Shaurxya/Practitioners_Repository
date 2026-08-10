package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.MedicalSystem;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MedicalSystemRepository extends JpaRepository<MedicalSystem, String> {

    List<MedicalSystem> findByEnabledTrueOrderBySortOrderAsc();
}

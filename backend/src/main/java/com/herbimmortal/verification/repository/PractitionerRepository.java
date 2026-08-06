package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.Practitioner;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface PractitionerRepository extends JpaRepository<Practitioner, UUID> {

    Optional<Practitioner> findByCouncilCodeAndLicenseNoNormalized(String councilCode, String licence);

    Optional<Practitioner> findByImmortalId(String immortalId);
}

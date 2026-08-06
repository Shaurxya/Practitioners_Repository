package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.VerificationCase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface VerificationCaseRepository extends JpaRepository<VerificationCase, UUID> {

    /** The queue: everything still waiting on a person, oldest first. */
    List<VerificationCase> findByStatusInOrderBySubmittedAtAsc(List<String> statuses);

    List<VerificationCase> findByPractitionerIdOrderBySubmittedAtDesc(UUID practitionerId);

    Optional<VerificationCase> findFirstByPractitionerIdAndStatusNotInOrderBySubmittedAtDesc(
            UUID practitionerId, List<String> terminalStatuses);

    List<VerificationCase> findAllByOrderBySubmittedAtDesc();
}

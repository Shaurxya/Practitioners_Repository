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

    /**
     * One person's own claims.
     *
     * <p>This method replaced {@code findAllByOrderBySubmittedAtDesc} on the
     * practitioner facing endpoint, and the difference was a real disclosure:
     * {@code GET /api/v1/verifications} returned every case in the database to
     * every caller, including claimed names and registration numbers belonging
     * to other people. Filtering in the query rather than after it matters too,
     * so a page of results is a page of the caller's results.
     */
    List<VerificationCase> findBySubmittedByUserIdOrderBySubmittedAtDesc(UUID userId);
}

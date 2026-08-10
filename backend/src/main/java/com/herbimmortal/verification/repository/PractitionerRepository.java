package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.Practitioner;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface PractitionerRepository extends JpaRepository<Practitioner, UUID> {

    Optional<Practitioner> findByCouncilCodeAndLicenseNoNormalized(String councilCode, String licence);

    Optional<Practitioner> findByImmortalId(String immortalId);

    /**
     * The pre-write uniqueness check for a freshly generated Immortal ID.
     *
     * Spring Data derives the query from the method name, so there is no SQL to
     * keep in step: exists + By + property becomes
     * "select count(*) > 0 from practitioners where immortal_id = ?". The
     * Express equivalent would be a hand written findOne you then have to
     * remember to index; here the UNIQUE constraint from V8 already provides
     * the index this reads through.
     *
     * This narrows the race, it does not close it. Two concurrent registrations
     * can both see false. The UNIQUE constraint is the thing that decides.
     */
    boolean existsByImmortalId(String immortalId);

    /**
     * The Immortal ID to show on an account page, if that account has one.
     *
     * <p>{@code findFirst} rather than {@code find}, because one login can hold
     * more than one registration: a practitioner registered with two councils is
     * one person with two rows. Ordering by issue date makes "the first one they
     * were given" the answer rather than whichever row the planner returned,
     * which would otherwise change between page loads.
     */
    Optional<Practitioner> findFirstByUserIdAndImmortalIdIsNotNullOrderByImmortalIdIssuedAtAsc(UUID userId);

    /** Every registration claimed by one account. */
    java.util.List<Practitioner> findByUserId(UUID userId);
}

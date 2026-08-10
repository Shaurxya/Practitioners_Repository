package com.herbimmortal.verification.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A practitioner holding a pre-V9 Immortal ID must stay administrable.
 *
 * <h2>The bug this pins</h2>
 *
 * V9 added {@code practitioners_immortal_id_format} as NOT VALID, accepting only
 * the current HI-YYCCM-RRRRR shape. NOT VALID skips the one time backfill scan;
 * it does not scope the constraint to new rows. Postgres evaluates a CHECK
 * against the new row version of every INSERT <i>and every UPDATE</i>, so from
 * V9 onward any UPDATE touching a legacy row failed, including an UPDATE that
 * never mentioned immortal_id.
 *
 * <p>Every legacy practitioner was therefore frozen: unclaimable by an account,
 * un-revocable, un-re-verifiable. Section 8.1 says the identifier is permanent.
 * It does not say the person holding one stops being administrable.
 *
 * <p>Found by submitting a real claim against the Goa register, where the
 * practitioner already existed with a legacy ID. Fixed in V12.
 *
 * <p>Needs the database from docker-compose, like the rest of the suite.
 * {@code @Transactional} on a test rolls back at the end, so these rows never
 * survive the run.
 */
@SpringBootTest
@Transactional
class LegacyImmortalIdTest {

    @Autowired
    private JdbcTemplate jdbc;

    /**
     * A fresh legacy shaped ID per call, because immortal_id is UNIQUE and a
     * real one is already in this database.
     *
     * <p>The fixed "B0B2P" group matters: it starts with a letter, so it cannot
     * satisfy the current format's leading {@code [0-9]{2}} year. Without that
     * these tests would pass through the current format branch and assert
     * nothing about legacy support at all.
     */
    private static String legacyId() {
        StringBuilder suffix = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            suffix.append("0123456789ABCDEFGHJKMNPQRSTVWXYZ".charAt((int) (Math.random() * 32)));
        }
        return "HI-B0B2P-" + suffix;
    }

    private UUID insertPractitioner(String immortalId) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into practitioners (id, council_code, license_no_normalized,"
                        + " full_name_raw, immortal_id, country_code, medical_system_code,"
                        + " immortal_id_issued_at)"
                        + " values (?,?,?,?,?,?,?, case when ?::text is null then null else now() end)",
                id, "GA", "TESTLEGACY" + id.toString().substring(0, 8),
                "TEST PRACTITIONER", immortalId, "IN", "A", immortalId);
        return id;
    }

    /**
     * The regression. An UPDATE that does not mention immortal_id at all still
     * has to succeed on a row that holds a legacy one.
     */
    @Test
    void aPractitionerHoldingALegacyIdCanStillBeUpdated() {
        UUID id = insertPractitioner(legacyId());

        assertThatCode(() -> jdbc.update(
                "update practitioners set updated_at = now() where id = ?", id))
                .doesNotThrowAnyException();
    }

    /** Claiming is the update the real bug blocked: a legacy row could never be attached to an account. */
    @Test
    void aLegacyRegistrationCanBeClaimedByAnAccount() {
        UUID id = insertPractitioner(legacyId());
        UUID user = jdbc.queryForObject("select id from users limit 1", UUID.class);

        assertThatCode(() -> jdbc.update(
                "update practitioners set user_id = ? where id = ?", user, id))
                .doesNotThrowAnyException();
    }

    @Test
    void theCurrentFormatIsStillAccepted() {
        assertThatCode(() -> insertPractitioner("HI-26INA-K3M7Q")).doesNotThrowAnyException();
    }

    @Test
    void aPractitionerWithNoIdIsStillAccepted() {
        assertThatCode(() -> insertPractitioner(null)).doesNotThrowAnyException();
    }

    /**
     * Widening the constraint to admit the legacy shape must not turn it into no
     * constraint at all. Garbage is still garbage.
     *
     * <p>Parameterized rather than a loop inside one test, and that is not
     * style. In Postgres a constraint violation aborts the whole transaction, so
     * a loop would abort on the first bad value and every later statement would
     * fail with "current transaction is aborted" rather than with the violation
     * being asserted. The same trap section 8.3 documents for the Immortal ID
     * retry, met here in a test. One transaction per value is the only shape
     * that works.
     */
    @ParameterizedTest
    @ValueSource(strings = {"not-an-id", "HI-26INA", "HI-26INA-TOOLONG", "26INA-K3M7Q", "hi-26ina-k3m7q"})
    void garbageIsStillRejected(String bad) {
        assertThatThrownBy(() -> insertPractitioner(bad))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * V12 validates the constraint rather than leaving it NOT VALID. A NOT VALID
     * constraint is a promise about future writes that nobody can rely on when
     * reading the schema, and V9 left one behind for a year.
     */
    @Test
    void theConstraintIsValidatedNotMerelyDeclared() {
        Boolean validated = jdbc.queryForObject(
                "select convalidated from pg_constraint"
                        + " where conname = 'practitioners_immortal_id_format'",
                Boolean.class);
        assertThat(validated).isTrue();
    }
}

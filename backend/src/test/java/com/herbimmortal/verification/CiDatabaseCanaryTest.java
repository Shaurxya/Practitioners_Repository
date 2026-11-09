package com.herbimmortal.verification;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.stream.IntStream;
import static org.assertj.core.api.Assertions.assertThat;

/** A missing database is a failure, not a reason to skip integration coverage. */
@SpringBootTest
class CiDatabaseCanaryTest {
    // Update deliberately when adding a migration. A removed migration must not look green.
    private static final int EXPECTED_MIGRATIONS = 15;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @Autowired ConfigurableEnvironment environment;

    @Test void reachesRealPostgres16WithEveryExpectedMigrationApplied() {
        assertThat(jdbc.queryForObject("select current_setting('server_version_num')::int / 10000", Integer.class))
                .isEqualTo(16);
        assertThat(jdbc.queryForList("select version from flyway_schema_history where success order by installed_rank",
                String.class)).containsExactlyElementsOf(IntStream.rangeClosed(1, EXPECTED_MIGRATIONS)
                .mapToObj(Integer::toString).toList());
        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().applied()).hasSize(EXPECTED_MIGRATIONS);
    }

    @Test void testsNeverImportTheDevelopersDotenvFile() {
        assertThat(environment.getActiveProfiles()).contains("test");
        for (var source : environment.getPropertySources()) {
            assertThat(source.getName()).doesNotContain(".env[");
        }
        assertThat(environment.getProperty("app.auth.secret"))
                .isEqualTo("aGVyYmltbW9ydGFsLXRlc3Qtb25seS1zaWduaW5nLWtleS1ub3QtZm9yLXByb2R1Y3Rpb24=");
    }
}

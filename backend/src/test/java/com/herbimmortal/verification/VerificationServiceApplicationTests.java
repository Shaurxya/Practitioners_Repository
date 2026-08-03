package com.herbimmortal.verification;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * The default generated test. @SpringBootTest starts the entire application
 * exactly as `mvnw spring-boot:run` would, then the empty test body passes if
 * nothing blew up on the way.
 *
 * IMPORTANT: because the app connects to Postgres at startup, this test needs
 * the database from docker-compose.yml to be running. If it is not, the test
 * fails with a connection error. That is honest behaviour, not a broken test:
 * it is the same check as step 4 of the definition of done.
 */
@SpringBootTest
class VerificationServiceApplicationTests {

    @Test
    void contextLoads() {
        // Deliberately empty. Reaching this line means every bean was created,
        // the DataSource connected, and Flyway migrated successfully.
    }
}

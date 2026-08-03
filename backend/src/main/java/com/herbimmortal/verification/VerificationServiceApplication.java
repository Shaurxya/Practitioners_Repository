package com.herbimmortal.verification;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * The entry point.
 *
 * @SpringBootApplication is three annotations in one:
 *   @Configuration        this class can define beans
 *   @EnableAutoConfiguration  look at the classpath and wire up whatever is
 *                             there (Postgres driver found, so build a
 *                             DataSource; Flyway found, so run migrations)
 *   @ComponentScan        scan this package and everything below it for
 *                         @Component, @Service, @RestController, and register them
 *
 * The closest FastAPI analogue is `app = FastAPI()` plus your imports, except
 * the wiring is discovered rather than written out by hand.
 */
/**
 * @ConfigurationPropertiesScan finds every @ConfigurationProperties class below
 * this package and registers it as a bean, unconditionally. Without it, each
 * one has to be named in an @EnableConfigurationProperties somewhere, and if
 * that somewhere is profile gated then so is the config value, which is how
 * IngestionProperties went missing on a normal boot.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class VerificationServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(VerificationServiceApplication.class, args);
    }
}

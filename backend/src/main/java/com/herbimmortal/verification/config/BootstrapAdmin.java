package com.herbimmortal.verification.config;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import com.herbimmortal.verification.repository.UserRepository;
import com.herbimmortal.verification.security.AuthProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Creates the first administrator, once, on an empty system.
 *
 * <p>Without this there is a deadlock: the review console needs an admin, roles
 * are only grantable by an admin, and signup only ever produces practitioners.
 * Something has to break the cycle, and the alternatives are worse. A seeded
 * admin in a migration puts a password hash in version control. A signup
 * endpoint that accepts a role is an admin factory open to the internet.
 *
 * <h2>The three conditions</h2>
 *
 * It runs only when all of these hold, and each one is doing work:
 *
 * <ol>
 *   <li><b>Not the prod profile.</b> A production system gets its first admin
 *       from an operator running a command, not from a config file the
 *       application reads at boot.</li>
 *   <li><b>Both properties set.</b> No defaults. A default admin password is a
 *       published admin password.</li>
 *   <li><b>No administrator exists yet.</b> So this cannot resurrect an account
 *       that was deliberately disabled, and cannot reset a password by editing
 *       configuration and restarting.</li>
 * </ol>
 */
@Configuration
@Profile("!prod")
public class BootstrapAdmin {

    private static final Logger log = LoggerFactory.getLogger(BootstrapAdmin.class);

    @Bean
    public ApplicationRunner createFirstAdmin(UserRepository users,
                                              PasswordEncoder passwords,
                                              AuthProperties properties) {
        return args -> {
            String email = properties.bootstrapAdminEmail();
            String password = properties.bootstrapAdminPassword();

            if (email == null || email.isBlank() || password == null || password.isBlank()) {
                return;
            }

            if (users.existsByRole(Role.ADMIN)) {
                // Already bootstrapped. Silent rather than logged: this is the
                // normal case on every restart after the first.
                return;
            }

            String normalized = User.normalizeEmail(email);
            if (users.existsByEmail(normalized)) {
                // The address exists but is not an admin. Promoting it here
                // would let anyone who can edit configuration escalate an
                // ordinary account, which is the hole this whole class is
                // trying not to open.
                log.warn("Bootstrap admin {} already exists as a non-admin account. "
                        + "Not promoting it. Grant the role deliberately instead.", normalized);
                return;
            }

            User admin = users.save(new User(
                    normalized, passwords.encode(password), "Administrator", Role.ADMIN));

            // The address, never the password. A password in a log file is a
            // password in every log aggregator, backup and screen share the log
            // ever reaches.
            log.warn("Created the first administrator: {} (id {}). "
                            + "Sign in and change this password, then remove "
                            + "AUTH_BOOTSTRAP_ADMIN_PASSWORD from .env.",
                    normalized, admin.getId());
        };
    }
}

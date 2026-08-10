package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.Role;
import com.herbimmortal.verification.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface UserRepository extends JpaRepository<User, UUID> {

    /**
     * Sign in and the signup duplicate check. Both must pass an already
     * normalized address: the unique index is on the lowercased value, so
     * querying with mixed case here would miss a row the index would have
     * refused to duplicate.
     */
    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    /** Used once, at startup, to decide whether the bootstrap admin is needed. */
    boolean existsByRole(Role role);
}

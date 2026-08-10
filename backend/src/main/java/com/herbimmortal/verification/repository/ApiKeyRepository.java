package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.ApiKey;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ApiKeyRepository extends JpaRepository<ApiKey, UUID> {

    /** The authentication lookup. Reads through the unique index on key_hash. */
    Optional<ApiKey> findByKeyHash(String keyHash);

    /** The account page. Revoked keys are kept and shown as revoked, never deleted. */
    List<ApiKey> findByUserIdOrderByCreatedAtDesc(UUID userId);

    long countByUserIdAndRevokedAtIsNull(UUID userId);
}

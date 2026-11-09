package com.herbimmortal.verification.partner;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;
import java.util.UUID;

public interface ApiClientRepository extends JpaRepository<ApiClient, UUID> {
    Optional<ApiClient> findByOwnerUserId(UUID ownerUserId);
    Optional<ApiClient> findByIdAndOwnerUserId(UUID id, UUID ownerUserId);
}

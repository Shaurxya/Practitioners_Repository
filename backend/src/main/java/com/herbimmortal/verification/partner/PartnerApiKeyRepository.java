package com.herbimmortal.verification.partner;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PartnerApiKeyRepository extends JpaRepository<PartnerApiKey, UUID> {
    Optional<PartnerApiKey> findByPublicKeyId(String publicKeyId);
    Optional<PartnerApiKey> findByIdAndClientId(UUID id, UUID clientId);
    @Query("""
            select k from PartnerApiKey k where k.id = :id and k.clientId in
            (select c.id from ApiClient c where c.ownerUserId = :owner)
            """)
    Optional<PartnerApiKey> findOwnedById(@Param("id") UUID id, @Param("owner") UUID ownerUserId);
    List<PartnerApiKey> findByClientIdOrderByCreatedAtDesc(UUID clientId);
}

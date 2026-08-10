package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.RefreshToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /** The account page's session list, and the "sign out everywhere" target. */
    List<RefreshToken> findByUserIdAndRevokedAtIsNullOrderByIssuedAtDesc(UUID userId);

    /**
     * Kills every live session for one account in a single statement.
     *
     * <p>Bulk update rather than load-and-save, because this runs when an
     * account is locked or a stolen token is detected, and both of those want
     * to be immediate and unconditional rather than proportional to how many
     * devices someone owns.
     *
     * <p>{@code @Modifying} tells Spring Data this query writes.
     * {@code clearAutomatically} discards the persistence context afterwards,
     * because a bulk update goes straight to the database and any entity
     * already loaded in this transaction would otherwise still claim to be live.
     */
    @Modifying(clearAutomatically = true)
    @Query("update RefreshToken t set t.revokedAt = :now"
            + " where t.userId = :userId and t.revokedAt is null")
    int revokeAllForUser(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * Housekeeping. Expired tokens are dead weight: they can never authenticate
     * anything, and the table is on the path of every refresh.
     */
    @Modifying(clearAutomatically = true)
    @Query("delete from RefreshToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") Instant cutoff);
}

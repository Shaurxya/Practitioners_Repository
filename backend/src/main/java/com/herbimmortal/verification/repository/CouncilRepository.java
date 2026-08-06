package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.Council;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CouncilRepository extends JpaRepository<Council, String> {

    /** Sorted by the name a person reads, not by code. */
    List<Council> findAllByOrderByCanonicalNameAsc();
}

package com.herbimmortal.verification.repository;

import com.herbimmortal.verification.domain.Country;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CountryRepository extends JpaRepository<Country, String> {

    /** Only countries we actually hold a register for, sorted by the name a person reads. */
    List<Country> findByEnabledTrueOrderByNameAsc();
}

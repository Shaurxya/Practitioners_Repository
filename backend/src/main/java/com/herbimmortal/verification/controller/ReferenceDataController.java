package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.repository.CountryRepository;
import com.herbimmortal.verification.repository.MedicalSystemRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * The two lookup lists the claim form needs, and the two that feed the Immortal
 * ID. Public, no auth, for the same reason the council list is: the form needs
 * them before anyone has an account, and neither is sensitive.
 *
 * Served rather than hardcoded in the React bundle. The codebase already has
 * the scar: the claim form shipped a copy of four councils and went on offering
 * four for weeks after a migration seeded thirty six, so a practitioner
 * registered in Goa could not describe themselves at all. Nothing in the client
 * was wrong. It was just old. Country and medical system are worse candidates
 * for the same mistake, because a stale copy there does not just block a form,
 * it puts the wrong character into a permanent identifier.
 */
@RestController
public class ReferenceDataController {

    private final CountryRepository countries;
    private final MedicalSystemRepository medicalSystems;

    public ReferenceDataController(CountryRepository countries,
                                   MedicalSystemRepository medicalSystems) {
        this.countries = countries;
        this.medicalSystems = medicalSystems;
    }

    /** code is ISO 3166-1 alpha-2, and it is the CC segment of an Immortal ID verbatim. */
    public record CountryView(String code, String name) {
    }

    /** code is the single character M segment. */
    public record MedicalSystemView(String code, String name) {
    }

    @GetMapping({"/api/v1/countries", "/api/v1/admin/countries"})
    public List<CountryView> countries() {
        return countries.findByEnabledTrueOrderByNameAsc().stream()
                .map(c -> new CountryView(c.getCode(), c.getName()))
                .toList();
    }

    @GetMapping({"/api/v1/medical-systems", "/api/v1/admin/medical-systems"})
    public List<MedicalSystemView> medicalSystems() {
        // Ordered by sort_order rather than by name, so Ayurveda leads the list
        // it dominates instead of sitting between Traditional Chinese Medicine
        // and Unani.
        return medicalSystems.findByEnabledTrueOrderBySortOrderAsc().stream()
                .map(m -> new MedicalSystemView(m.getCode(), m.getName()))
                .toList();
    }
}

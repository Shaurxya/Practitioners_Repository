package com.herbimmortal.verification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.herbimmortal.verification.domain.Council;
import com.herbimmortal.verification.repository.CouncilRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The lookup, and the four things that stop it being a registry scraper.
 *
 * The database is a mock. What is under test is what the service chooses to
 * reveal and when it refuses, and neither of those needs a real table: the
 * query itself is one indexed equality on a natural key that the ingestion
 * suite already covers.
 */
class RegistryLookupServiceTest {

    private JdbcTemplate jdbc;
    private CouncilRepository councils;
    private RegistryLookupService service;

    private static final UUID USER = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        councils = mock(CouncilRepository.class);

        Council council = mock(Council.class);
        when(council.getCanonicalName()).thenReturn("Maharashtra Council of Indian Medicine");
        when(councils.findById("MH")).thenReturn(Optional.of(council));

        service = new RegistryLookupService(jdbc, councils, new ObjectMapper());
    }

    private void registryReturns(List<Map<String, Object>> rows) {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(rows);
    }

    private static Map<String, Object> row(String normalizedName, String status) {
        return Map.of("full_name_normalized", normalizedName,
                "status", status,
                "source_batch", "council-2026-07-14");
    }

    // ------------------------------------------------------------------
    // Masking. The control that caps the payoff of a successful lookup.
    // ------------------------------------------------------------------

    @Test
    void masksEachNamePartToAnInitialAndFixedWidthBullets() {
        assertThat(RegistryLookupService.mask("ANAND SHARMA")).isEqualTo("A•••• S••••");
        assertThat(RegistryLookupService.mask("MEERA RAJAN NAIR")).isEqualTo("M•••• R•••• N••••");
    }

    /**
     * The bullet run is the same length for a four letter surname and a twelve
     * letter one. Length plus council plus initials narrows a real person far
     * more than it looks like it does, so it must not survive the mask.
     */
    @Test
    void maskDoesNotLeakNameLength() {
        // Same initials, wildly different lengths, byte for byte identical mask.
        assertThat(RegistryLookupService.mask("A RAO"))
                .isEqualTo(RegistryLookupService.mask("ANAND RAJAGOPALACHARI"));
    }

    @Test
    void maskHandlesAnEmptyName() {
        assertThat(RegistryLookupService.mask("")).isEmpty();
        assertThat(RegistryLookupService.mask(null)).isEmpty();
    }

    // ------------------------------------------------------------------
    // The three outcomes
    // ------------------------------------------------------------------

    @Test
    void revealsAMaskedNameWhenExactlyOneRowMatches() {
        registryReturns(List.of(row("ANAND SHARMA", "ACTIVE")));

        var result = service.lookup("MH", "MH-12345", USER);

        assertThat(result.outcome()).isEqualTo(RegistryLookupService.Outcome.FOUND);
        assertThat(result.maskedName()).isEqualTo("A•••• S••••");
        assertThat(result.standing()).isEqualTo("ACTIVE");
        assertThat(result.asOfBatch()).isEqualTo("council-2026-07-14");
        assertThat(result.councilName()).isEqualTo("Maharashtra Council of Indian Medicine");
    }

    /**
     * Section 7.2's rule. A field present only on the found branch leaks
     * existence through the response shape, which is the version of that bug
     * that survives a review of the values.
     */
    @Test
    void notFoundReturnsTheSameShapeWithEveryFieldEmpty() {
        registryReturns(List.of());

        var result = service.lookup("MH", "MH-99999", USER);

        assertThat(result.outcome()).isEqualTo(RegistryLookupService.Outcome.NOT_FOUND);
        assertThat(result.councilName()).isEmpty();
        assertThat(result.maskedName()).isEmpty();
        assertThat(result.standing()).isEmpty();
        assertThat(result.asOfBatch()).isEmpty();
    }

    /**
     * Two candidates reveal nothing at all, not even the count. Showing a
     * claimant two masked names side by side would let them pick the one they
     * wanted to be.
     */
    @Test
    void ambiguousRevealsNothingIncludingTheCount() {
        registryReturns(List.of(row("ANAND SHARMA", "ACTIVE"), row("ANITA SHARMA", "ACTIVE")));

        var result = service.lookup("MH", "MH-12345", USER);

        assertThat(result.outcome()).isEqualTo(RegistryLookupService.Outcome.AMBIGUOUS);
        assertThat(result.maskedName()).isEmpty();
        assertThat(result.councilName()).isEmpty();
    }

    // ------------------------------------------------------------------
    // Standing, collapsed to three values
    // ------------------------------------------------------------------

    /**
     * The register distinguishes SUSPENDED from REVOKED from EXPIRED. At lookup
     * time we do not know that the person typing is the person on the row, so
     * telling them which would disclose a named practitioner's disciplinary
     * history to anyone who guessed their number.
     */
    @Test
    void collapsesEverySanctionIntoNotActive() {
        for (String status : List.of("SUSPENDED", "REVOKED", "EXPIRED", "INACTIVE")) {
            registryReturns(List.of(row("ANAND SHARMA", status)));
            assertThat(service.lookup("MH", "MH-12345", UUID.randomUUID()).standing())
                    .as("status %s must not be disclosed verbatim", status)
                    .isEqualTo("NOT_ACTIVE");
        }
    }

    /**
     * UNKNOWN survives as itself. It is not a sanction and collapsing it into
     * NOT_ACTIVE would tell a practitioner on a register that publishes no
     * standing column that they are not in good standing, which the document
     * never asserted. Same reasoning as LICENSE_ACTIVE routing UNKNOWN to a
     * person rather than failing it.
     */
    @Test
    void keepsUnknownDistinctFromNotActive() {
        registryReturns(List.of(row("ANAND SHARMA", "UNKNOWN")));
        assertThat(service.lookup("MH", "MH-12345", USER).standing()).isEqualTo("UNKNOWN");
    }

    // ------------------------------------------------------------------
    // The budget
    // ------------------------------------------------------------------

    @Test
    void refusesTheTwentyFirstLookupInAnHour() {
        registryReturns(List.of());
        UUID user = UUID.randomUUID();

        for (int i = 1; i <= 20; i++) {
            service.lookup("MH", "MH-1000" + i, user);
        }

        assertThatThrownBy(() -> service.lookup("MH", "MH-20000", user))
                .isInstanceOf(RegistryLookupService.LookupBudgetExceededException.class);
    }

    /** The budget is per account, so one exhausted user must not block another. */
    @Test
    void budgetsEachAccountSeparately() {
        registryReturns(List.of());
        UUID spender = UUID.randomUUID();
        for (int i = 1; i <= 21; i++) {
            try {
                service.lookup("MH", "MH-1000" + i, spender);
            } catch (RegistryLookupService.LookupBudgetExceededException expected) {
                // the 21st
            }
        }

        assertThat(service.lookup("MH", "MH-12345", UUID.randomUUID()).outcome())
                .isEqualTo(RegistryLookupService.Outcome.NOT_FOUND);
    }

    /**
     * The budget is spent before the council is resolved, so a caller cannot
     * probe with a bad council code for free.
     */
    @Test
    void rejectsAnUnknownCouncil() {
        when(councils.findById(eq("ZZ"))).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.lookup("ZZ", "ZZ-12345", USER))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ZZ");
    }

    @Test
    void rejectsARegistrationNumberWithNoAlphanumerics() {
        assertThatThrownBy(() -> service.lookup("MH", "---", USER))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

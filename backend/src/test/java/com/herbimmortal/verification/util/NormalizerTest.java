package com.herbimmortal.verification.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plain JUnit, no Spring, no database. Normalizer is pure static functions, so
 * these run in milliseconds.
 *
 * Every case below is drawn from a variant the phase 2A profile actually found
 * in the export, not invented. @Nested groups related cases; @ParameterizedTest
 * with @CsvSource runs the same test body once per row, which is the JUnit
 * equivalent of pytest.mark.parametrize.
 */
class NormalizerTest {

    @Nested
    @DisplayName("license numbers")
    class LicenseNumbers {

        @ParameterizedTest(name = "[{index}] {0} + {1} -> {2}")
        @CsvSource({
                // the six shapes the profile found, all landing on one value
                "MH4471,     MH, MH4471",
                "MH-4471,    MH, MH4471",
                "'MH 4471',  MH, MH4471",
                "mh4471,     MH, MH4471",
                "4471,       MH, MH4471",   // 10.3% of rows, prefix missing
                "MH/4471/A,  MH, MH4471A",  // suffix preserved, it is significant
                // leading zeros are data, not formatting
                "0447,       KA, KA0447",
                "KA-0447,    KA, KA0447",
                // lowercase council code from a caller
                "4471,       mh, MH4471",
        })
        void canonicalizes(String raw, String council, String expected) {
            assertThat(Normalizer.normalizeLicenseNumber(raw, council)).isEqualTo(expected);
        }

        @Test
        @DisplayName("a mis-filed council prefix is left alone, not double prefixed")
        void doesNotDoublePrefix() {
            // A Karnataka number filed under Maharashtra is a data problem.
            // Turning it into MHKA4471 would hide it. Leave it visible.
            assertThat(Normalizer.normalizeLicenseNumber("KA4471", "MH")).isEqualTo("KA4471");
        }

        @Test
        void handlesNullAndEmpty() {
            assertThat(Normalizer.normalizeLicenseNumber(null, "MH")).isEmpty();
            assertThat(Normalizer.normalizeLicenseNumber("   ", "MH")).isEmpty();
            assertThat(Normalizer.normalizeLicenseNumber("---", "MH")).isEmpty();
        }
    }

    @Nested
    @DisplayName("names")
    class Names {

        @ParameterizedTest(name = "[{index}] {0} -> {1}")
        @CsvSource({
                "'Anil Sharma',                    'ANIL SHARMA'",
                "'Dr. Anil Sharma',                'ANIL SHARMA'",
                "'Dr Anil Sharma',                 'ANIL SHARMA'",
                "'Vaidya Anil Sharma',             'ANIL SHARMA'",
                "'Vd. Anil Sharma',                'ANIL SHARMA'",
                "'Prof. Anil Sharma',              'ANIL SHARMA'",
                // qualifications appended, in the forms the profile found
                "'Anil Sharma BAMS',               'ANIL SHARMA'",
                "'Anil Sharma, BAMS',              'ANIL SHARMA'",
                "'Anil Sharma B.A.M.S.',           'ANIL SHARMA'",
                "'Anil Sharma MD (Ayu)',           'ANIL SHARMA'",
                // both ends at once
                "'Dr. Anil Sharma, M.D. (Ayurveda)','ANIL SHARMA'",
                // whitespace damage
                "'Anil  Sharma',                   'ANIL SHARMA'",
                "'  Anil Sharma  ',                'ANIL SHARMA'",
                // middle initial survives, it is discriminating information
                "'Anil K. Sharma',                 'ANIL K SHARMA'",
        })
        void normalizes(String raw, String expected) {
            assertThat(Normalizer.normalizeName(raw)).isEqualTo(expected);
        }

        @Test
        @DisplayName("a title with no space after the period still strips")
        void stripsTitleWithNoSpaceAfterPeriod() {
            // Found in the real ingested data: "Dr.Arun Kaur BAMS" was
            // normalizing to "DRARUN KAUR", which would never match anything.
            assertThat(Normalizer.normalizeName("Dr.Arun Kaur BAMS")).isEqualTo("ARUN KAUR");
            assertThat(Normalizer.normalizeName("Vd.Meera Nair")).isEqualTo("MEERA NAIR");
        }

        @Test
        @DisplayName("a lone middle initial is kept, it is discriminating")
        void keepsLoneInitial() {
            assertThat(Normalizer.normalizeName("Dr. Rajesh B. Reddy, BAMS"))
                    .isEqualTo("RAJESH B REDDY");
        }

        @Test
        @DisplayName("surname-first form is reordered, 4% of the export")
        void reordersSurnameFirst() {
            assertThat(Normalizer.normalizeName("Sharma, Anil")).isEqualTo("ANIL SHARMA");
            assertThat(Normalizer.normalizeName("Nair, Meera")).isEqualTo("MEERA NAIR");
        }

        @Test
        @DisplayName("a comma introducing a qualification is not mistaken for surname-first")
        void doesNotReorderQualificationComma() {
            // The bug this guards: "ANIL SHARMA, BAMS" becoming "BAMS ANIL SHARMA".
            assertThat(Normalizer.normalizeName("Anil Sharma, BAMS")).isEqualTo("ANIL SHARMA");
        }

        @Test
        @DisplayName("diacritics fold, so a macron cannot break a match")
        void foldsDiacritics() {
            assertThat(Normalizer.normalizeName("Dr. Sharmā Anil")).isEqualTo("SHARMA ANIL");
            assertThat(Normalizer.normalizeName("José Menon")).isEqualTo("JOSE MENON");
        }

        @Test
        @DisplayName("non-breaking space is whitespace")
        void handlesNonBreakingSpace() {
            assertThat(Normalizer.normalizeName("Anil Sharma ")).isEqualTo("ANIL SHARMA");
        }

        @Test
        @DisplayName("a name that is nothing but a title normalizes to empty, not to a title")
        void allTitleNameBecomesEmpty() {
            assertThat(Normalizer.normalizeName("Dr.")).isEmpty();
        }

        @Test
        void handlesNull() {
            assertThat(Normalizer.normalizeName(null)).isEmpty();
        }
    }

    @Nested
    @DisplayName("council aliases")
    class CouncilAliases {

        @ParameterizedTest(name = "[{index}] {0}")
        @CsvSource({
                "'Maharashtra Council of Indian Medicine', 'MAHARASHTRA COUNCIL OF INDIAN MEDICINE'",
                "'MAHARASHTRA COUNCIL OF INDIAN MEDICINE', 'MAHARASHTRA COUNCIL OF INDIAN MEDICINE'",
                "'Maharashtra Counsil of Indian Medicine', 'MAHARASHTRA COUNSIL OF INDIAN MEDICINE'",
                "'Maharashtra Council of Indian Med.',     'MAHARASHTRA COUNCIL OF INDIAN MED'",
                "'Kerala State Medical Council (ISM)',     'KERALA STATE MEDICAL COUNCIL ISM'",
        })
        void normalizes(String raw, String expected) {
            assertThat(Normalizer.normalizeCouncilAlias(raw)).isEqualTo(expected);
        }

        @Test
        @DisplayName("ampersand disappears rather than becoming AND")
        void ampersandIsDropped() {
            // This is why council_aliases seeds BOTH wordings.
            assertThat(Normalizer.normalizeCouncilAlias("Karnataka Ayurvedic & Unani Practitioners Board"))
                    .isEqualTo("KARNATAKA AYURVEDIC UNANI PRACTITIONERS BOARD");
            assertThat(Normalizer.normalizeCouncilAlias("Karnataka Ayurvedic and Unani Practitioners Board"))
                    .isEqualTo("KARNATAKA AYURVEDIC AND UNANI PRACTITIONERS BOARD");
        }

        @Test
        @DisplayName("a double space in the source collapses")
        void collapsesDoubleSpace() {
            assertThat(Normalizer.normalizeCouncilAlias("Karnataka Ayurvedic and Unani Practitioners  Board"))
                    .isEqualTo("KARNATAKA AYURVEDIC AND UNANI PRACTITIONERS BOARD");
        }
    }

    @Nested
    @DisplayName("status")
    class Status {

        @ParameterizedTest(name = "[{index}] {0} -> {1}")
        @CsvSource({
                "Active,      ACTIVE",
                "ACTIVE,      ACTIVE",
                "active,      ACTIVE",
                "'Active ',   ACTIVE",
                "Suspended,   SUSPENDED",
                "suspended,   SUSPENDED",
                "Revoked,     REVOKED",
                "Expired,     EXPIRED",
                "Inactive,    INACTIVE",
                "'N/A',       UNKNOWN",
                "'',          UNKNOWN",
                "'   ',       UNKNOWN",
                "'struck off',REVOKED",
        })
        void parses(String raw, String expected) {
            assertThat(Normalizer.normalizeStatus(raw)).isEqualTo(expected);
        }

        @Test
        @DisplayName("an unreadable status is UNKNOWN, never silently ACTIVE")
        void unreadableIsUnknownNotActive() {
            assertThat(Normalizer.normalizeStatus("???")).isEqualTo("UNKNOWN");
            assertThat(Normalizer.normalizeStatus(null)).isEqualTo("UNKNOWN");
        }
    }
}

package com.herbimmortal.verification.util;

import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The format, pinned.
 *
 * These assertions are the contract the TypeScript side has to match. If a
 * change here forces one of these literals to move, that change is a breaking
 * change to every identifier ever issued, not a refactor.
 */
class ImmortalIdTest {

    /** HI-YYCCM-RRRRR. Written out rather than reused from the class under test:
     *  a shared regex would let a broken implementation agree with itself. */
    private static final Pattern SHAPE = Pattern.compile("^HI-\\d{2}[A-Z]{2}[A-Z]-[A-Z0-9]{5}$");

    @Test
    void buildsTheDocumentedExample() {
        String prefix = ImmortalId.prefix(2026, "IN", "A");
        assertThat(prefix).isEqualTo("HI-26INA-");
        assertThat(prefix + "K3M7Q").isEqualTo("HI-26INA-K3M7Q");
    }

    @Test
    void buildsEveryMedicalSystemAndCountryFromTheSpec() {
        assertThat(ImmortalId.prefix(2026, "IN", "S")).isEqualTo("HI-26INS-");
        assertThat(ImmortalId.prefix(2026, "IN", "U")).isEqualTo("HI-26INU-");
        assertThat(ImmortalId.prefix(2026, "IN", "Y")).isEqualTo("HI-26INY-");
        assertThat(ImmortalId.prefix(2026, "IN", "T")).isEqualTo("HI-26INT-");
        assertThat(ImmortalId.prefix(2026, "US", "A")).isEqualTo("HI-26USA-");
        assertThat(ImmortalId.prefix(2026, "GB", "A")).isEqualTo("HI-26GBA-");
    }

    @Test
    void padsASingleDigitYear() {
        // 2007 must be 07, not 7. Without the pad the ID is thirteen characters
        // and every regex reading one stops matching.
        assertThat(ImmortalId.prefix(2007, "IN", "A")).isEqualTo("HI-07INA-");
    }

    @Test
    void uppercasesWhatItIsGiven() {
        assertThat(ImmortalId.prefix(2026, "in", "a")).isEqualTo("HI-26INA-");
    }

    @Test
    void generatesTheDocumentedShape() {
        for (int i = 0; i < 200; i++) {
            assertThat(ImmortalId.generate(2026, "IN", "A")).matches(SHAPE);
        }
    }

    @Test
    void suffixUsesOnlyTheDocumentedAlphabet() {
        // A-Z and 0-9, all 36. Not Crockford: I, L, O and U are legal here, and
        // a suffix that quietly excluded them would shrink the space by 40
        // percent while the capacity note went on claiming 36^5.
        for (int i = 0; i < 500; i++) {
            assertThat(ImmortalId.randomSuffix()).matches("^[A-Z0-9]{5}$");
        }
    }

    @Test
    void suffixReachesTheWholeAlphabet() {
        Set<Character> seen = new HashSet<>();
        for (int i = 0; i < 20_000; i++) {
            for (char c : ImmortalId.randomSuffix().toCharArray()) {
                seen.add(c);
            }
        }
        // All 36. A generator that never emits Z has a bug the shape test cannot
        // see, and it is exactly the kind of bug an off by one in an alphabet
        // index produces.
        assertThat(seen).hasSize(36);
    }

    @Test
    void doesNotRepeatItselfOverAShortRun() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 5_000; i++) {
            seen.add(ImmortalId.generate(2026, "IN", "A"));
        }
        // 5,000 draws from 60,466,176 gives an expected 0.2 duplicates, so a
        // handful is fine and a hundred is not. This catches a seeded or
        // constant generator, which is the failure worth catching.
        assertThat(seen.size()).isGreaterThan(4_990);
    }

    @Test
    void validatesWhatItGenerates() {
        for (int i = 0; i < 200; i++) {
            assertThat(ImmortalId.isValid(ImmortalId.generate(2026, "IN", "A"))).isTrue();
        }
    }

    @Test
    void rejectsTheWrongShape() {
        assertThat(ImmortalId.isValid(null)).isFalse();
        assertThat(ImmortalId.isValid("")).isFalse();
        assertThat(ImmortalId.isValid("HI-26INA-K3M7")).isFalse();      // four random chars
        assertThat(ImmortalId.isValid("HI-26INA-K3M7QQ")).isFalse();    // six
        assertThat(ImmortalId.isValid("HI-2026INA-K3M7Q")).isFalse();   // four digit year
        assertThat(ImmortalId.isValid("XX-26INA-K3M7Q")).isFalse();     // wrong prefix
        assertThat(ImmortalId.isValid("HI-26I1A-K3M7Q")).isFalse();     // digit in the country
        assertThat(ImmortalId.isValid("HI26INAK3M7Q")).isFalse();       // no separators
        assertThat(ImmortalId.isValid("HI-26INA-K3M7Q extra")).isFalse();
    }

    @Test
    void isCaseInsensitiveAndTolerantOfSurroundingSpace() {
        assertThat(ImmortalId.isValid("  hi-26ina-k3m7q  ")).isTrue();
    }

    @Test
    void parsesTheFixedSegments() {
        var parts = ImmortalId.parse("HI-26INA-K3M7Q").orElseThrow();
        assertThat(parts.year()).isEqualTo(2026);
        assertThat(parts.countryCode()).isEqualTo("IN");
        assertThat(parts.medicalSystemCode()).isEqualTo("A");
        assertThat(parts.suffix()).isEqualTo("K3M7Q");
    }

    @Test
    void parseIsEmptyForAnythingItCannotDecode() {
        assertThat(ImmortalId.parse("HI-K3M7Q-8XT2P")).isEmpty();
        assertThat(ImmortalId.parse("nonsense")).isEmpty();
        assertThat(ImmortalId.parse(null)).isEmpty();
    }

    @Test
    void refusesToBuildAnIdItCannotEncodeHonestly() {
        // A year two digits cannot express would produce a plausible looking
        // wrong answer, which is worse than an exception in a permanent
        // identifier.
        assertThatThrownBy(() -> ImmortalId.prefix(1999, "IN", "A"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ImmortalId.prefix(2100, "IN", "A"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ImmortalId.prefix(2026, "IND", "A"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ImmortalId.prefix(2026, "IN", "AY"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ImmortalId.prefix(2026, null, "A"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ImmortalId.prefix(2026, "IN", " "))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // -----------------------------------------------------------------------
    // Legacy
    //
    // Section 8.1 says an Immortal ID is permanent. A format change does not get
    // to suspend that, so IDs issued under the pre-V9 Crockford scheme still
    // have to resolve even though nothing can issue another one.
    // -----------------------------------------------------------------------

    @Test
    void stillRecognisesIdsIssuedBeforeTheFormatChanged() {
        // Golden vectors from the old generator, pinned in
        // frontend/src/features/public-verify/immortalId.test.ts.
        assertThat(ImmortalId.isLegacy("HI-K3M7Q-8XT2P")).isTrue();
        assertThat(ImmortalId.isLegacy("HI-00000-00000")).isTrue();
        assertThat(ImmortalId.isLegacy("HI-ZZZZZ-ZZZZ9")).isTrue();
        assertThat(ImmortalId.isLegacy("HI-12345-6789T")).isTrue();
        assertThat(ImmortalId.isLegacy("HI-ABCDE-FGHJT")).isTrue();
    }

    @Test
    void aLegacyIdWithABadCheckCharacterIsNotAcceptable() {
        assertThat(ImmortalId.isLegacy("HI-K3M7Q-8XT2A")).isFalse();
        assertThat(ImmortalId.isIssuable("HI-K3M7Q-8XT2A")).isFalse();
    }

    @Test
    void aCurrentIdIsNotMistakenForALegacyOne() {
        // Both formats are HI-XXXXX-XXXXX by shape. Only the Luhn check
        // separates them, which is why isLegacy verifies it rather than
        // matching a pattern: without that, a typo in a current ID could pass
        // as a valid old one.
        assertThat(ImmortalId.isLegacy("HI-26INA-K3M7Q")).isFalse();
        assertThat(ImmortalId.isValid("HI-26INA-K3M7Q")).isTrue();
    }

    @Test
    void isIssuableAcceptsBothFormatsAndNothingElse() {
        assertThat(ImmortalId.isIssuable("HI-26INA-K3M7Q")).isTrue();
        assertThat(ImmortalId.isIssuable("HI-K3M7Q-8XT2P")).isTrue();
        assertThat(ImmortalId.isIssuable("HI-26INA-K3M7")).isFalse();
        assertThat(ImmortalId.isIssuable("")).isFalse();
        assertThat(ImmortalId.isIssuable(null)).isFalse();
    }
}

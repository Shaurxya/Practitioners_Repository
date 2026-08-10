package com.herbimmortal.verification.util;

import java.security.SecureRandom;
import java.time.Year;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The Immortal ID: {@code HI-YYCCM-RRRRR}, for example {@code HI-26INA-K3M7Q}.
 *
 * <pre>
 *   HI - 26 IN A - K3M7Q
 *   │    │  │  │   └───── five random characters, A-Z and 0-9
 *   │    │  │  └───────── medical system code: A S U Y T
 *   │    │  └──────────── ISO 3166-1 alpha-2 country
 *   │    └─────────────── last two digits of the registration year
 *   └──────────────────── fixed platform prefix
 * </pre>
 *
 * Four of the fourteen characters are facts and five are entropy. That is a
 * deliberate trade and it is worth being honest about which way it went.
 *
 * <p><b>What it buys.</b> The identifier is readable. A support agent looking at
 * HI-26INA-K3M7Q knows the year, the country and the system without a database,
 * and a mistyped country or a nonsense year is visible on the page rather than
 * discovered by a failed lookup.
 *
 * <p><b>What it costs.</b> The previous format was nine random Crockford
 * characters plus a Luhn mod 32 check character: 45 bits, and every single
 * character error caught in the browser before a request went out. This one is
 * 36^5 = 60,466,176 per (year, country, system) bucket with no check character,
 * so a typo now reaches the server and comes back as "not verified" rather than
 * "you mistyped that". The bucket matters: entropy is per prefix, not global,
 * so two practitioners registered in the same year, country and system are
 * drawing from one 60 million space. At the volumes in section 1.1 that is
 * still a collision every few thousand years, and {@link #randomSuffix()} is
 * paired with a uniqueness check and a database constraint precisely because
 * "still" is not "never".
 *
 * <p>This class is pure and stateless. {@link SecureRandom} is thread safe, so
 * every method here is safe to call from any number of concurrent registrations.
 * It knows nothing about persistence: the uniqueness loop lives in
 * {@code ImmortalIdIssuer}, because checking a value against a table is not this
 * class's business and mixing the two is what makes an ID generator untestable.
 */
public final class ImmortalId {

    /** A-Z and 0-9, the alphabet the format specifies for the random segment. */
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    private static final int SUFFIX_LENGTH = 5;

    /**
     * Thread safe and seeded from the OS. Shared deliberately: a SecureRandom
     * per call re-seeds from the entropy pool every time, which is slower and no
     * more random.
     */
    private static final SecureRandom RANDOM = new SecureRandom();

    /** HI-YYCCM-RRRRR. Anchored, so a longer string is not a partial match. */
    private static final Pattern SHAPE =
            Pattern.compile("^HI-(\\d{2})([A-Z]{2})([A-Z])-([A-Z0-9]{5})$");

    /**
     * The format this system issued before V9: nine Crockford base32 characters
     * plus a Luhn mod 32 check character, grouped five and five.
     *
     * Kept because section 8.1 says an Immortal ID is permanent and immutable.
     * An ID printed on a certificate in the old format has to keep resolving,
     * which means every read path still has to recognise it even though nothing
     * can issue another one. The database says the same thing a different way:
     * V9 adds the format CHECK as NOT VALID.
     */
    private static final String CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final Pattern LEGACY_SHAPE = Pattern.compile("^HI-[0-9A-Z]{5}-[0-9A-Z]{5}$");

    private ImmortalId() {
    }

    /**
     * The four fixed characters, decoded. Everything a reader can learn from an
     * ID without a database.
     *
     * @param year the full registration year, reconstructed from the two digits
     */
    public record Parts(int year, String countryCode, String medicalSystemCode, String suffix) {
    }

    /**
     * Builds the {@code HI-YYCCM-} half. Separate from the suffix on purpose:
     * the uniqueness loop regenerates only the random five characters, so it
     * computes this once and holds it.
     *
     * @param year               full registration year, for example 2026
     * @param countryCode        ISO 3166-1 alpha-2, for example IN
     * @param medicalSystemCode  one character, for example A
     */
    public static String prefix(int year, String countryCode, String medicalSystemCode) {
        String country = require(countryCode, "country code").toUpperCase(Locale.ROOT);
        String system = require(medicalSystemCode, "medical system code").toUpperCase(Locale.ROOT);

        if (year < 2000 || year > 2099) {
            // Two digits cannot say which century, and pretending otherwise puts
            // a wrong but plausible year into a permanent identifier.
            throw new IllegalArgumentException(
                    "Registration year " + year + " is outside the range two digits can express");
        }
        if (country.length() != 2 || !country.matches("[A-Z]{2}")) {
            throw new IllegalArgumentException("Country code must be two letters, got: " + countryCode);
        }
        if (system.length() != 1 || !system.matches("[A-Z]")) {
            throw new IllegalArgumentException(
                    "Medical system code must be one letter, got: " + medicalSystemCode);
        }

        return "HI-" + String.format("%02d", year % 100) + country + system + "-";
    }

    /**
     * Five characters of A-Z and 0-9. This is the only part a collision
     * regenerates, which is why it is a method of its own.
     */
    public static String randomSuffix() {
        StringBuilder suffix = new StringBuilder(SUFFIX_LENGTH);
        for (int i = 0; i < SUFFIX_LENGTH; i++) {
            suffix.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        return suffix.toString();
    }

    /** A complete candidate ID. Not yet checked for uniqueness: that is the issuer's job. */
    public static String generate(int year, String countryCode, String medicalSystemCode) {
        return prefix(year, countryCode, medicalSystemCode) + randomSuffix();
    }

    /** The registration year is the year the ID is issued, read from the system clock. */
    public static String generate(String countryCode, String medicalSystemCode) {
        return generate(Year.now().getValue(), countryCode, medicalSystemCode);
    }

    /** True for the current format only. Legacy IDs are handled by {@link #isIssuable}. */
    public static boolean isValid(String id) {
        return id != null && SHAPE.matcher(id.trim().toUpperCase(Locale.ROOT)).matches();
    }

    /**
     * True for anything this system has ever issued, current format or legacy.
     *
     * This is what a lookup path uses. {@link #isValid} is what a writer uses.
     * Collapsing the two would either stop resolving IDs already in circulation
     * or let the old format be issued again.
     */
    public static boolean isIssuable(String id) {
        return isValid(id) || isLegacy(id);
    }

    /**
     * The pre-V9 format, verified through its Luhn mod 32 check character rather
     * than by shape alone. Shape alone would accept HI-26INA-K3M7Q as legacy,
     * and then a typo in a current ID could pass as a valid old one.
     */
    public static boolean isLegacy(String id) {
        if (id == null) {
            return false;
        }
        String candidate = id.trim().toUpperCase(Locale.ROOT);
        if (!LEGACY_SHAPE.matcher(candidate).matches()) {
            return false;
        }
        String payload = candidate.substring(3).replace("-", "");
        for (char c : payload.toCharArray()) {
            if (CROCKFORD.indexOf(c) < 0) {
                return false;
            }
        }
        return legacyCheckCharacter(payload.substring(0, 9)) == payload.charAt(9);
    }

    /**
     * Decodes the fixed segments. Empty for a legacy ID, which carries none of
     * them: that is a real difference and the caller has to see it rather than
     * be handed a fabricated year.
     */
    public static Optional<Parts> parse(String id) {
        if (id == null) {
            return Optional.empty();
        }
        var matcher = SHAPE.matcher(id.trim().toUpperCase(Locale.ROOT));
        if (!matcher.matches()) {
            return Optional.empty();
        }
        return Optional.of(new Parts(
                2000 + Integer.parseInt(matcher.group(1)),
                matcher.group(2),
                matcher.group(3),
                matcher.group(4)));
    }

    /** Luhn mod 32 over the Crockford alphabet. Reads legacy IDs, never writes one. */
    private static char legacyCheckCharacter(String input) {
        int n = CROCKFORD.length();
        int factor = 2;
        int sum = 0;

        for (int i = input.length() - 1; i >= 0; i--) {
            int codePoint = CROCKFORD.indexOf(input.charAt(i));
            int addend = factor * codePoint;
            factor = (factor == 2) ? 1 : 2;
            addend = (addend / n) + (addend % n);
            sum += addend;
        }

        return CROCKFORD.charAt((n - (sum % n)) % n);
    }

    private static String require(String value, String what) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("An Immortal ID cannot be built without a " + what);
        }
        return value.trim();
    }
}

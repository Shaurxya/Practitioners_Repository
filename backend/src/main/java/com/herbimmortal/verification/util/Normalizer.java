package com.herbimmortal.verification.util;

import java.text.Normalizer.Form;
import java.util.List;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * ============================================================================
 * THIS CLASS IS USED ON BOTH SIDES OF EVERY MATCH.
 *
 * Ingestion normalizes the registry with it. The matching engine normalizes the
 * incoming claim with it, at query time, in step 5 onward.
 *
 * If a second normalization implementation ever appears, in TypeScript on the
 * client or as a private helper in a service, the two sides will drift and
 * nothing will match. The failure is close to invisible: no exception, no log,
 * just verifications that quietly stop succeeding for a subset of inputs.
 *
 * Change a rule here and you must re-ingest the registry, because the stored
 * normalized columns were produced by the old rule.
 * ============================================================================
 *
 * Every rule below traces to a finding in the phase 2A profile of the real
 * export. Nothing here is defensive programming for cases that do not occur.
 *
 * All methods are static and pure: same input, same output, no state, no I/O.
 * That is what makes them testable without Spring, a database, or a fixture.
 */
public final class Normalizer {

    private Normalizer() {
        // Utility class. A private constructor stops anyone calling `new`.
    }

    // Titles that appear before a name. Profile found Dr, Vaidya, Vd, Prof,
    // Shri, Smt on the leading edge of roughly one name in three.
    private static final Set<String> TITLES = Set.of(
            "DR", "DOCTOR", "VAIDYA", "VD", "PROF", "PROFESSOR", "SHRI", "SRI",
            "SMT", "MR", "MRS", "MS", "PT", "PANDIT", "HAKEEM", "MISS"
    );

    // Qualifications that appear after a name. Stripped because the claimant
    // will not type them and their presence in the registry name would drag
    // every similarity score down.
    private static final Set<String> QUALIFICATIONS = Set.of(
            "BAMS", "BUMS", "BHMS", "MBBS", "MD", "MS", "PHD", "DNB", "DM",
            "MCH", "MSC", "BSC", "MPH", "FRCP", "AYU", "AYURVEDA", "PG", "DIP",
            "DIPLOMA"
    );

    private static final Pattern COMBINING_MARKS = Pattern.compile("\\p{M}+");
    private static final Pattern NON_ALNUM_SPACE = Pattern.compile("[^A-Z0-9 ]");
    private static final Pattern NON_ALNUM = Pattern.compile("[^A-Z0-9]");
    private static final Pattern WHITESPACE_RUN = Pattern.compile("\\s+");
    private static final Pattern LEADING_COUNCIL = Pattern.compile("^[A-Z]{2}");

    // ------------------------------------------------------------------
    // License numbers
    // ------------------------------------------------------------------

    /**
     * Canonicalizes a license number to UPPERCASE ALPHANUMERIC, with the
     * council code guaranteed to be present as a prefix.
     *
     * The profile found six shapes in the same column:
     *   MH4471   MH-4471   MH 4471   mh4471   4471   MH/4471/A
     * and 10.3% of rows omitted the council prefix entirely. Without the
     * prefix restoration below, a practitioner who types "MH-4471" would fail
     * to match a registry row recorded as "4471", which is one exact match in
     * ten failing for a reason nobody can see.
     *
     * <pre>
     *   ("MH-4471",   "MH") -> "MH4471"
     *   ("mh 4471",   "MH") -> "MH4471"
     *   ("4471",      "MH") -> "MH4471"
     *   ("MH/4471/A", "MH") -> "MH4471A"
     * </pre>
     *
     * @param raw         the value as the source or the claimant supplied it
     * @param councilCode the canonical two letter code, never the raw council text
     * @return canonical form, or empty string when the input has no alphanumerics
     */
    public static String normalizeLicenseNumber(String raw, String councilCode) {
        if (raw == null) {
            return "";
        }
        String stripped = NON_ALNUM.matcher(
                stripAccents(raw).toUpperCase(Locale.ROOT)).replaceAll("");
        if (stripped.isEmpty()) {
            return "";
        }
        if (councilCode == null || councilCode.isBlank()) {
            return stripped;
        }
        String code = councilCode.toUpperCase(Locale.ROOT);
        // Only prepend when the value does not already start with SOME council
        // prefix. Checking for two leading letters rather than for this exact
        // code avoids turning a mis-filed "KA4471" into "MHKA4471", which would
        // hide the data problem instead of surfacing it.
        if (LEADING_COUNCIL.matcher(stripped).lookingAt()) {
            return stripped;
        }
        return code + stripped;
    }

    // ------------------------------------------------------------------
    // Names
    // ------------------------------------------------------------------

    /**
     * Canonicalizes a practitioner name for comparison.
     *
     * Applied in order:
     *   1. Unicode NFKD plus combining mark removal, so "Sharmā" and "Sharma"
     *      compare equal. Profile found macrons on ~2% of names.
     *   2. Uppercase.
     *   3. "SHARMA, ANIL" becomes "ANIL SHARMA". Profile found 4% of names in
     *      surname-first form, and token order changes a similarity score.
     *   4. Punctuation to spaces, so "B.A.M.S." tokenizes.
     *   5. Leading titles removed, repeatedly, since "Dr. Prof." occurs.
     *   6. Trailing qualifications removed, repeatedly.
     *   7. Whitespace collapsed and trimmed.
     *
     * <pre>
     *   "Dr. Anil  Kumar Sharma, BAMS" -> "ANIL KUMAR SHARMA"
     *   "Sharma, Anil"                 -> "ANIL SHARMA"
     *   "Vaidya Meera Nair MD (Ayu)"   -> "MEERA NAIR"
     * </pre>
     */
    public static String normalizeName(String raw) {
        if (raw == null) {
            return "";
        }
        String text = stripAccents(raw).toUpperCase(Locale.ROOT);

        // Surname-first form. Only the first comma is structural; anything
        // after it is a qualification list and is dropped by step 6 anyway.
        int comma = text.indexOf(',');
        if (comma > 0) {
            String before = text.substring(0, comma).trim();
            String after = text.substring(comma + 1).trim();
            // Only swap when the tail looks like a given name rather than a
            // qualification, otherwise "ANIL SHARMA, BAMS" would become
            // "BAMS ANIL SHARMA".
            String firstAfterToken = after.split("[\\s,]+")[0].replace(".", "");
            if (!firstAfterToken.isEmpty() && !QUALIFICATIONS.contains(firstAfterToken)) {
                text = after + " " + before;
            }
        }

        text = NON_ALNUM_SPACE.matcher(text).replaceAll(" ");
        text = WHITESPACE_RUN.matcher(text).replaceAll(" ").trim();
        if (text.isEmpty()) {
            return "";
        }

        // Punctuation became spaces above, which shatters dotted acronyms:
        // "B.A.M.S." arrives here as "B A M S". Rejoining runs of two or more
        // consecutive single letters puts it back to "BAMS" so the
        // qualification stripper, which matches whole tokens, can see it.
        //
        // Runs of ONE are left alone, so the middle initial in
        // "ANIL K SHARMA" survives as its own token. It is discriminating
        // information and merging it would lose that.
        //
        // Deleting periods instead of replacing them was the obvious
        // alternative and it is wrong: "Dr.Arun" with no following space
        // becomes "DRARUN", which no title stripper will ever recognise.
        List<String> tokens = joinSingleLetterRuns(List.of(text.split(" ")));
        while (!tokens.isEmpty() && TITLES.contains(tokens.get(0))) {
            tokens.remove(0);
        }
        while (!tokens.isEmpty() && QUALIFICATIONS.contains(tokens.get(tokens.size() - 1))) {
            tokens.remove(tokens.size() - 1);
        }
        return String.join(" ", tokens);
    }

    // ------------------------------------------------------------------
    // Council
    // ------------------------------------------------------------------

    /**
     * Produces the lookup key for the council_aliases table.
     *
     * Not a council code: this class cannot know the code, that lives in the
     * database. It produces the normalized ALIAS, and the caller looks it up.
     *
     * <pre>
     *   "Maharashtra Council Of Indian Medicine"  -> "MAHARASHTRA COUNCIL OF INDIAN MEDICINE"
     *   "Karnataka Ayurvedic &amp; Unani Practitioners Board"
     *                              -> "KARNATAKA AYURVEDIC UNANI PRACTITIONERS BOARD"
     * </pre>
     * Note the ampersand disappears rather than becoming "AND", which is why
     * the seeded alias list contains both wordings.
     */
    public static String normalizeCouncilAlias(String raw) {
        if (raw == null) {
            return "";
        }
        String text = stripAccents(raw).toUpperCase(Locale.ROOT);
        text = NON_ALNUM_SPACE.matcher(text).replaceAll(" ");
        return WHITESPACE_RUN.matcher(text).replaceAll(" ").trim();
    }

    // ------------------------------------------------------------------
    // Status
    // ------------------------------------------------------------------

    /**
     * Maps a raw status string to one of the six values the CHECK constraint
     * on registry_records.status allows.
     *
     * Anything unrecognised becomes UNKNOWN rather than throwing. A status we
     * cannot read is a data quality problem, not a reason to reject an
     * otherwise usable registry row, and UNKNOWN fails the LICENSE_ACTIVE rule
     * anyway, so it routes to a human instead of silently passing.
     */
    public static String normalizeStatus(String raw) {
        String key = normalizeCouncilAlias(raw).replace(" ", "");
        return switch (key) {
            case "ACTIVE", "VALID", "INGOODSTANDING", "REGISTERED" -> "ACTIVE";
            case "SUSPENDED", "TEMPORARILYSUSPENDED"               -> "SUSPENDED";
            case "REVOKED", "CANCELLED", "CANCELED", "STRUCKOFF"   -> "REVOKED";
            case "EXPIRED", "LAPSED"                               -> "EXPIRED";
            case "INACTIVE", "DORMANT", "NOTPRACTISING"            -> "INACTIVE";
            default                                                -> "UNKNOWN";
        };
    }

    // ------------------------------------------------------------------

    /**
     * Merges runs of two or more consecutive single character tokens into one.
     *
     * <pre>
     *   [ANIL, SHARMA, B, A, M, S] -> [ANIL, SHARMA, BAMS]
     *   [ANIL, K, SHARMA]          -> [ANIL, K, SHARMA]      run of 1, untouched
     *   [DR, ANIL, SHARMA, M, D]   -> [DR, ANIL, SHARMA, MD]
     * </pre>
     *
     * Returns a mutable list, because the caller strips from both ends.
     */
    private static List<String> joinSingleLetterRuns(List<String> tokens) {
        List<String> out = new java.util.ArrayList<>(tokens.size());
        int i = 0;
        while (i < tokens.size()) {
            int j = i;
            while (j < tokens.size() && tokens.get(j).length() == 1) {
                j++;
            }
            int runLength = j - i;
            if (runLength >= 2) {
                out.add(String.join("", tokens.subList(i, j)));
                i = j;
            } else {
                out.add(tokens.get(i));
                i++;
            }
        }
        return out;
    }

    /** NFKD decomposition then combining mark removal. Handles macrons, accents. */
    private static String stripAccents(String raw) {
        String decomposed = java.text.Normalizer.normalize(raw, Form.NFKD);
        return COMBINING_MARKS.matcher(decomposed).replaceAll("");
    }

    // ------------------------------------------------------------------
    // Name similarity, for NAME_MATCH
    // ------------------------------------------------------------------

    /**
     * Token set similarity first, edit distance second, and the better of the
     * two.
     *
     * Registers reorder names constantly. "PRABHUDESSAI VINAYAK" against
     * "VINAYAK PRABHUDESSAI" is the same person and scores 0.36 on raw edit
     * distance, which would reject the claim outright. Token comparison catches
     * that; edit distance catches the single mistyped character that token
     * comparison scores as a total miss.
     */
    public static double similarity(String a, String b) {
        if (a == null || b == null || a.isEmpty() || b.isEmpty()) {
            return 0.0;
        }
        if (a.equals(b)) {
            return 1.0;
        }

        Set<String> tokensA = new HashSet<>(Arrays.asList(a.split(" ")));
        Set<String> tokensB = new HashSet<>(Arrays.asList(b.split(" ")));
        tokensA.remove("");
        tokensB.remove("");

        Set<String> union = new HashSet<>(tokensA);
        union.addAll(tokensB);
        Set<String> shared = new HashSet<>(tokensA);
        shared.retainAll(tokensB);
        double tokenScore = union.isEmpty() ? 0.0 : (double) shared.size() / union.size();

        int longest = Math.max(a.length(), b.length());
        double editScore = longest == 0 ? 0.0 : 1.0 - ((double) levenshtein(a, b) / longest);

        return Math.max(tokenScore, editScore);
    }

    private static int levenshtein(String a, String b) {
        int[] previous = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            previous[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            int[] current = new int[b.length() + 1];
            current[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(Math.min(previous[j] + 1, current[j - 1] + 1), previous[j - 1] + cost);
            }
            previous = current;
        }
        return previous[b.length()];
    }
}

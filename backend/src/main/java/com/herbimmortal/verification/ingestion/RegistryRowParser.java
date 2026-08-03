package com.herbimmortal.verification.ingestion;

import com.herbimmortal.verification.util.Normalizer;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Turns one raw source row into either a ParsedRow or a Reject.
 *
 * @Component registers this as a Spring bean so it can be constructor injected.
 * It holds no state, so it is safe as a singleton, which is Spring's default
 * scope. FastAPI dependencies are per request by default, Spring beans are not.
 */
@Component
public class RegistryRowParser {

    /** Every date format the phase 2A profile found, tried in order. */
    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.ROOT),
            DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.ROOT),
            DateTimeFormatter.ofPattern("dd-MM-yyyy", Locale.ROOT),
            DateTimeFormatter.ofPattern("yyyy/MM/dd", Locale.ROOT),
            DateTimeFormatter.ofPattern("dd-MMM-yyyy", Locale.ROOT)
    );

    /** Values that are present in the cell but mean "nothing here". */
    private static final List<String> BLANK_TOKENS =
            List.of("", "-", "--", "n/a", "na", "null", "nil", "none",
                    "not recorded", "not known", "unknown", "lifetime");

    /**
     * A sealed interface plus records is Java's tagged union. The compiler can
     * then verify that a switch over Outcome handles both cases, so a caller
     * cannot forget to deal with a reject.
     */
    public sealed interface Outcome permits ParsedRow, Reject {
    }

    public record ParsedRow(
            String licenseNoRaw, String fullNameRaw, String councilRaw,
            String statusRaw, String specialtyRaw, String qualificationRaw,
            String registrationDateRaw, String validUntilRaw,
            String licenseNoNormalized, String fullNameNormalized,
            String councilCode, String status,
            LocalDate registrationDate, LocalDate validUntil,
            int sourceRowNumber, String rawPayloadJson, String contentHash
    ) implements Outcome {
    }

    public record Reject(int sourceRowNumber, String rawPayloadJson,
                         RejectReason reason, String detail) implements Outcome {
    }

    /**
     * @param row            column name to raw cell value
     * @param rowNumber      1 based line number in the source, for reconciliation
     * @param councilCodes   normalized council alias to canonical code
     * @param rawPayloadJson the whole original row, serialized, stored as JSONB
     */
    public Outcome parse(Map<String, String> row, int rowNumber,
                         Map<String, String> councilCodes, String rawPayloadJson) {

        String licenseRaw = get(row, "registration_number");
        String nameRaw = get(row, "practitioner_name");
        String councilRaw = get(row, "council");

        if (isBlank(councilRaw)) {
            return new Reject(rowNumber, rawPayloadJson, RejectReason.MISSING_COUNCIL, null);
        }
        String alias = Normalizer.normalizeCouncilAlias(councilRaw);
        String councilCode = councilCodes.get(alias);
        if (councilCode == null) {
            // Deliberately not a guess. Add the alias to council_aliases and re-run.
            return new Reject(rowNumber, rawPayloadJson, RejectReason.UNKNOWN_COUNCIL,
                    "no council_aliases entry for: " + alias);
        }

        String licenseNormalized = Normalizer.normalizeLicenseNumber(licenseRaw, councilCode);
        if (licenseNormalized.isEmpty()) {
            return new Reject(rowNumber, rawPayloadJson, RejectReason.MISSING_LICENSE_NUMBER, null);
        }

        String nameNormalized = Normalizer.normalizeName(nameRaw);
        if (nameNormalized.isEmpty()) {
            return new Reject(rowNumber, rawPayloadJson, RejectReason.MISSING_NAME, null);
        }

        // Soft failures from here down: null the parsed value, keep the raw.
        String statusRaw = get(row, "status");
        String status = Normalizer.normalizeStatus(statusRaw);
        String regRaw = get(row, "registration_date");
        String expRaw = get(row, "valid_until");
        LocalDate registrationDate = parseDate(regRaw).orElse(null);
        LocalDate validUntil = parseDate(expRaw).orElse(null);

        String contentHash = sha256(String.join("|",
                licenseNormalized, nameNormalized, councilCode, status,
                String.valueOf(registrationDate), String.valueOf(validUntil),
                nullToEmpty(get(row, "specialty")), nullToEmpty(get(row, "qualification"))));

        return new ParsedRow(
                licenseRaw, nameRaw, councilRaw, statusRaw,
                get(row, "specialty"), get(row, "qualification"), regRaw, expRaw,
                licenseNormalized, nameNormalized, councilCode, status,
                registrationDate, validUntil,
                rowNumber, rawPayloadJson, contentHash);
    }

    private Optional<LocalDate> parseDate(String raw) {
        if (isBlank(raw)) {
            return Optional.empty();
        }
        String trimmed = raw.trim();
        for (DateTimeFormatter fmt : DATE_FORMATS) {
            try {
                return Optional.of(LocalDate.parse(trimmed, fmt));
            } catch (Exception ignored) {
                // Try the next format. An unreadable date is a soft failure:
                // the row is still stored, with null here and the raw preserved.
            }
        }
        return Optional.empty();
    }

    private static String get(Map<String, String> row, String column) {
        String v = row.get(column);
        return v == null ? null : v.trim();
    }

    private static boolean isBlank(String v) {
        return v == null || BLANK_TOKENS.contains(v.trim().toLowerCase(Locale.ROOT));
    }

    private static String nullToEmpty(String v) {
        return v == null ? "" : v;
    }

    /**
     * Digest of the normalized business fields only, never of provenance.
     * Two rows with the same hash state the same registry fact, which is
     * exactly what makes re-running the importer a no-op.
     */
    private static String sha256(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(input.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JDK spec", e);
        }
    }
}

package com.herbimmortal.verification.util;

import java.security.SecureRandom;

/**
 * HI-XXXXX-XXXXX: nine random Crockford base32 characters plus a check
 * character, grouped five and five so it reads aloud in two chunks.
 *
 * Nine characters is 45 bits, about 3.5e13. The brief asked for six, which is
 * 32^6 or roughly a billion: enumerable at a thousand requests a second, which
 * would make the rate limiter the only thing protecting the directory rather
 * than defence in depth.
 *
 * Crockford omits I, L, O and U, so 1/I, 0/O and V/U cannot be transcribed
 * wrong off a printed certificate.
 *
 * The check character is Luhn mod 32 over the same alphabet rather than
 * Crockford's own modulo 37 symbol, whose alphabet includes * ~ $ = and U.
 * Those look like corruption on a certificate. Luhn catches every single
 * character error and almost every adjacent transposition.
 */
public final class ImmortalId {

    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int BODY_LENGTH = 9;

    private ImmortalId() {
    }

    public static String generate() {
        StringBuilder body = new StringBuilder(BODY_LENGTH);
        for (int i = 0; i < BODY_LENGTH; i++) {
            body.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
        }
        String full = body + String.valueOf(checkCharacter(body.toString()));
        return "HI-" + full.substring(0, 5) + "-" + full.substring(5);
    }

    public static boolean isValid(String id) {
        if (id == null) {
            return false;
        }
        String compact = id.replaceAll("[^0-9A-Za-z]", "").toUpperCase();
        if (!compact.startsWith("HI") || compact.length() != 12) {
            return false;
        }
        String payload = compact.substring(2);
        for (char c : payload.toCharArray()) {
            if (ALPHABET.indexOf(c) < 0) {
                return false;
            }
        }
        return checkCharacter(payload.substring(0, BODY_LENGTH)) == payload.charAt(BODY_LENGTH);
    }

    private static char checkCharacter(String input) {
        int n = ALPHABET.length();
        int factor = 2;
        int sum = 0;

        for (int i = input.length() - 1; i >= 0; i--) {
            int codePoint = ALPHABET.indexOf(input.charAt(i));
            int addend = factor * codePoint;
            factor = (factor == 2) ? 1 : 2;
            addend = (addend / n) + (addend % n);
            sum += addend;
        }

        return ALPHABET.charAt((n - (sum % n)) % n);
    }
}

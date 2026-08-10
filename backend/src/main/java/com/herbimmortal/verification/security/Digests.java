package com.herbimmortal.verification.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * SHA-256, for the two secrets that are not passwords.
 *
 * <h2>Why not bcrypt here</h2>
 *
 * Password hashing is deliberately slow because a password is low entropy and
 * guessable: the cost factor is what makes a stolen hash table expensive to
 * attack. Refresh tokens and API keys are 256 bits from a CSPRNG. There is no
 * dictionary to try and no cost factor that improves on "cannot be guessed", so
 * bcrypt here would buy nothing and charge 60ms.
 *
 * <p>That is not a small charge. The API key digest is computed on every single
 * request authenticated by a key, and the refresh digest on every token
 * rotation. Using a password hash for them would make authentication the
 * dominant cost of an otherwise trivial call.
 *
 * <p>The rule this encodes: slow hashing for what a human chose, fast hashing
 * for what a random number generator chose. Getting it backwards is a real bug
 * in both directions.
 */
public final class Digests {

    private Digests() {
    }

    /** Lowercase hex, so the value is safe to store in a text column and to log a prefix of. */
    public static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            // Every JVM ships SHA-256. If this ever throws, the platform is
            // broken in a way no fallback here would survive.
            throw new IllegalStateException("SHA-256 is unavailable on this JVM", impossible);
        }
    }
}

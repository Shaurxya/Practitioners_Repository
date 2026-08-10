package com.herbimmortal.verification.crypto;

import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Encrypts one document with one key, and encrypts that key with the master key.
 *
 * <p>Envelope encryption, and the envelope is the whole point. The alternative,
 * encrypting every document directly with the master key, is fewer moving parts
 * and cannot do the one thing this design exists for: destroying a single
 * person's images. With one shared key there is nothing to destroy short of the
 * key everyone depends on. With a key per document, erasure is deleting fourteen
 * bytes from one row, and the object left in the bucket becomes noise that
 * nobody, including us, can ever read again.
 *
 * <p>That is what makes non negotiable 1 and a right to erasure able to coexist.
 * The row stays, the audit events that reference it stay, the case stays
 * explicable. Only the bytes go.
 *
 * <h2>Why AES-GCM and not AES-CBC</h2>
 *
 * GCM is authenticated: decryption fails loudly if the ciphertext was altered.
 * CBC would decrypt tampered input into plausible looking garbage, and for a
 * document whose whole purpose is to be evidence, "silently returns the wrong
 * bytes" is the worst available failure.
 *
 * <h2>The rule that must not be broken</h2>
 *
 * A (key, IV) pair must never be reused in GCM. Reusing one leaks the XOR of two
 * plaintexts and, worse, allows forgery. Both IVs here come from
 * {@link SecureRandom} per operation and are stored alongside the ciphertext, so
 * nothing is derived from a counter, a timestamp, or the document id.
 *
 * <p>{@code @Component} makes this a Spring managed singleton. SecureRandom and
 * Cipher.getInstance are thread safe in the way used here: a new Cipher instance
 * per call, never a shared one, because Cipher itself is stateful and sharing it
 * across requests is a data race that corrupts output rather than throwing.
 */
@Component
public class DocumentCipher {

    /** 96 bits, the size GCM is specified for. Longer IVs get hashed and buy nothing. */
    private static final int IV_BYTES = 12;

    /** 128 bit authentication tag, the maximum and the only sensible choice. */
    private static final int TAG_BITS = 128;

    private static final int DEK_BITS = 256;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final SecureRandom random = new SecureRandom();
    private final SecretKey masterKey;

    public DocumentCipher(DocumentProperties properties) {
        this.masterKey = new SecretKeySpec(decodeMasterKey(properties.masterKey()), "AES");
    }

    /**
     * The master key has no default anywhere, exactly like AUTH_SECRET.
     *
     * <p>A default master key is a key everyone who has read this repository
     * holds, and it would be protecting government photo IDs. Refusing to start
     * is the correct behaviour: a service that boots and silently encrypts
     * nothing usefully is worse than one that does not boot.
     */
    private static byte[] decodeMasterKey(String configured) {
        if (configured == null || configured.isBlank()) {
            throw new IllegalStateException("""
                    app.documents.master-key is not set, so identity documents cannot be \
                    encrypted and the application will not start. Generate one with:
                        openssl rand -base64 32
                    and put it in .env as DOCUMENT_MASTER_KEY.""");
        }
        byte[] key;
        try {
            key = Base64.getDecoder().decode(configured.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("app.documents.master-key is not valid base64", e);
        }
        if (key.length != 32) {
            throw new IllegalStateException(
                    "app.documents.master-key must decode to 32 bytes for AES-256, got " + key.length);
        }
        return key;
    }

    /**
     * A sealed document: the ciphertext, plus everything needed to open it
     * again, none of which is secret on its own.
     *
     * <p>{@code wrappedDek} is the only field that matters for erasure. Null it
     * and the ciphertext is unrecoverable.
     */
    public record Sealed(byte[] ciphertext, byte[] wrappedDek, byte[] dekIv, byte[] contentIv) {
    }

    /** Encrypts the bytes under a fresh key, and that key under the master key. */
    public Sealed seal(byte[] plaintext) {
        try {
            KeyGenerator generator = KeyGenerator.getInstance("AES");
            generator.init(DEK_BITS, random);
            SecretKey dek = generator.generateKey();

            byte[] contentIv = randomIv();
            byte[] ciphertext = run(Cipher.ENCRYPT_MODE, dek, contentIv, plaintext);

            byte[] dekIv = randomIv();
            byte[] wrappedDek = run(Cipher.ENCRYPT_MODE, masterKey, dekIv, dek.getEncoded());

            return new Sealed(ciphertext, wrappedDek, dekIv, contentIv);
        } catch (Exception e) {
            throw new IllegalStateException("Could not encrypt document", e);
        }
    }

    /**
     * Opens a sealed document.
     *
     * @throws ShreddedException when the key has been destroyed, which is a
     *         normal end state rather than an error: the caller has to tell a
     *         reviewer "this was erased" instead of "something went wrong".
     */
    public byte[] open(byte[] ciphertext, byte[] wrappedDek, byte[] dekIv, byte[] contentIv) {
        if (wrappedDek == null) {
            throw new ShreddedException();
        }
        try {
            byte[] dekBytes = run(Cipher.DECRYPT_MODE, masterKey, dekIv, wrappedDek);
            SecretKey dek = new SecretKeySpec(dekBytes, "AES");
            return run(Cipher.DECRYPT_MODE, dek, contentIv, ciphertext);
        } catch (Exception e) {
            // Includes AEADBadTagException, which means the ciphertext or the
            // wrapped key was altered. That is a tamper signal, not a bug.
            throw new IllegalStateException("Could not decrypt document", e);
        }
    }

    private byte[] randomIv() {
        byte[] iv = new byte[IV_BYTES];
        random.nextBytes(iv);
        return iv;
    }

    private static byte[] run(int mode, SecretKey key, byte[] iv, byte[] input) throws Exception {
        // A new Cipher per call. Cipher is stateful, and a shared instance
        // across concurrent uploads interleaves their blocks.
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(mode, key, new GCMParameterSpec(TAG_BITS, iv));
        return cipher.doFinal(input);
    }

    /** The document was erased on purpose. Distinct so the caller can say so. */
    public static class ShreddedException extends RuntimeException {
        public ShreddedException() {
            super("This document was erased and cannot be read.");
        }
    }
}

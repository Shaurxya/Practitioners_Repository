package com.herbimmortal.verification.crypto;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Envelope encryption for identity documents.
 *
 * <p>Pure unit tests, no Spring and no storage. What is under test is whether
 * the bytes come back, whether they cannot come back when they should not, and
 * whether two encryptions of the same passport look like each other. None of
 * that needs a container.
 */
class DocumentCipherTest {

    private static String randomMasterKey() {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        return Base64.getEncoder().encodeToString(key);
    }

    private static DocumentCipher cipher() {
        return cipher(randomMasterKey());
    }

    private static DocumentCipher cipher(String masterKey) {
        return new DocumentCipher(new DocumentProperties(
                masterKey, null, null, null, null, null, 0, 0));
    }

    private static final byte[] PASSPORT = "a scan of a passport".getBytes(StandardCharsets.UTF_8);

    @Test
    void sealsAndOpensTheSameBytes() {
        DocumentCipher cipher = cipher();
        var sealed = cipher.seal(PASSPORT);

        byte[] opened = cipher.open(sealed.ciphertext(), sealed.wrappedDek(),
                sealed.dekIv(), sealed.contentIv());

        assertThat(opened).isEqualTo(PASSPORT);
    }

    @Test
    void theStoredBytesAreNotThePlaintext() {
        var sealed = cipher().seal(PASSPORT);
        assertThat(sealed.ciphertext()).isNotEqualTo(PASSPORT);
        assertThat(new String(sealed.ciphertext(), StandardCharsets.UTF_8)).doesNotContain("passport");
    }

    /**
     * The same document uploaded twice must not produce the same ciphertext.
     *
     * <p>Otherwise the bucket leaks by comparison: anyone who can list objects
     * learns which practitioners submitted the identical file, without a key
     * and without reading anything. Each seal draws a fresh key and a fresh IV,
     * which is what makes that impossible.
     */
    @Test
    void twoSealsOfOneDocumentLookNothingAlike() {
        DocumentCipher cipher = cipher();

        var first = cipher.seal(PASSPORT);
        var second = cipher.seal(PASSPORT);

        assertThat(first.ciphertext()).isNotEqualTo(second.ciphertext());
        assertThat(first.wrappedDek()).isNotEqualTo(second.wrappedDek());
        assertThat(first.contentIv()).isNotEqualTo(second.contentIv());
    }

    /**
     * GCM is authenticated, and this is why it was chosen over CBC. A tampered
     * ciphertext must fail loudly rather than decrypt into plausible garbage.
     * For a document whose entire purpose is to be evidence, silently returning
     * the wrong bytes is the worst available failure.
     */
    @Test
    void refusesTamperedCiphertext() {
        DocumentCipher cipher = cipher();
        var sealed = cipher.seal(PASSPORT);

        byte[] tampered = sealed.ciphertext().clone();
        tampered[0] ^= 0x01;

        assertThatThrownBy(() -> cipher.open(tampered, sealed.wrappedDek(),
                sealed.dekIv(), sealed.contentIv()))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void refusesATamperedKey() {
        DocumentCipher cipher = cipher();
        var sealed = cipher.seal(PASSPORT);

        byte[] tampered = sealed.wrappedDek().clone();
        tampered[0] ^= 0x01;

        assertThatThrownBy(() -> cipher.open(sealed.ciphertext(), tampered,
                sealed.dekIv(), sealed.contentIv()))
                .isInstanceOf(IllegalStateException.class);
    }

    /**
     * Erasure. Destroying the wrapped key must make the ciphertext permanently
     * unreadable, and say so distinctly rather than looking like a fault: the
     * console has to tell a reviewer "this was erased", not "something broke".
     */
    @Test
    void aDestroyedKeyMeansTheDocumentIsGoneForever() {
        DocumentCipher cipher = cipher();
        var sealed = cipher.seal(PASSPORT);

        assertThatThrownBy(() -> cipher.open(sealed.ciphertext(), null,
                sealed.dekIv(), sealed.contentIv()))
                .isInstanceOf(DocumentCipher.ShreddedException.class);
    }

    /**
     * A document sealed under one master key must not open under another. This
     * is what makes rotating or losing the master key a real event rather than
     * a silent no-op, and it is worth pinning because a bug that ignored the
     * master key would pass every other test in this file.
     */
    @Test
    void aDifferentMasterKeyCannotOpenIt() {
        var sealed = cipher().seal(PASSPORT);
        DocumentCipher other = cipher();

        assertThatThrownBy(() -> other.open(sealed.ciphertext(), sealed.wrappedDek(),
                sealed.dekIv(), sealed.contentIv()))
                .isInstanceOf(IllegalStateException.class);
    }

    // ------------------------------------------------------------------
    // Startup validation. A misconfigured key must stop the application.
    // ------------------------------------------------------------------

    @Test
    void refusesToStartWithNoMasterKey() {
        assertThatThrownBy(() -> cipher(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("master-key");
        assertThatThrownBy(() -> cipher("   "))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void refusesAMasterKeyOfTheWrongLength() {
        assertThatThrownBy(() -> cipher(Base64.getEncoder().encodeToString(new byte[16])))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void refusesAMasterKeyThatIsNotBase64() {
        assertThatThrownBy(() -> cipher("this is not base64 !!!"))
                .isInstanceOf(IllegalStateException.class);
    }
}

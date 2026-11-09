package com.herbimmortal.verification.storage;

import com.herbimmortal.verification.crypto.DocumentCipher;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

/** Real MinIO storage round trip. An absent store must fail this test. */
@SpringBootTest
class ObjectStoreIntegrationTest {
    @Autowired ObjectStore store;
    @Autowired DocumentCipher cipher;

    @Test void encryptedBytesRoundTripThroughRealObjectStorage() {
        String key = "ci-fixtures/" + UUID.randomUUID();
        byte[] plain = "synthetic image fixture, no personal data".getBytes(StandardCharsets.UTF_8);
        var sealed = cipher.seal(plain);
        try {
            store.put(key, sealed.ciphertext());
            byte[] stored = store.get(key);
            assertThat(stored).isNotEqualTo(plain).isEqualTo(sealed.ciphertext());
            assertThat(cipher.open(stored, sealed.wrappedDek(), sealed.dekIv(), sealed.contentIv())).isEqualTo(plain);
        } finally {
            store.delete(key);
        }
    }
}

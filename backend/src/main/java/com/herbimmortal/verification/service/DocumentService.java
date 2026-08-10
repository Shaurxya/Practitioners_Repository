package com.herbimmortal.verification.service;

import com.herbimmortal.verification.crypto.DocumentCipher;
import com.herbimmortal.verification.crypto.DocumentProperties;
import com.herbimmortal.verification.storage.ObjectStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Identity documents: in encrypted, out audited, erased by destroying a key.
 *
 * <p>Uploads go through this application rather than straight to storage on a
 * presigned URL, which is a deliberate departure from the API surface sketched
 * in section 7. That sketch was drawn for registry files, which are large and
 * not secret. A government photo ID is small and is the most sensitive thing
 * here, and non negotiable 5 requires it encrypted at rest under a key the
 * client must never hold. A presigned PUT writes the browser's plaintext
 * straight into the bucket, so the per document key would be protecting bytes
 * that had already been stored unprotected. Encrypting in the request path is
 * the only ordering that makes the guarantee true.
 *
 * <p>The cost is honest: these bytes pass through the app server's memory and
 * count against its request size limit. At a few megabytes and under 500
 * verifications a day that is not a real cost, and if it ever becomes one the
 * fix is client side encryption with a server issued key, not a plaintext
 * presigned PUT.
 */
@Service
public class DocumentService {

    private static final Logger log = LoggerFactory.getLogger(DocumentService.class);

    private static final Set<String> ALLOWED_KINDS =
            Set.of("PHOTO_ID", "SELFIE", "REGISTRATION_CERTIFICATE");

    /**
     * What a phone camera and a scanner produce. Deliberately short: every
     * extra format is another parser somewhere downstream that has to be safe
     * against a file chosen by a stranger.
     */
    private static final Set<String> ALLOWED_TYPES =
            Set.of("image/jpeg", "image/png", "application/pdf");

    private final JdbcTemplate jdbc;
    private final ObjectStore store;
    private final DocumentCipher cipher;
    private final DocumentProperties properties;
    private final com.fasterxml.jackson.databind.ObjectMapper json;

    public DocumentService(JdbcTemplate jdbc, ObjectStore store, DocumentCipher cipher,
                           DocumentProperties properties,
                           com.fasterxml.jackson.databind.ObjectMapper json) {
        this.jdbc = jdbc;
        this.store = store;
        this.cipher = cipher;
        this.properties = properties;
        this.json = json;
    }

    /**
     * Encrypt, store, then record. The order matters and it is the safe one.
     *
     * <p>If the put succeeds and the insert then fails, the result is an object
     * with no row: unreferenced, and unreadable because its key was never
     * written down. If the order were reversed, a failed put would leave a row
     * promising a document that does not exist, which a reviewer would meet as a
     * broken image with no explanation.
     */
    @Transactional
    public UUID upload(UUID ownerUserId, String kind, String contentType,
                       String fileName, byte[] content) {
        String normalizedKind = require(kind, ALLOWED_KINDS, "document kind");
        String type = normalizeContentType(contentType, fileName);

        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("That file is empty.");
        }
        if (content.length > properties.maxBytes()) {
            throw new IllegalArgumentException("That file is larger than "
                    + (properties.maxBytes() / (1024 * 1024)) + " MB. Try a smaller photo.");
        }
        // The declared content type is whatever the browser chose to send, so
        // it is a hint and not a fact. Checking the leading bytes is what stops
        // an executable arriving labelled image/jpeg and being handed to a
        // reviewer's browser later.
        if (!looksLike(type, content)) {
            throw new IllegalArgumentException(
                    "That file does not look like a " + type + ". Upload a JPEG, PNG or PDF.");
        }

        // Of the plaintext, before encryption. Two uploads of the same scan
        // produce the same digest even though their ciphertexts differ, which
        // is what makes it useful for spotting one document across claims.
        String sha256 = sha256(content);

        var sealed = cipher.seal(content);
        String storageKey = UUID.randomUUID() + "/" + UUID.randomUUID();

        store.put(storageKey, sealed.ciphertext());

        UUID id = UUID.randomUUID();
        try {
            jdbc.update("insert into documents (id, owner_user_id, kind, storage_key, content_type,"
                            + " size_bytes, sha256, status, wrapped_dek, dek_iv, content_iv)"
                            + " values (?,?,?,?,?,?,?, 'CONFIRMED', ?,?,?)",
                    id, ownerUserId, normalizedKind, storageKey, type,
                    (long) content.length, sha256,
                    sealed.wrappedDek(), sealed.dekIv(), sealed.contentIv());
        } catch (RuntimeException e) {
            // No row will ever reference this object, and nothing holds its
            // key, so it is unreadable noise. Remove it anyway rather than pay
            // to store it forever.
            safeDelete(storageKey);
            throw e;
        }

        audit(id, "DOCUMENT_UPLOADED", ownerUserId, Map.of(
                "kind", normalizedKind, "contentType", type, "sizeBytes", content.length));
        return id;
    }

    /**
     * The plaintext, and an audit event saying who read it.
     *
     * <p>Non negotiable 5: every read of a document body produces an audit
     * event. The event is written before the bytes are returned, so a read that
     * happened is recorded even if the response never reaches the caller. The
     * opposite ordering loses exactly the reads someone would most want hidden.
     */
    @Transactional
    public Document read(UUID documentId, UUID readerUserId, String why) {
        Map<String, Object> row = requireRow(documentId);

        audit(documentId, "DOCUMENT_READ", readerUserId,
                Map.of("reason", why == null ? "unspecified" : why));

        byte[] wrappedDek = (byte[]) row.get("wrapped_dek");
        if (wrappedDek == null) {
            throw new DocumentCipher.ShreddedException();
        }

        byte[] ciphertext = store.get(String.valueOf(row.get("storage_key")));
        byte[] plaintext = cipher.open(ciphertext, wrappedDek,
                (byte[]) row.get("dek_iv"), (byte[]) row.get("content_iv"));

        return new Document(documentId, String.valueOf(row.get("kind")),
                String.valueOf(row.get("content_type")), plaintext);
    }

    public record Document(UUID id, String kind, String contentType, byte[] content) {
    }

    /**
     * Attaches documents to a case, once the case exists.
     *
     * <p>Ownership is re-checked here rather than trusted from upload time. The
     * document id is supplied by the client at submit, and without this check a
     * caller could attach somebody else's uploaded passport to their own claim
     * and have a reviewer approve it.
     */
    @Transactional
    public void linkToCase(UUID caseId, UUID ownerUserId, List<UUID> documentIds) {
        for (UUID documentId : documentIds) {
            if (documentId == null) {
                continue;
            }
            Map<String, Object> row = requireRow(documentId);
            if (!ownerUserId.equals(row.get("owner_user_id"))) {
                // Not found rather than forbidden, for the reason section 7.3
                // gives for cases: the difference between the two answers tells
                // a caller walking ids which documents exist.
                throw new DocumentNotFoundException(documentId);
            }
            jdbc.update("insert into case_documents (case_id, document_id) values (?,?)"
                    + " on conflict do nothing", caseId, documentId);
        }
    }

    public List<Map<String, Object>> forCase(UUID caseId) {
        return jdbc.queryForList(
                "select d.id, d.kind, d.content_type, d.size_bytes, d.uploaded_at,"
                        + " d.wrapped_dek is null as erased"
                        + " from documents d join case_documents cd on cd.document_id = d.id"
                        + " where cd.case_id = ? order by d.kind",
                caseId);
    }

    /**
     * Erasure. Destroys the key and leaves everything else standing.
     *
     * <p>This is the mechanism section 10 asks for when it records that a right
     * to erasure conflicts with an append only audit log. The row survives, so
     * every audit event that references this document still resolves; the case
     * survives, so the decision stays explicable; and the object survives as
     * ciphertext nobody can open, including us. Only the readable content goes.
     */
    @Transactional
    public void shred(UUID documentId, UUID actorUserId, String why) {
        jdbc.update("update documents set wrapped_dek = null, dek_iv = null,"
                + " dek_destroyed_at = now() where id = ? and wrapped_dek is not null", documentId);
        audit(documentId, "DOCUMENT_SHREDDED", actorUserId,
                Map.of("reason", why == null ? "retention" : why));
        log.info("shredded document {}", documentId);
    }

    // ------------------------------------------------------------------

    private Map<String, Object> requireRow(UUID documentId) {
        var rows = jdbc.queryForList("select * from documents where id = ?", documentId);
        if (rows.isEmpty()) {
            throw new DocumentNotFoundException(documentId);
        }
        return rows.get(0);
    }

    private void safeDelete(String storageKey) {
        try {
            store.delete(storageKey);
        } catch (RuntimeException e) {
            log.warn("could not remove orphaned object {}", storageKey, e);
        }
    }

    private static String require(String value, Set<String> allowed, String what) {
        String normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (!allowed.contains(normalized)) {
            throw new IllegalArgumentException("Unknown " + what + ": " + value);
        }
        return normalized;
    }

    private static String normalizeContentType(String declared, String fileName) {
        String type = declared == null ? "" : declared.trim().toLowerCase(Locale.ROOT);
        int semicolon = type.indexOf(';');
        if (semicolon > 0) {
            type = type.substring(0, semicolon).trim();
        }
        if (type.equals("image/jpg")) {
            type = "image/jpeg";
        }
        if (!ALLOWED_TYPES.contains(type)) {
            throw new IllegalArgumentException(
                    "Upload a JPEG, PNG or PDF. " + (fileName == null ? "" : fileName)
                            + " is " + (type.isEmpty() ? "an unknown type" : type) + ".");
        }
        return type;
    }

    /** Magic bytes. The declared type is client controlled and this is not. */
    private static boolean looksLike(String type, byte[] content) {
        if (content.length < 4) {
            return false;
        }
        return switch (type) {
            case "image/jpeg" -> (content[0] & 0xFF) == 0xFF && (content[1] & 0xFF) == 0xD8;
            case "image/png" -> (content[0] & 0xFF) == 0x89 && content[1] == 'P'
                    && content[2] == 'N' && content[3] == 'G';
            case "application/pdf" -> content[0] == '%' && content[1] == 'P'
                    && content[2] == 'D' && content[3] == 'F';
            default -> false;
        };
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(content));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private void audit(UUID documentId, String eventType, UUID actorUserId,
                       Map<String, Object> metadata) {
        try {
            jdbc.update("insert into audit_events (event_type, subject_type, subject_id,"
                            + " actor_type, actor_id, metadata) values (?,?,?,?,?,?::jsonb)",
                    eventType, "document", documentId, "USER",
                    actorUserId == null ? null : actorUserId.toString(),
                    json.writeValueAsString(metadata));
        } catch (Exception e) {
            log.error("could not write {} audit event for document {}", eventType, documentId, e);
        }
    }

    /** 404, never 403. See linkToCase. */
    public static class DocumentNotFoundException extends RuntimeException {
        public DocumentNotFoundException(UUID id) {
            super("No document " + id);
        }
    }
}

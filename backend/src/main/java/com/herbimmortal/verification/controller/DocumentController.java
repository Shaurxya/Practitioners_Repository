package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.crypto.DocumentCipher;
import com.herbimmortal.verification.security.UserPrincipal;
import com.herbimmortal.verification.service.DocumentService;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

/**
 * Upload identity evidence, and read it back if you are allowed to.
 *
 * <h2>Why the upload is multipart and not a presigned URL</h2>
 *
 * Section 7 sketched {@code /documents/presign} and {@code /documents/confirm}.
 * That shape is right for registry files, which are large and not secret. It is
 * wrong here. A presigned PUT sends the browser's plaintext straight into the
 * bucket, so the per document key would be protecting bytes that had already
 * been written unprotected, and non negotiable 5 would be satisfied on paper
 * only. Encrypting in the request path is the only ordering under which the
 * claim "encrypted at rest" is true.
 */
@RestController
@RequestMapping("/api/v1/documents")
public class DocumentController {

    /**
     * Every endpoint here demands a browser session, never an API key.
     *
     * <p>{@code UserPrincipal.authenticatedBy} exists for exactly this and its
     * own javadoc says so: collapsing the two "would let a long lived key act on
     * screens designed around a fifteen minute token". Identity documents are
     * where that stops being theoretical. An API key is a bearer credential with
     * no expiry that a machine holds in configuration, and the difference
     * between it leaking and an access token leaking is fifteen minutes versus
     * until somebody notices.
     *
     * <p>Without this an admin's API key could download a stored government
     * photo ID, which was true and tested before this line was added. Nothing
     * legitimate needs it: section 12.2 scopes API keys to
     * {@code /api/v1/internal/**}, and no machine has a reason to take a selfie
     * or to look at one.
     */
    private static final String SESSION_ONLY =
            "principal.authenticatedBy.name() == 'SESSION'";

    private final DocumentService documents;

    public DocumentController(DocumentService documents) {
        this.documents = documents;
    }

    public record UploadedView(String documentId, String kind, long sizeBytes) {
    }

    /**
     * Stores one image, encrypted, and returns its id.
     *
     * <p>The document is not attached to anything yet. It is linked to a case
     * at submit, which is what lets the wizard upload during step 3 without
     * creating a case: {@code uq_practitioner_open_case} allows one open case
     * per practitioner, so a case created here and abandoned would lock the
     * person out permanently.
     *
     * <p>{@code @RequestParam("file") MultipartFile} is Spring's multipart
     * binding. The FastAPI equivalent is {@code file: UploadFile = File(...)}.
     */
    @PostMapping
    @PreAuthorize(SESSION_ONLY)
    public ResponseEntity<UploadedView> upload(@RequestParam("file") MultipartFile file,
                                               @RequestParam("kind") String kind,
                                               @AuthenticationPrincipal UserPrincipal caller)
            throws IOException {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("Choose a file to upload.");
        }
        UUID id = documents.upload(caller.id(), kind, file.getContentType(),
                file.getOriginalFilename(), file.getBytes());
        return ResponseEntity.ok(new UploadedView(id.toString(), kind.toUpperCase(), file.getSize()));
    }

    /**
     * The decrypted bytes, for a reviewer working a case.
     *
     * <p>REVIEWER or ADMIN only, and every call writes a DOCUMENT_READ audit
     * event naming the reader. That is non negotiable 5, and it is the reason
     * this endpoint exists rather than the console being handed a presigned
     * download URL: a URL, once issued, is used without us seeing it, so the
     * log would record that a link was minted and never that a passport was
     * looked at.
     *
     * <p>Practitioners deliberately cannot read their own uploads back. There
     * is nothing to gain from it, and an endpoint that returns a stored
     * government ID to whoever holds the session is a much larger target than
     * one restricted to staff.
     */
    @GetMapping("/{documentId}/content")
    @PreAuthorize("hasAnyRole('REVIEWER','ADMIN') and " + SESSION_ONLY)
    public ResponseEntity<Resource> content(@PathVariable UUID documentId,
                                            @AuthenticationPrincipal UserPrincipal caller) {
        DocumentService.Document document =
                documents.read(documentId, caller.id(), "review console");

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(document.contentType()))
                // No caching anywhere. A government ID sitting in a shared proxy
                // or a disk cache outlives both the session and the audit event
                // that was supposed to account for every read of it.
                .cacheControl(CacheControl.noStore().cachePrivate())
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline")
                // Stops a browser from sniffing this into something executable.
                .header("X-Content-Type-Options", "nosniff")
                .body(new ByteArrayResource(document.content()));
    }

    /**
     * Erasure. Destroys the key, keeps the row.
     *
     * <p>ADMIN only. This is irreversible by design: there is no path back from
     * a destroyed key, which is what makes it a real erasure rather than a flag
     * somebody can unset.
     */
    @DeleteMapping("/{documentId}")
    @PreAuthorize("hasRole('ADMIN') and " + SESSION_ONLY)
    public ResponseEntity<Map<String, String>> shred(@PathVariable UUID documentId,
                                                     @RequestParam(required = false) String reason,
                                                     @AuthenticationPrincipal UserPrincipal caller) {
        documents.shred(documentId, caller.id(), reason);
        return ResponseEntity.ok(Map.of(
                "documentId", documentId.toString(),
                "status", "ERASED",
                "message", "The key was destroyed. These bytes can no longer be read by anyone."));
    }

    /** A document erased on purpose is 410 Gone, not 404 and not 500. */
    @ExceptionHandler(DocumentCipher.ShreddedException.class)
    public ResponseEntity<Map<String, Object>> shredded(DocumentCipher.ShreddedException e) {
        return ResponseEntity.status(410).body(Map.of(
                "code", "DOCUMENT_ERASED",
                "message", e.getMessage(),
                "timestamp", java.time.Instant.now().toString()));
    }
}

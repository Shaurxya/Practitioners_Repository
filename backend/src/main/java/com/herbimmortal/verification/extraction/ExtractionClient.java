package com.herbimmortal.verification.extraction;

import com.herbimmortal.verification.extraction.ExtractionDtos.ClassifyRequest;
import com.herbimmortal.verification.extraction.ExtractionDtos.ClassifyResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.DetectResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.ExtractRequest;
import com.herbimmortal.verification.extraction.ExtractionDtos.ExtractResponse;
import com.herbimmortal.verification.extraction.ExtractionDtos.Health;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.time.Duration;

/**
 * The only class that talks to the extraction sidecar.
 *
 * RestClient is Spring 6's synchronous HTTP client, the replacement for
 * RestTemplate. Closest equivalents: httpx.Client in Python, or fetch wrapped in
 * a module that owns the base URL and error shape, which is exactly what
 * apiClient.ts does on the React side.
 *
 * Every failure becomes an ExtractionException carrying one of the batch
 * failure codes the schema already defines, so the console can show a specific,
 * actionable screen instead of a generic 500. "Your PDF is encrypted", "the
 * sidecar died at page 380" and "the sidecar is not running" need different
 * actions, and collapsing them loses exactly the information an operator needs.
 */
@Component
public class ExtractionClient {

    private static final Logger log = LoggerFactory.getLogger(ExtractionClient.class);

    private final RestClient classifyClient;
    private final RestClient extractClient;
    private final ExtractionProperties properties;

    public ExtractionClient(ExtractionProperties properties) {
        this.properties = properties;
        this.classifyClient = build(properties.baseUrl(), properties.classifyTimeout());
        this.extractClient = build(properties.baseUrl(), properties.extractTimeout());
    }

    private static RestClient build(String baseUrl, Duration timeout) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) Duration.ofSeconds(5).toMillis());
        factory.setReadTimeout((int) timeout.toMillis());
        return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    /**
     * Whether the sidecar is reachable AND able to do the job. A sidecar that
     * answers 200 while unable to read a scanned page is a green light that
     * costs a whole overnight run.
     */
    public Health health() {
        try {
            return classifyClient.get().uri("/health").retrieve().body(Health.class);
        } catch (ResourceAccessException e) {
            throw new ExtractionException("EXTRACTOR_UNAVAILABLE",
                    "The extraction service is not reachable at " + properties.baseUrl(), e);
        }
    }

    public ClassifyResponse classify(String batchId, String sourcePath) {
        return call(classifyClient, "/v1/classify",
                new ClassifyRequest(batchId, sourcePath, null), ClassifyResponse.class, batchId);
    }

    public DetectResponse detectColumns(String batchId, String sourcePath) {
        return call(classifyClient, "/v1/detect-columns",
                new ClassifyRequest(batchId, sourcePath, null), DetectResponse.class, batchId);
    }

    public ExtractResponse extract(ExtractRequest request) {
        return call(extractClient, "/v1/extract", request, ExtractResponse.class, request.batchId());
    }

    private <T> T call(RestClient client, String path, Object body, Class<T> type, String batchId) {
        try {
            return client.post().uri(path).body(body).retrieve().body(type);
        } catch (ResourceAccessException e) {
            // Connection refused, or the read timed out. Both mean the run is
            // over; the batch watchdog is what stops it sitting in PARSING.
            log.error("extraction service unreachable for batch {}", batchId, e);
            throw new ExtractionException("EXTRACTOR_UNAVAILABLE",
                    "The extraction service did not respond. It may be down, or the document "
                            + "may be larger than the configured timeout allows.", e);
        } catch (RestClientResponseException e) {
            // The sidecar answered and refused. 422 is a document it could not
            // read, which is a different problem from the service being broken.
            log.error("extraction service rejected batch {}: {}", batchId, e.getResponseBodyAsString());
            String code = e.getStatusCode().value() == 422 ? "NO_READABLE_PAGES" : "EXTRACTOR_ERROR";
            throw new ExtractionException(code, e.getResponseBodyAsString(), e);
        }
    }
}

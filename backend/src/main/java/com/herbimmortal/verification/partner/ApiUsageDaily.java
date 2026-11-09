package com.herbimmortal.verification.partner;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/** Aggregated counters. Later metering uses atomic SQL upserts rather than read/modify/save. */
@Entity
@Table(name = "api_usage_daily")
public class ApiUsageDaily {
    @EmbeddedId private Id id;
    @Column(name = "request_count", nullable = false) private long requestCount;
    @Column(name = "lookup_units", nullable = false) private long lookupUnits;
    @Column(name = "rate_limit_hits", nullable = false) private long rateLimitHits;

    protected ApiUsageDaily() { }

    public ApiUsageDaily(Id id) { this.id = Objects.requireNonNull(id); }

    public Id getId() { return id; }
    public long getRequestCount() { return requestCount; }
    public long getLookupUnits() { return lookupUnits; }
    public long getRateLimitHits() { return rateLimitHits; }

    @Embeddable
    public static class Id implements Serializable {
        @Column(name = "key_id", nullable = false) private UUID keyId;
        @Column(nullable = false) private LocalDate day;
        @Column(name = "endpoint_template", nullable = false) private String endpointTemplate;
        @Column(name = "status_class", nullable = false) private String statusClass;

        protected Id() { }

        public Id(UUID keyId, LocalDate day, String endpointTemplate, String statusClass) {
            this.keyId = Objects.requireNonNull(keyId);
            this.day = Objects.requireNonNull(day);
            if (!java.util.Set.of("PARTNER_LOOKUP", "PARTNER_BATCH", "PARTNER_ME").contains(endpointTemplate)) {
                throw new IllegalArgumentException("Invalid endpoint template.");
            }
            if (!java.util.Set.of("2xx", "3xx", "4xx", "5xx").contains(statusClass)) {
                throw new IllegalArgumentException("Invalid status class.");
            }
            this.endpointTemplate = endpointTemplate;
            this.statusClass = statusClass;
        }

        public UUID getKeyId() { return keyId; }
        public LocalDate getDay() { return day; }
        public String getEndpointTemplate() { return endpointTemplate; }
        public String getStatusClass() { return statusClass; }

        @Override public boolean equals(Object other) {
            return other instanceof Id that && Objects.equals(keyId, that.keyId)
                    && Objects.equals(day, that.day) && Objects.equals(endpointTemplate, that.endpointTemplate)
                    && Objects.equals(statusClass, that.statusClass);
        }
        @Override public int hashCode() { return Objects.hash(keyId, day, endpointTemplate, statusClass); }
    }
}

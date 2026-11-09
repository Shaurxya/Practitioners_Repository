package com.herbimmortal.verification.partner;

import jakarta.persistence.*;

import java.io.Serializable;
import java.time.LocalDate;
import java.util.Objects;
import java.util.UUID;

/** Admission authority. TEST and LIVE cannot consume each other's allowance. */
@Entity
@Table(name = "api_quota_monthly")
public class ApiQuotaMonthly {
    @EmbeddedId private Id id;
    @Column(name = "consumed_units", nullable = false) private long consumedUnits;
    @Column(name = "limit_units", nullable = false) private long limitUnits;

    protected ApiQuotaMonthly() { }

    public ApiQuotaMonthly(Id id, long limitUnits) {
        this.id = Objects.requireNonNull(id);
        if (limitUnits < 0) throw new IllegalArgumentException("Quota cannot be negative.");
        this.limitUnits = limitUnits;
    }

    public Id getId() { return id; }
    public long getConsumedUnits() { return consumedUnits; }
    public long getLimitUnits() { return limitUnits; }

    @Embeddable
    public static class Id implements Serializable {
        @Column(name = "client_id", nullable = false) private UUID clientId;
        @Enumerated(EnumType.STRING) @Column(nullable = false) private PartnerTypes.Environment environment;
        @Column(name = "month_start", nullable = false) private LocalDate monthStart;

        protected Id() { }

        public Id(UUID clientId, PartnerTypes.Environment environment, LocalDate monthStart) {
            this.clientId = Objects.requireNonNull(clientId);
            this.environment = Objects.requireNonNull(environment);
            this.monthStart = Objects.requireNonNull(monthStart);
            if (monthStart.getDayOfMonth() != 1) throw new IllegalArgumentException("Expected month start.");
        }

        public UUID getClientId() { return clientId; }
        public PartnerTypes.Environment getEnvironment() { return environment; }
        public LocalDate getMonthStart() { return monthStart; }

        @Override public boolean equals(Object other) {
            return other instanceof Id that && Objects.equals(clientId, that.clientId)
                    && environment == that.environment && Objects.equals(monthStart, that.monthStart);
        }
        @Override public int hashCode() { return Objects.hash(clientId, environment, monthStart); }
    }
}

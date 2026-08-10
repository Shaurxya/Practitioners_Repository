package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A system of medicine: Ayurveda, Siddha, Unani, Yoga, Traditional Chinese
 * Medicine. Maps the medical_systems table seeded by V9.
 *
 * The single character code is the M segment of an Immortal ID. It is one
 * character because the identifier has room for one, and V9 enforces that with
 * a CHECK rather than leaving it to a comment: a two character code added later
 * would silently lengthen every ID issued after it and break every regex that
 * reads one.
 *
 * A table rather than an enum because Homoeopathy and Naturopathy are the
 * obvious next rows and neither should need a redeploy.
 */
@Entity
@Table(name = "medical_systems")
public class MedicalSystem {

    @Id
    private String code;

    @Column(nullable = false)
    private String name;

    /** Display order on the claim form. Alphabetical would bury Ayurveda mid list. */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder = 100;

    @Column(nullable = false)
    private boolean enabled = true;

    protected MedicalSystem() {
    }

    public String getCode() { return code; }
    public String getName() { return name; }
    public int getSortOrder() { return sortOrder; }
    public boolean isEnabled() { return enabled; }
}

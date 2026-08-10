package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * An ISO 3166-1 alpha-2 country. Maps the countries table seeded by V9.
 *
 * The code is the CC segment of an Immortal ID verbatim, which is why it is a
 * table rather than a Java enum: adding a country is a migration, exactly as it
 * is for councils, and for the same reason. A code invented locally would be
 * baked permanently into every ID issued under it.
 */
@Entity
@Table(name = "countries")
public class Country {

    @Id
    private String code;

    @Column(nullable = false)
    private String name;

    /** A country we hold a register for, as opposed to one that merely exists. */
    @Column(nullable = false)
    private boolean enabled = true;

    protected Country() {
    }

    public String getCode() { return code; }
    public String getName() { return name; }
    public boolean isEnabled() { return enabled; }
}

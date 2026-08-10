package com.herbimmortal.verification.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * A registering body. Maps the councils table seeded by V2 and V4.
 *
 * A table rather than a Java enum, deliberately: adding a council is a
 * migration, not a redeploy. The console reads this list rather than shipping a
 * copy, because a hardcoded client list is how the claim form went on offering
 * four councils for weeks after the registry covered thirty six.
 */
@Entity
@Table(name = "councils")
public class Council {

    @Id
    private String code;

    @Column(name = "canonical_name", nullable = false)
    private String canonicalName;

    /**
     * The country this body registers in, and the authority for the CC segment
     * of an Immortal ID.
     *
     * The claim form asks the practitioner to pick a country, but the answer
     * only narrows the council list: a council is in a country whether or not
     * the form agrees. When the two disagree the server rejects the claim rather
     * than quietly preferring one, because either answer could be the mistake.
     */
    @Column(name = "country_code", nullable = false)
    private String countryCode;

    protected Council() {
    }

    public String getCode() { return code; }
    public String getCanonicalName() { return canonicalName; }
    public String getCountryCode() { return countryCode; }
}

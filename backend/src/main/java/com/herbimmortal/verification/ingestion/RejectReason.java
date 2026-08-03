package com.herbimmortal.verification.ingestion;

/**
 * Why a source row could not become a registry_record.
 *
 * The split that matters: these are HARD failures only, meaning the row cannot
 * be keyed or matched at all. Soft data quality problems (an unparseable date,
 * an unreadable status) do NOT reject the row. They are stored as NULL beside
 * the preserved raw string, because a practitioner whose registry row has a
 * malformed expiry date still needs to be findable.
 */
public enum RejectReason {

    /** No alphanumeric characters in the licence column. Nothing to key on. */
    MISSING_LICENSE_NUMBER,

    /** Name normalized to empty, for example a cell containing only "Dr.". */
    MISSING_NAME,

    /** Council cell blank. Half the natural key is absent. */
    MISSING_COUNCIL,

    /**
     * Council text present but not in council_aliases. Deliberately a reject
     * rather than a guess: an invented council code silently corrupts the
     * natural key, and the fix is one INSERT into council_aliases plus a re-run.
     */
    UNKNOWN_COUNCIL,

    /** Row had fewer columns than the header. Usually a broken quote upstream. */
    MALFORMED_ROW
}

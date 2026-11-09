package com.herbimmortal.verification.partner;

/** Validation errors name the field, never echo user input or credentials. */
final class PartnerValidation {
    private PartnerValidation() { }

    static String text(String value, String field, int max) {
        if (value == null || value.isBlank() || value.trim().length() > max) {
            throw new IllegalArgumentException("Invalid " + field + ".");
        }
        if (java.util.regex.Pattern.compile("hi_(?:live|test)_[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)?")
                .matcher(value).find()) {
            throw new IllegalArgumentException("Credentials cannot be used as " + field + ".");
        }
        return value.trim();
    }
}

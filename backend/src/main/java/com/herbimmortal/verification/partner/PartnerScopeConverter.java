package com.herbimmortal.verification.partner;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class PartnerScopeConverter implements AttributeConverter<PartnerTypes.Scope, String> {
    @Override
    public String convertToDatabaseColumn(PartnerTypes.Scope value) {
        return value == null ? null : value.value();
    }

    @Override
    public PartnerTypes.Scope convertToEntityAttribute(String value) {
        return value == null ? null : PartnerTypes.Scope.fromValue(value);
    }
}

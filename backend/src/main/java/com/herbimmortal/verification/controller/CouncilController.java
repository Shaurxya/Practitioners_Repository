package com.herbimmortal.verification.controller;

import com.herbimmortal.verification.repository.CouncilRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Public reference data, no auth.
 *
 * The claim form needs it before anyone has an account, and the list is not
 * sensitive: it is the set of bodies whose registers we hold, which the public
 * verify page already prints.
 */
@RestController
public class CouncilController {

    private final CouncilRepository councils;

    public CouncilController(CouncilRepository councils) {
        this.councils = councils;
    }

    public record CouncilView(String code, String canonicalName) {
    }

    @GetMapping({"/api/v1/councils", "/api/v1/admin/councils"})
    public List<CouncilView> list() {
        return councils.findAllByOrderByCanonicalNameAsc().stream()
                .map(c -> new CouncilView(c.getCode(), c.getCanonicalName()))
                .toList();
    }
}

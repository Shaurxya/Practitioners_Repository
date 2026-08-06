"""
Tests for the extraction service.

The PDF dependent tests run against a real council register when one is present
and skip otherwise, because a 1.1 MB register of real practitioners with their
home addresses must never be committed to this repository. Everything that can
be tested without a document is tested without one, which is most of it: the
bugs in this service live in cleaning and in the anomaly rules, not in
pdfplumber.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.classify import UNREADABLE_CHAR_FLOOR, page_anomaly  # noqa: E402
from app.clean import clean_cell, clean_row_text, declared_row_count  # noqa: E402
from app.extract import _build_row, _looks_like_header  # noqa: E402
from app.schema import Anomaly, Classification  # noqa: E402

REGISTER = os.getenv(
    "TEST_REGISTER_PDF",
    str(Path.home() / "Desktop" / "Goa (Provisional National Register).pdf"),
)
has_register = pytest.mark.skipif(
    not os.path.isfile(REGISTER), reason="no council register available locally"
)


class TestCleaning:
    def test_strips_unmapped_glyphs(self):
        # pdfplumber emits (cid:NN) for a glyph with no ToUnicode mapping. This
        # register is full of (cid:13), and left in place they land in the
        # middle of extracted names.
        assert clean_cell("Sl(cid:13) No.") == "Sl No."
        assert clean_cell("PRABHUDESSAI(cid:13)VINAYAK") == "PRABHUDESSAI VINAYAK"

    def test_removes_invisible_characters(self):
        # Invisible on the page, and each one breaks an exact licence match.
        assert clean_cell("NR/AY/GA/​0000001") == "NR/AY/GA/0000001"

    def test_normalises_punctuation_a_keyboard_cannot_type(self):
        assert clean_cell("Father’s name") == "Father's name"
        assert clean_cell("MH–2840") == "MH-2840"

    def test_distinguishes_empty_from_artefact_only(self):
        # A document that omits a field and an extraction that failed are
        # different facts, and only the second should count against accuracy.
        assert clean_cell("") is None
        assert clean_cell("   ") is None
        assert clean_cell("(cid:13)") is None
        assert clean_cell(None) is None

    def test_row_text_survives_missing_cells(self):
        assert clean_row_text(["1", None, "ANITA"]) == "1      ANITA"

    def test_reads_a_declared_total_when_the_document_states_one(self):
        assert declared_row_count("This register contains 12,480 practitioners") == 12480
        assert declared_row_count("Total: 781 entries") == 781
        assert declared_row_count("no claim about totals here") is None


class TestAnomalies:
    def test_a_page_yielding_nothing_is_flagged(self):
        assert page_anomaly(Classification.TEXT_LAYER, 0, 0, 40.0, None) is Anomaly.ZERO_ROWS

    def test_low_row_count_is_relative_to_the_document_not_absolute(self):
        # A register with 8 rows a page and one with 60 are both normal, and
        # only the document can say which it is.
        assert page_anomaly(Classification.TEXT_LAYER, 8, 0, 9.0, None) is None
        assert page_anomaly(Classification.TEXT_LAYER, 8, 0, 60.0, None) is Anomaly.LOW_ROW_COUNT

    def test_low_ocr_confidence_is_flagged_even_when_rows_came_out(self):
        assert (
            page_anomaly(Classification.SCANNED, 40, 0, 40.0, 0.62)
            is Anomaly.LOW_OCR_CONFIDENCE
        )

    def test_an_unreadable_page_reports_no_table_rather_than_zero_rows(self):
        assert page_anomaly(Classification.UNREADABLE, 0, 0, 40.0, None) is Anomaly.NO_TABLE_FOUND


class TestRowBuilding:
    COLUMNS = {1: "licenseNo", 2: "fullName"}

    def test_header_rows_are_dropped_per_page(self):
        # The header repeats on every page of a paginated register, so it has to
        # be dropped per page rather than once for the document.
        assert _looks_like_header(["Sl No.", "National Registration Number", "Name"], self.COLUMNS)
        assert not _looks_like_header(["1", "NR/AY/GA/0000001", "PRABHUDESSAI"], self.COLUMNS)

    def test_text_layer_cells_carry_full_confidence(self):
        row = _build_row(1, 0, ["1", "NR/AY/GA/0000001", "PRABHUDESSAI"], self.COLUMNS, 1.0)
        assert row.cells["licenseNo"].raw == "NR/AY/GA/0000001"
        assert row.cells["licenseNo"].confidence == 1.0
        assert row.license_confidence == 1.0

    def test_row_confidence_is_the_worst_cell_not_the_average(self):
        # Averaging hides the one bad cell, which is the only one that matters.
        row = _build_row(1, 0, ["1", "NR/AY/GA/0000001", "ANITA"], self.COLUMNS, 0.61)
        assert row.row_confidence == 0.61

    def test_an_absent_cell_scores_nothing_rather_than_zero(self):
        row = _build_row(1, 0, ["1", None, "ANITA"], self.COLUMNS, 1.0)
        assert row.cells["licenseNo"].raw is None
        assert row.cells["licenseNo"].confidence is None


@has_register
class TestAgainstARealRegister:
    """End to end against an actual council register, when one is present."""

    def test_classifies_a_digital_register_as_text_layer(self):
        from app.classify import classify_document

        pages = classify_document(REGISTER)
        assert len(pages) > 1
        assert all(p.classification is Classification.TEXT_LAYER for p in pages)

    def test_extracts_every_row_with_a_well_formed_licence_number(self):
        from app.extract import extract
        from app.schema import ExtractRequest

        result = extract(
            ExtractRequest(
                batch_id="test",
                source_path=REGISTER,
                column_map={1: "licenseNo", 2: "fullName", 6: "qualification"},
            )
        )

        licences = [
            r.cells["licenseNo"].raw for r in result.rows if r.cells["licenseNo"].raw is not None
        ]
        assert len(licences) == len(result.rows), "every row must carry a licence number"
        assert len(set(licences)) == len(licences), "licence numbers must be unique"
        assert all(re.fullmatch(r"NR/AY/GA/\d{7}", lic) for lic in licences)
        assert result.rejects == []

    def test_does_not_emit_the_repeated_header_as_a_row(self):
        from app.extract import extract
        from app.schema import ExtractRequest

        result = extract(
            ExtractRequest(
                batch_id="test",
                source_path=REGISTER,
                column_map={1: "licenseNo", 2: "fullName"},
                pages=[1, 2, 3],
            )
        )
        names = [r.cells["fullName"].raw for r in result.rows]
        assert not any(n and "BLOCK" in n for n in names)


class TestOcrIsolation:
    def test_the_service_reports_whether_ocr_can_actually_run(self):
        from app import ocr

        # Truthful either way. A sidecar answering 200 while unable to read a
        # scanned page is the green light that costs an overnight run.
        assert isinstance(ocr.available(), bool)

    def test_a_scanned_page_fails_loudly_when_paddle_is_absent(self):
        from app import ocr

        if ocr.available():
            pytest.skip("paddle is installed here, so there is nothing to fail")
        with pytest.raises(ocr.OcrUnavailable):
            ocr.engine()

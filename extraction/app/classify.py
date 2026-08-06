"""
Page classification: is there a text layer, or does this page need OCR.

Runs as its own cheap pass before extraction, and per page rather than per
document. Hybrid registers are normal, a text layer cover with a scanned body,
or scans inserted into a digital file. Classifying once for the document loses
half the register quietly.

The decision is character density, not raw character count. A count alone
misjudges both ends: a sparse A3 index page looks like a scan, and a scanned
page carrying a text watermark looks like a text layer.
"""

from __future__ import annotations

import pdfplumber

from .schema import Anomaly, Classification, PageReport, TableMode

#: Characters per 1000 square points. A page under this has too little text to
#: be the source of its own content. Derived from the registers to hand: text
#: layer pages measure 2.4 to 4.4, and a scan with a watermark measures under
#: 0.1, so the threshold sits an order of magnitude clear of both.
DEFAULT_DENSITY_THRESHOLD = 0.35

#: Below this there is nothing to work with at all, OCR included: a blank page,
#: or an image so degraded no text survived. Distinguished from SCANNED because
#: they need different actions, and because "we tried and got nothing" is a
#: different report from "we have not tried yet".
UNREADABLE_CHAR_FLOOR = 12


def classify_page(page: pdfplumber.page.Page, threshold: float) -> tuple[Classification, int, float]:
    text = page.extract_text() or ""
    char_count = len(text.strip())
    area = float(page.width) * float(page.height)
    density = (char_count / area * 1000) if area else 0.0

    if density >= threshold:
        return Classification.TEXT_LAYER, char_count, density

    # No usable text layer. Whether OCR can help depends on whether there is an
    # image to read: a page with neither text nor image is unreadable, and
    # sending it to OCR only wastes the run.
    has_image = bool(page.images)
    if char_count < UNREADABLE_CHAR_FLOOR and not has_image:
        return Classification.UNREADABLE, char_count, density

    return Classification.SCANNED, char_count, density


def page_anomaly(
    classification: Classification,
    rows_extracted: int,
    rotation: int,
    mean_rows_per_page: float,
    mean_ocr_confidence: float | None,
) -> Anomaly | None:
    """
    One flag per page, worst first.

    LOW_ROW_COUNT is measured against the document's own average, never an
    absolute threshold. A register with 8 rows a page and one with 60 are both
    normal, and only the document can say which it is. This is the check that
    catches the last fifty pages of a register yielding nothing while every row
    that did extract looks perfect.
    """
    if classification is Classification.UNREADABLE:
        return Anomaly.NO_TABLE_FOUND
    if rows_extracted == 0:
        return Anomaly.ZERO_ROWS
    if mean_rows_per_page > 0 and rows_extracted < mean_rows_per_page * 0.5:
        return Anomaly.LOW_ROW_COUNT
    if mean_ocr_confidence is not None and mean_ocr_confidence < 0.80:
        return Anomaly.LOW_OCR_CONFIDENCE
    if rotation % 360 != 0:
        return Anomaly.ROTATED
    return None


def classify_document(path: str, threshold: float = DEFAULT_DENSITY_THRESHOLD) -> list[PageReport]:
    reports: list[PageReport] = []

    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            classification, char_count, _density = classify_page(page, threshold)
            rotation = int(page.rotation or 0)
            reports.append(
                PageReport(
                    page_number=index,
                    classification=classification,
                    char_count=char_count,
                    rotation_degrees=rotation,
                    table_mode_used=None,
                    rows_extracted=0,
                    mean_ocr_confidence=None,
                    anomaly_code=Anomaly.ROTATED if rotation % 360 else None,
                )
            )

    return reports

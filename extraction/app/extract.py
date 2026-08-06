"""
Extraction: classify each page, then read it the way its classification says.

The column map arrives from Spring, confirmed by an admin against this exact
register. This service never guesses which column is the licence number, and it
never learns a council. It splits a table into cells and reports how sure it is.
"""

from __future__ import annotations

import logging

import pdfplumber

from . import ocr
from .classify import DEFAULT_DENSITY_THRESHOLD, classify_page, page_anomaly
from .clean import clean_cell, clean_row_text, declared_row_count
from .schema import (
    Anomaly,
    Cell,
    Classification,
    ExtractRequest,
    ExtractResponse,
    PageReport,
    Row,
    TableMode,
)

logger = logging.getLogger(__name__)

#: Table settings for the two strategies. Lattice reads ruled tables from their
#: own lines; stream infers columns from whitespace alignment. AUTO tries
#: lattice and falls back, and reports which one actually ran, which matters
#: while a profile is being tuned and is a liability once it is trusted.
LATTICE = {"vertical_strategy": "lines", "horizontal_strategy": "lines"}
STREAM = {"vertical_strategy": "text", "horizontal_strategy": "text"}


def _table_settings(mode: TableMode) -> dict:
    return LATTICE if mode is TableMode.LATTICE else STREAM


def _extract_tables(page: pdfplumber.page.Page, mode: TableMode) -> tuple[list[list], TableMode | None]:
    if mode is not TableMode.AUTO:
        tables = page.extract_tables(_table_settings(mode)) or []
        return tables, (mode if tables else None)

    tables = page.extract_tables(LATTICE) or []
    if tables:
        return tables, TableMode.LATTICE

    tables = page.extract_tables(STREAM) or []
    return tables, (TableMode.STREAM if tables else None)


def _looks_like_header(cells: list[str | None], column_map: dict[int, str]) -> bool:
    """
    A header row repeats on every page of a paginated register, so it has to be
    dropped per page rather than once for the document. Detected by the licence
    column carrying no digits: every real licence number has some.
    """
    for index, field in column_map.items():
        if field != "licenseNo":
            continue
        value = cells[index] if index < len(cells) else None
        return not any(ch.isdigit() for ch in (value or ""))
    return False


def _build_row(
    page_number: int,
    row_index: int,
    cells: list[str | None],
    column_map: dict[int, str],
    confidence: float,
) -> Row:
    mapped: dict[str, Cell] = {}
    for index, field in column_map.items():
        raw = clean_cell(cells[index]) if index < len(cells) else None
        mapped[field] = Cell(raw=raw, confidence=confidence if raw is not None else None)

    licence = mapped.get("licenseNo")
    licence_confidence = licence.confidence if licence else None

    scored = [c.confidence for c in mapped.values() if c.confidence is not None]
    row_confidence = min(scored) if scored else confidence

    return Row(
        source_page=page_number,
        source_row_index=row_index,
        raw_row_text=clean_row_text(cells),
        cells=mapped,
        row_confidence=round(row_confidence, 3),
        license_confidence=round(licence_confidence, 3) if licence_confidence is not None else None,
    )


def extract(request: ExtractRequest) -> ExtractResponse:
    rows: list[Row] = []
    rejects: list[dict] = []
    reports: list[PageReport] = []
    declared: int | None = None

    with pdfplumber.open(request.source_path) as pdf:
        page_count = len(pdf.pages)
        wanted = set(request.pages) if request.pages else None

        for page_number, page in enumerate(pdf.pages, start=1):
            if wanted and page_number not in wanted:
                continue

            classification, char_count, _ = classify_page(page, request.text_density_threshold)
            rotation = int(page.rotation or 0)
            page_rows: list[Row] = []
            mean_ocr: float | None = None
            mode_used: TableMode | None = None

            if declared is None:
                declared = declared_row_count(page.extract_text() or "")

            if classification is Classification.TEXT_LAYER:
                # The characters are in the file. Nothing is being guessed, so
                # confidence is 1.0 and any doubt downstream is about the column
                # mapping rather than about the reading.
                tables, mode_used = _extract_tables(page, request.table_mode)
                for table in tables:
                    for line in table:
                        if _looks_like_header(line, request.column_map):
                            continue
                        row = _build_row(
                            page_number, len(page_rows), line, request.column_map, 1.0
                        )
                        if row.cells and any(c.raw for c in row.cells.values()):
                            page_rows.append(row)

            elif classification is Classification.SCANNED:
                try:
                    image = page.to_image(resolution=300).original
                    lines, mean_ocr = ocr.read_page(image)
                except ocr.OcrUnavailable as exc:
                    rejects.append(
                        {
                            "source_page": page_number,
                            "reason_code": "OCR_UNAVAILABLE",
                            "reason_detail": str(exc),
                        }
                    )
                    lines = []
                else:
                    # One recognised line is one row. Column geometry from OCR
                    # boxes is a separate problem and a worse one to get subtly
                    # wrong, so a scanned row carries its text and its
                    # confidence and a person maps it.
                    for offset, (text, confidence) in enumerate(lines):
                        cleaned = clean_cell(text)
                        if not cleaned:
                            continue
                        page_rows.append(
                            Row(
                                source_page=page_number,
                                source_row_index=offset,
                                raw_row_text=cleaned,
                                cells={},
                                row_confidence=round(confidence, 3),
                                license_confidence=None,
                            )
                        )

            rows.extend(page_rows)
            reports.append(
                PageReport(
                    page_number=page_number,
                    classification=classification,
                    char_count=char_count,
                    rotation_degrees=rotation,
                    table_mode_used=mode_used,
                    rows_extracted=len(page_rows),
                    mean_ocr_confidence=round(mean_ocr, 3) if mean_ocr is not None else None,
                    anomaly_code=None,
                )
            )

    # Anomalies last, because LOW_ROW_COUNT is relative to the document's own
    # average and that is not known until every page has been read.
    processed = [r for r in reports if r.rows_extracted or r.classification is not Classification.UNREADABLE]
    mean_rows = (sum(r.rows_extracted for r in processed) / len(processed)) if processed else 0.0
    for report in reports:
        report.anomaly_code = page_anomaly(
            report.classification,
            report.rows_extracted,
            report.rotation_degrees,
            mean_rows,
            report.mean_ocr_confidence,
        )

    return ExtractResponse(
        batch_id=request.batch_id,
        page_count=page_count,
        pages=reports,
        rows=rows,
        rejects=rejects,
        declared_row_count=declared,
    )

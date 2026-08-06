"""
Wire contract between Spring and this service.

The shapes mirror V3__registry_import.sql deliberately: import_page for the
per page telemetry, registry_staging_record for the rows. Spring persists what
comes back with no reshaping, which is what keeps the two sides from drifting.

Note what is NOT in here: no council, no licence regex, no status vocabulary, no
date convention. Every one of those arrives in the request as part of the
profile. This service carries algorithms only. Two copies of a status vocabulary
would drift, and a drifted vocabulary maps ACTIVE rows to UNKNOWN with no error
anywhere.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class Wire(BaseModel):
    """
    camelCase on the wire, snake_case in Python.

    Not cosmetic. Java records serialize their field names as written, and Java
    field names are camelCase, so a snake_case schema here rejects every request
    Spring sends with a 422 that names a field the caller never heard of. The
    rest of the system, including the React client, is camelCase throughout;
    this service is the odd one out and so it is the one that adapts.

    populate_by_name keeps the snake_case names working too, so the tests and a
    curl by hand read naturally.
    """

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Classification(str, Enum):
    TEXT_LAYER = "TEXT_LAYER"
    SCANNED = "SCANNED"
    UNREADABLE = "UNREADABLE"


class Anomaly(str, Enum):
    ZERO_ROWS = "ZERO_ROWS"
    LOW_ROW_COUNT = "LOW_ROW_COUNT"
    LOW_OCR_CONFIDENCE = "LOW_OCR_CONFIDENCE"
    COLUMN_DRIFT = "COLUMN_DRIFT"
    NO_TABLE_FOUND = "NO_TABLE_FOUND"
    ROTATED = "ROTATED"


class TableMode(str, Enum):
    LATTICE = "LATTICE"
    STREAM = "STREAM"
    AUTO = "AUTO"


class ExtractRequest(Wire):
    """What Spring sends. The profile travels with the request, never cached here."""

    batch_id: str
    #: Where the PDF is. A local path in development, an object storage key once
    #: MinIO is wired. Kept a plain string so this service never learns S3.
    source_path: str
    table_mode: TableMode = TableMode.AUTO
    #: Column index to canonical field, exactly as the admin confirmed it.
    column_map: dict[int, str] = Field(default_factory=dict)
    #: Below this a page is a scan rather than a text layer. Characters per
    #: 1000 square points, tuned in classify.py.
    text_density_threshold: float = 0.35
    #: Pages to process, 1 based. Empty means all of them.
    pages: list[int] = Field(default_factory=list)


class Cell(Wire):
    raw: str | None
    #: 1.0 on a text layer page: the characters are in the file, not guessed.
    #: OCR confidence on a scanned one. None when the column was not mapped.
    confidence: float | None


class Row(Wire):
    source_page: int
    source_row_index: int
    #: The whole row before column splitting. When a reviewer disagrees with a
    #: parsed field this is what they read, and it is the only way to tell a bad
    #: OCR from a bad column mapping.
    raw_row_text: str
    cells: dict[str, Cell]
    row_confidence: float
    license_confidence: float | None


class PageReport(Wire):
    page_number: int
    classification: Classification
    char_count: int
    rotation_degrees: int
    table_mode_used: TableMode | None
    rows_extracted: int
    mean_ocr_confidence: float | None
    anomaly_code: Anomaly | None


class ExtractResponse(Wire):
    batch_id: str
    page_count: int
    pages: list[PageReport]
    rows: list[Row]
    #: Rows that could not be keyed at all, with why. Never silently dropped.
    rejects: list[dict]
    #: What the document says about itself, when it says anything. The gap
    #: against len(rows) is what catches silent partial extraction.
    declared_row_count: int | None


class ClassifyResponse(Wire):
    batch_id: str
    page_count: int
    text_layer_pages: int
    scanned_pages: int
    unreadable_pages: int
    rotated_pages: int
    pages: list[PageReport]


class DetectedColumn(Wire):
    index: int
    header_text: str
    #: A few cells from this column, so a header reading "Reg." can be identified.
    sample_values: list[str]
    #: What this service proposes. Never applied without a human confirming it.
    proposed_field: str | None
    proposal_confidence: float


class DetectResponse(Wire):
    page_number: int
    table_mode_used: TableMode | None
    detected_columns: list[DetectedColumn]

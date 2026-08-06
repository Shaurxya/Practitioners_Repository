"""
Column detection: what does this document's table look like.

Feeds the mapping screen. The proposal is a suggestion read off the header text
and the sample values, never a decision: a mismapped column is the worst failure
this pipeline has because it does not look like a failure. Every row parses,
every confidence is high, and the specialty column quietly becomes the licence
number for the whole register.
"""

from __future__ import annotations

import re

import pdfplumber

from .clean import clean_cell
from .schema import DetectedColumn, DetectResponse, TableMode
from .extract import LATTICE, STREAM

#: Header text to canonical field, first match wins, so order is the rule.
#:
#: Three of these map to None deliberately. A composite "Registration
#: particulars" cell contains the words "Registration number" and would
#: otherwise be proposed as the licence column, which is the exact silent
#: mismapping the confirmation step exists to catch. Father's name and address
#: are matched only so they are positively identified as columns we do not want,
#: rather than falling through to a name guess.
HEADER_PATTERNS: list[tuple[str, str | None, float]] = [
    # Composite and unwanted columns first: they contain words the field
    # patterns below would otherwise claim.
    (r"particular", None, 0.0),
    (r"father|guardian|spouse", None, 0.0),
    (r"address|correspondence", None, 0.0),
    (r"^sl|^s\.?\s*no|serial", None, 0.0),

    (r"nationa\w*\s*regist\w*\s*(no|num)", "licenseNo", 0.97),

    # Before any name pattern: "Name of medical degree" is a qualification, and
    # a bare ^name\b would take it.
    (r"qualification|degree|diploma", "qualification", 0.88),

    (r"name\s*of\s*(the\s*)?(professional|practitioner|doctor)", "fullName", 0.95),
    (r"^reg\w*\.?\s*(no|num)", "licenseNo", 0.96),
    (r"regist\w*\s*(no|num)", "licenseNo", 0.90),
    (r"council|board(?!\s*of\s*stud)", "council", 0.85),
    (r"valid|expiry|expire|upto|up\s*to", "validUntil", 0.90),
    (r"status|standing", "status", 0.93),
    (r"special|system|discipline", "specialty", 0.60),
    (r"date\s*of\s*regist|regist\w*\s*date", "registrationDate", 0.86),
    (r"^name\b", "fullName", 0.88),
]

#: Value shaped hints, used when the header says nothing useful. A column of
#: ACTIVE / SUSPENDED is a status whatever it is called.
STATUS_WORDS = {"ACTIVE", "SUSPENDED", "REVOKED", "EXPIRED", "INACTIVE", "CANCELLED", "REMOVED"}
DATE = re.compile(r"^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$")
LICENCE = re.compile(r"^[A-Z/\-]{0,12}\d{3,}")


def _from_header(header: str) -> tuple[str | None, float, bool]:
    """Returns the proposal plus whether the header was recognised at all."""
    text = (header or "").lower().replace("\n", " ")
    for pattern, field, confidence in HEADER_PATTERNS:
        if re.search(pattern, text):
            return field, confidence, True
    return None, 0.0, False


def _from_values(samples: list[str]) -> tuple[str | None, float]:
    values = [s.strip().upper() for s in samples if s and s.strip()]
    if not values:
        return None, 0.0
    if sum(v in STATUS_WORDS for v in values) / len(values) > 0.5:
        return "status", 0.70
    if sum(bool(DATE.match(v)) for v in values) / len(values) > 0.5:
        return "validUntil", 0.55
    if sum(bool(LICENCE.match(v)) for v in values) / len(values) > 0.7:
        return "licenseNo", 0.65
    return None, 0.0


def detect(source_path: str, sample_rows: int = 3) -> DetectResponse:
    with pdfplumber.open(source_path) as pdf:
        for page in pdf.pages:
            for settings, mode in ((LATTICE, TableMode.LATTICE), (STREAM, TableMode.STREAM)):
                tables = page.extract_tables(settings) or []
                if not tables or len(tables[0]) < 2:
                    continue

                table = tables[0]
                header = [clean_cell(c) or "" for c in table[0]]
                columns: list[DetectedColumn] = []

                for index, head in enumerate(header):
                    samples = [
                        clean_cell(row[index]) or ""
                        for row in table[1 : 1 + sample_rows]
                        if index < len(row)
                    ]
                    field, confidence, recognised = _from_header(head)
                    if not recognised:
                        # The header told us nothing. The values might.
                        field, confidence = _from_values(samples)

                    columns.append(
                        DetectedColumn(
                            index=index,
                            header_text=head,
                            sample_values=[s for s in samples if s],
                            proposed_field=field,
                            proposal_confidence=round(confidence, 2),
                        )
                    )

                return DetectResponse(
                    page_number=page.page_number,
                    table_mode_used=mode,
                    detected_columns=columns,
                )

    return DetectResponse(page_number=0, table_mode_used=None, detected_columns=[])

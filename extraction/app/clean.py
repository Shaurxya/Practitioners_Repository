"""
Text cleaning, applied to every extracted cell before it leaves this service.

Cleaning is not normalization. Normalization is the Java Normalizer's job and
produces the values the matcher keys on. This only removes artefacts of the
extraction itself: glyphs the PDF could not map, line breaks inside a table
cell, doubled spaces. If a cleaning rule here ever changes what a human would
read on the page, it is the wrong rule.
"""

from __future__ import annotations

import re

#: pdfplumber emits (cid:NN) for a glyph with no usable ToUnicode mapping. In
#: this register they are almost all (cid:13), a carriage return inside a header
#: cell. Left in place they end up in the middle of extracted names.
CID = re.compile(r"\(cid:\d+\)")

#: Soft hyphen, zero width space, zero width non joiner, BOM. Invisible on the
#: page, and each one breaks an exact licence number match.
INVISIBLE = re.compile(r"[­​‌‍﻿]")

WHITESPACE = re.compile(r"\s+")

#: Unicode punctuation that a register prints and a keyboard does not, so a
#: claim typed by a practitioner never matches the extracted form.
PUNCTUATION = {
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "–": "-",
    "—": "-",
    "−": "-",
    " ": " ",
}


def clean_cell(value: str | None) -> str | None:
    """
    Returns None for a cell that held nothing but artefacts.

    Distinguishing "empty" from "whitespace and a stray glyph" matters: the
    first is a document that omits a field, the second is an extraction that
    failed, and only the second should count against accuracy.
    """
    if value is None:
        return None

    text = CID.sub(" ", value)
    text = INVISIBLE.sub("", text)
    for source, target in PUNCTUATION.items():
        text = text.replace(source, target)
    text = WHITESPACE.sub(" ", text).strip()

    return text or None


def clean_row_text(cells: list[str | None]) -> str:
    """The row as one line, for a reviewer comparing against the source page."""
    return "   ".join(clean_cell(c) or "" for c in cells).strip()


DECLARED_ROWS = re.compile(
    r"(?:total|contains?|comprising)\D{0,20}([\d,]{2,})\s*(?:practitioners?|entries|records?|names?)",
    re.IGNORECASE,
)


def declared_row_count(text: str) -> int | None:
    """
    What the document says about itself, when it says anything.

    The gap between this and the rows actually extracted is the single most
    valuable number in the report: silent partial extraction looks perfect row
    by row and is the failure that causes mass revocation on the next
    re-verification run.
    """
    match = DECLARED_ROWS.search(text)
    if not match:
        return None
    try:
        return int(match.group(1).replace(",", ""))
    except ValueError:
        return None

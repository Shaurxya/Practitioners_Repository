"""
The extraction sidecar.

Binds to loopback in development and is never published in docker compose. That
is layer 1 of the access control described in RequireAdmin: this service takes a
file path and returns registry rows, it has no authentication of its own, and it
must not be reachable from anywhere except Spring.
"""

from __future__ import annotations

import logging
import os
import time

from fastapi import FastAPI, HTTPException

from . import ocr
from .classify import DEFAULT_DENSITY_THRESHOLD, classify_document
from .schema import ClassifyResponse, ExtractRequest, ExtractResponse, Classification, Wire
from .detect import detect as run_detect
from .extract import extract as run_extract
from .schema import DetectResponse

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

app = FastAPI(title="HerbImmortal extraction", version="1")


class ClassifyRequest(Wire):
    batch_id: str
    source_path: str
    text_density_threshold: float = DEFAULT_DENSITY_THRESHOLD


@app.get("/health")
def health() -> dict:
    """
    Reports whether OCR is actually available, not just whether the process is
    up. A sidecar that answers 200 while being unable to read a scanned page is
    the kind of green light that costs a whole overnight run.
    """
    return {
        "status": "UP",
        "ocr": "AVAILABLE" if ocr.available() else "UNAVAILABLE",
        "textLayer": "AVAILABLE",
    }


def _guard(path: str) -> None:
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail=f"No file at {path}")


@app.post("/v1/classify", response_model=ClassifyResponse)
def classify(request: ClassifyRequest) -> ClassifyResponse:
    """
    The cheap pass. Runs before extraction so an admin learns a register came
    back fully scanned before waiting out a 400 page OCR run, not after.
    """
    _guard(request.source_path)
    started = time.monotonic()

    try:
        pages = classify_document(request.source_path, request.text_density_threshold)
    except Exception as exc:
        logger.exception("classification failed for %s", request.batch_id)
        raise HTTPException(status_code=422, detail=f"Could not read the PDF: {exc}") from exc

    logger.info(
        "classified batch=%s pages=%d in %.2fs",
        request.batch_id,
        len(pages),
        time.monotonic() - started,
    )

    return ClassifyResponse(
        batch_id=request.batch_id,
        page_count=len(pages),
        text_layer_pages=sum(p.classification is Classification.TEXT_LAYER for p in pages),
        scanned_pages=sum(p.classification is Classification.SCANNED for p in pages),
        unreadable_pages=sum(p.classification is Classification.UNREADABLE for p in pages),
        rotated_pages=sum(p.rotation_degrees % 360 != 0 for p in pages),
        pages=pages,
    )


@app.post("/v1/detect-columns", response_model=DetectResponse)
def detect_columns(request: ClassifyRequest) -> DetectResponse:
    """
    Reads the first table it finds and describes its columns.

    Nothing is parsed from this: it exists so a human can confirm which column
    is which before a single row is extracted.
    """
    _guard(request.source_path)
    try:
        return run_detect(request.source_path)
    except Exception as exc:
        logger.exception("column detection failed for %s", request.batch_id)
        raise HTTPException(status_code=422, detail=f"Could not read the table: {exc}") from exc


@app.post("/v1/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest) -> ExtractResponse:
    _guard(request.source_path)
    started = time.monotonic()

    try:
        response = run_extract(request)
    except Exception as exc:
        logger.exception("extraction failed for %s", request.batch_id)
        raise HTTPException(status_code=422, detail=f"Extraction failed: {exc}") from exc

    logger.info(
        "extracted batch=%s pages=%d rows=%d in %.2fs",
        request.batch_id,
        response.page_count,
        len(response.rows),
        time.monotonic() - started,
    )
    return response

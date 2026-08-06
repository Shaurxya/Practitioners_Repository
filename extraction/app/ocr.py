"""
PaddleOCR, wrapped so that nothing else in this service imports it.

Two reasons for the wrapper. The model is hundreds of megabytes and takes
seconds to load, so it is built once and reused for the life of the process
rather than per page. And paddle is the one dependency that will not install
everywhere: it publishes no wheel for Python 3.13 or 3.14, so a developer on a
current Python can still run and test the text layer path, which is most
registers, and gets a precise error rather than an import crash on a scanned
one.
"""

from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)

_engine = None
_lock = threading.Lock()


class OcrUnavailable(RuntimeError):
    """Raised when a scanned page needs OCR and paddle is not installed."""


def available() -> bool:
    try:
        import paddleocr  # noqa: F401
    except Exception:
        return False
    return True


def engine():
    """
    Loaded once, behind a lock.

    Without the lock two requests arriving together each build a model, which on
    a container sized for one is how the service gets OOM killed under exactly
    the load it was meant to handle.
    """
    global _engine
    if _engine is not None:
        return _engine

    with _lock:
        if _engine is not None:
            return _engine
        try:
            from paddleocr import PaddleOCR
        except Exception as exc:  # pragma: no cover - depends on the image
            raise OcrUnavailable(
                "PaddleOCR is not installed in this environment. Scanned pages "
                "cannot be read. Run the containerised service, which pins "
                "Python 3.11."
            ) from exc

        logger.info("loading PaddleOCR, first call only")
        _engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        return _engine


def read_page(image) -> tuple[list[tuple[str, float]], float | None]:
    """
    Returns every recognised line with its confidence, plus the page mean.

    Confidence is kept per line rather than averaged away, because the number
    that matters downstream is the confidence of the licence number cell, not of
    the page it happened to sit on.
    """
    result = engine().ocr(image, cls=True)
    if not result or not result[0]:
        return [], None

    lines: list[tuple[str, float]] = []
    for entry in result[0]:
        text, confidence = entry[1]
        lines.append((text, float(confidence)))

    mean = sum(c for _, c in lines) / len(lines) if lines else None
    return lines, mean

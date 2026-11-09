"""Exercise the OCR wrapper with a fake Paddle engine and no model downloads."""
import sys
from types import SimpleNamespace

import pytest
from app import ocr


def test_engine_is_created_once_and_reused(monkeypatch):
    calls = []
    fake = object()

    def create(**kwargs):
        calls.append(kwargs)
        return fake

    monkeypatch.setattr(ocr, "_engine", None)
    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCR=create))
    assert ocr.available() is True
    assert ocr.engine() is fake
    assert ocr.engine() is fake
    assert len(calls) == 1


def test_missing_ocr_package_fails_without_an_environment_dependent_skip(monkeypatch):
    monkeypatch.setattr(ocr, "_engine", None)
    monkeypatch.setitem(sys.modules, "paddleocr", None)
    assert ocr.available() is False
    with pytest.raises(ocr.OcrUnavailable):
        ocr.engine()

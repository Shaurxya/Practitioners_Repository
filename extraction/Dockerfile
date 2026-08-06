# Python 3.11, pinned deliberately.
#
# paddlepaddle publishes no wheel for 3.13 or 3.14, so the version is not a
# preference: building on a current Python fails at pip install. Pinning it here
# is also what lets a developer run the text layer path on whatever Python they
# have, because that path never imports paddle.
FROM python:3.11-slim

# libgl and libglib are OpenCV's runtime, which paddleocr pulls in. Without
# them the import succeeds and the first OCR call fails, which is the worst
# order for a dependency to break in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 libglib2.0-0 poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements-ocr.txt

COPY app ./app

# Model weights download on first use, which would make the first real request
# pay for it. Warmed at build time so a cold container is not several hundred
# megabytes away from answering.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=True, lang='en')" || true

# Non root. This process reads council registers containing personal data and
# has no reason to own anything on the filesystem.
RUN useradd --create-home --uid 10001 extractor && chown -R extractor /srv
USER extractor

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

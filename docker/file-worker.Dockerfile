# syntax=docker/dockerfile:1.7
FROM --platform=linux/amd64 python:3.12.13-slim-bookworm@sha256:d50fb7611f86d04a3b0471b46d7557818d88983fc3136726336b2a4c657aa30b

ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="VHB isolated file worker" \
      org.opencontainers.image.source="https://github.com/tkkpmk-netizen/VHB-Group-Webapp" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="1.0.0"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/opt

RUN useradd --uid 65532 --no-create-home --shell /usr/sbin/nologin fileworker

# Calc is the production-like T2 PDF renderer. Fonts are installed explicitly
# so Vietnamese glyph availability does not depend on the host OS.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        fonts-liberation \
        fonts-noto-core \
        libreoffice-calc \
    && rm -rf /var/lib/apt/lists/*

COPY docker/file-worker-requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes --requirement /tmp/requirements.txt \
    && rm /tmp/requirements.txt

COPY backend/app/__init__.py /opt/app/__init__.py
COPY backend/app/file_worker /opt/app/file_worker

USER 65532:65532
WORKDIR /work
ENTRYPOINT ["python", "-m", "app.file_worker.runtime"]

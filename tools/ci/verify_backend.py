#!/usr/bin/env python3
"""Reproduce backend CI using disposable PostgreSQL 16 and MinIO, never the local app DB."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid

POSTGRES_IMAGE = "postgres:16-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139"
MINIO_IMAGE = "cgr.dev/chainguard/minio@sha256:a1ac4589a5f8136b616e667b48a0bea9719bb10bd45799ea946f24bbedfafde4"


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], text=True).strip()


def port(container: str, container_port: str) -> str:
    return docker("port", container, container_port).rsplit(":", 1)[1]


def run() -> int:
    root = Path(__file__).resolve().parents[2]
    suffix = uuid.uuid4().hex[:10]
    postgres = "herbimmortal-ci-postgres-" + suffix
    minio = "herbimmortal-ci-minio-" + suffix
    created: list[str] = []
    started = time.monotonic()
    try:
        docker("run", "--rm", "--detach", "--name", postgres, "--publish", "127.0.0.1::5432",
               "--env", "POSTGRES_DB=verification_test", "--env", "POSTGRES_USER=verification_test",
               "--env", "POSTGRES_PASSWORD=herbimmortal-test-only-postgres", POSTGRES_IMAGE)
        created.append(postgres)
        docker("run", "--rm", "--detach", "--name", minio, "--publish", "127.0.0.1::9000",
               "--env", "MINIO_ROOT_USER=verification-test",
               "--env", "MINIO_ROOT_PASSWORD=herbimmortal-test-only-storage", MINIO_IMAGE, "server", "/data")
        created.append(minio)
        endpoint = "http://127.0.0.1:" + port(minio, "9000")
        for _ in range(30):
            ready = subprocess.run(["docker", "exec", postgres, "pg_isready", "-U", "verification_test",
                                    "-d", "verification_test"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                with urllib.request.urlopen(endpoint + "/minio/health/live", timeout=1) as response:
                    storage_ready = response.status == 200
            except (OSError, urllib.error.URLError):
                storage_ready = False
            if ready.returncode == 0 and storage_ready:
                break
            time.sleep(1)
        else:
            raise RuntimeError("Disposable PostgreSQL/MinIO did not become ready.")

        environment = os.environ.copy()
        for key in list(environment):
            if key.startswith(("PUBLISHING_", "AUTH_", "DOCUMENT_", "DB_", "MINIO_", "SPRING_CONFIG_")):
                environment.pop(key)
        environment.update(
            DB_URL=f"jdbc:postgresql://127.0.0.1:{port(postgres, '5432')}/verification_test",
            DB_USERNAME="verification_test", DB_PASSWORD="herbimmortal-test-only-postgres",
            MINIO_ENDPOINT=endpoint, MINIO_ROOT_USER="verification-test",
            MINIO_ROOT_PASSWORD="herbimmortal-test-only-storage")
        with tempfile.NamedTemporaryFile(prefix="herbimmortal-ci-backend-", suffix=".log", delete=False) as log:
            print("Running clean verify against disposable services. Log:", log.name, flush=True)
            command = ["./mvnw", "-B", "-ntp", "clean", "verify", "-DskipTests=false", "-Dmaven.test.skip=false"]
            result = subprocess.run(command, cwd=root / "backend", env=environment,
                                    stdout=log, stderr=subprocess.STDOUT)
        if result.returncode:
            print("\n".join(Path(log.name).read_text().splitlines()[-45:]))
            return result.returncode
        subprocess.run([sys.executable, str(root / "tools/ci/check_test_reports.py"),
                        str(root / "backend/target/surefire-reports"),
                        "--required", "com.herbimmortal.verification.CiDatabaseCanaryTest",
                        "--required", "com.herbimmortal.verification.storage.ObjectStoreIntegrationTest"], check=True)
        print(f"Backend CI reproduction passed in {time.monotonic() - started:.1f} seconds.")
        return 0
    finally:
        for container in reversed(created):
            subprocess.run(["docker", "stop", container], stdout=subprocess.DEVNULL, check=True)


if __name__ == "__main__":
    raise SystemExit(run())

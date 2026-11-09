#!/usr/bin/env python3
"""Fail CI for absent/empty reports, failures, errors, skipped tests, or missing canaries."""
from __future__ import annotations

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET


def check_reports(directory: Path, required: list[str]) -> int:
    files = sorted(directory.glob("*.xml"))
    if not files:
        raise ValueError("No JUnit XML reports were produced.")
    count = 0
    seen: set[str] = set()
    for path in files:
        root = ET.parse(path).getroot()
        for case in root.iter("testcase"):
            count += 1
            name = case.get("classname", "")
            seen.add(name)
            if any(case.find(kind) is not None for kind in ("failure", "error", "skipped")):
                raise ValueError(f"Failed, errored, or skipped test in {path.name}: {name}")
        for suite in root.iter("testsuite"):
            if any(int(suite.get(kind, "0")) for kind in ("failures", "errors", "skipped")):
                raise ValueError(f"Non-green suite in {path.name}.")
    if not count:
        raise ValueError("Reports contain no tests.")
    missing = [name for name in required if name not in seen]
    if missing:
        raise ValueError("Required canary suite missing: " + ", ".join(missing))
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--required", action="append", default=[])
    args = parser.parse_args()
    try:
        count = check_reports(args.directory, args.required)
    except (ValueError, ET.ParseError) as error:
        parser.exit(1, f"Test report check failed: {error}\n")
    print(f"Verified {count} tests with zero failures, errors, or skips.")


if __name__ == "__main__":
    main()

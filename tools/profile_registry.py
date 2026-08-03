#!/usr/bin/env python3
"""
DISPOSABLE. Phase 2A registry profiler. Delete once ingestion is built.

This is not production code and is not part of the Spring application. It
exists to answer the ten profiling questions before any schema is designed.

Standard library only, no pandas, no pip install required.

PRIVACY
    This reads real personal data. By default it prints aggregates, counts and
    MASKED samples only. Full field values are never written to stdout unless
    you pass --unsafe-show-values, which you should not do in a shared
    terminal or paste into a chat.

USAGE
    # 1. see what is actually in the file, and how the profiler mapped columns
    python3 tools/profile_registry.py data/registry.csv --inspect

    # 2. full profile, overriding any column the mapper guessed wrong
    python3 tools/profile_registry.py data/registry.csv \
        --map license=RegNo,name=PractitionerName,status=Status,\
council=Council,registered=RegDate,expiry=ValidUpto

    # 3. write the report to a file instead of the terminal
    python3 tools/profile_registry.py data/registry.csv --out tools/out/profile.md

SUPPORTED INPUTS
    .csv .tsv .txt   delimiter sniffed, encoding auto-detected
    .json            array of objects, or {"records": [...]}, or JSON Lines
    .xlsx            first sheet by default, --sheet to pick another
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# Values that are technically present but mean "nothing here".
BLANK_TOKENS = {
    "", "-", "--", "---", ".", "n/a", "na", "n.a.", "null", "nil", "none",
    "not available", "not applicable", "#n/a", "#null!", "?", "unknown",
    "no data", "nodata", "blank", "empty", "0000-00-00",
}

# Tried in order. The first that decodes the whole file wins.
ENCODINGS = ["utf-8-sig", "utf-8", "cp1252", "latin-1"]

# Date formats tried in order against every date-ish value.
DATE_FORMATS = [
    ("%Y-%m-%d", "YYYY-MM-DD"),
    ("%d-%m-%Y", "DD-MM-YYYY"),
    ("%d/%m/%Y", "DD/MM/YYYY"),
    ("%m/%d/%Y", "MM/DD/YYYY"),
    ("%Y/%m/%d", "YYYY/MM/DD"),
    ("%d.%m.%Y", "DD.MM.YYYY"),
    ("%d-%b-%Y", "DD-Mon-YYYY"),
    ("%d %b %Y", "DD Mon YYYY"),
    ("%d-%B-%Y", "DD-Month-YYYY"),
    ("%d %B %Y", "DD Month YYYY"),
    ("%b %d, %Y", "Mon DD, YYYY"),
    ("%Y-%m-%d %H:%M:%S", "YYYY-MM-DD HH:MM:SS"),
    ("%Y-%m-%dT%H:%M:%S", "ISO-8601 datetime"),
    ("%d-%m-%y", "DD-MM-YY"),
    ("%d/%m/%y", "DD/MM/YY"),
    ("%Y", "YYYY only"),
]

# Header name fragments used to guess what each column is.
ROLE_HINTS = {
    "license": ["licen", "registration number", "registration no", "regno",
                "reg no", "regn no", "council no", "cert no", "certificate no",
                "membership", "enrol", "permit", "id no", "practitioner id"],
    "name": ["name", "practitioner", "doctor", "vaidya", "holder", "person"],
    "status": ["status", "state", "standing", "active", "condition"],
    "council": ["council", "board", "authority", "issuer", "issuing",
                "state", "region", "body", "jurisdiction"],
    "registered": ["registration date", "reg date", "regdate", "registered",
                   "date of registration", "doi", "issued", "issue date",
                   "enrolment date", "from date"],
    "expiry": ["valid", "expiry", "expires", "expire", "valid until",
               "valid upto", "validupto", "renewal", "due", "to date"],
    "specialty": ["special", "qualification", "degree", "discipline", "system"],
}

# Mojibake fingerprints: UTF-8 bytes decoded as cp1252.
MOJIBAKE_MARKERS = ["Ã©", "Ã¨", "Ã¡", "Ã­", "Ã³", "Ãº", "Ã±", "â€™", "â€œ",
                    "â€", "Â ", "Â°", "Ã‚", "ï»¿"]

TODAY = date.today()


# --------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------

def read_bytes(path: str) -> bytes:
    with open(path, "rb") as fh:
        return fh.read()


def detect_encoding(raw: bytes) -> tuple[str, str]:
    """Return (encoding, note). Falls back to latin-1, which never fails."""
    for enc in ENCODINGS:
        try:
            raw.decode(enc)
            return enc, "clean decode"
        except UnicodeDecodeError:
            continue
    return "latin-1", "FALLBACK, file is not valid UTF-8 or cp1252"


def line_ending_report(raw: bytes) -> dict:
    crlf = raw.count(b"\r\n")
    lf = raw.count(b"\n") - crlf
    cr = raw.count(b"\r") - crlf
    return {"CRLF": crlf, "LF only": lf, "CR only": cr}


def load_delimited(text: str, delimiter: str | None) -> tuple[list[str], list[dict]]:
    sample = text[:64_000]
    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    headers = list(reader.fieldnames or [])
    rows = [dict(r) for r in reader]
    return headers, rows


def load_json(text: str) -> tuple[list[str], list[dict]]:
    text = text.strip()
    records: list[dict] = []
    if text.startswith("["):
        records = json.loads(text)
    elif text.startswith("{"):
        obj = json.loads(text)
        for key in ("records", "data", "results", "rows", "items"):
            if isinstance(obj.get(key), list):
                records = obj[key]
                break
        else:
            records = [obj]
    else:  # JSON Lines
        records = [json.loads(line) for line in text.splitlines() if line.strip()]
    headers: list[str] = []
    for r in records:
        for k in r:
            if k not in headers:
                headers.append(k)
    return headers, [{h: r.get(h) for h in headers} for r in records]


def load_xlsx(path: str, sheet_index: int) -> tuple[list[str], list[dict]]:
    """
    Minimal .xlsx reader: unzip, parse sharedStrings and one sheet.

    Caveat worth knowing: Excel stores dates as numbers counting days from
    1899-12-30. We convert anything in a plausible date range back to a date,
    which is a heuristic and can misfire on genuine numeric columns.
    """
    import xml.etree.ElementTree as ET
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(f"{ns}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{ns}t")))

        sheets = sorted(n for n in z.namelist()
                        if n.startswith("xl/worksheets/sheet") and n.endswith(".xml"))
        if not sheets:
            raise SystemExit("No worksheets found in the xlsx file.")
        if sheet_index >= len(sheets):
            raise SystemExit(f"--sheet {sheet_index} out of range, file has {len(sheets)}.")
        root = ET.fromstring(z.read(sheets[sheet_index]))

    def col_letters(ref: str) -> str:
        return "".join(ch for ch in ref if ch.isalpha())

    def col_index(letters: str) -> int:
        n = 0
        for ch in letters:
            n = n * 26 + (ord(ch.upper()) - 64)
        return n - 1

    grid: list[dict[int, str]] = []
    for row in root.iter(f"{ns}row"):
        cells: dict[int, str] = {}
        for c in row.findall(f"{ns}c"):
            ref, ctype = c.get("r", ""), c.get("t", "")
            v = c.find(f"{ns}v")
            if ctype == "inlineStr":
                is_el = c.find(f"{ns}is")
                text = "".join(t.text or "" for t in is_el.iter(f"{ns}t")) if is_el is not None else ""
            elif v is None:
                text = ""
            elif ctype == "s":
                idx = int(v.text or 0)
                text = shared[idx] if idx < len(shared) else ""
            else:
                text = v.text or ""
                # Excel serial date heuristic: 1900-01-01 .. 2100-01-01
                if re.fullmatch(r"\d{5}(\.\d+)?", text):
                    n = float(text)
                    if 20000 <= n <= 75000:
                        text = (datetime(1899, 12, 30) + timedelta(days=n)).date().isoformat()
            cells[col_index(col_letters(ref))] = text
        grid.append(cells)

    if not grid:
        return [], []
    width = max((max(c) + 1 if c else 0) for c in grid)
    header_cells = grid[0]
    headers = [(header_cells.get(i) or f"column_{i + 1}").strip() for i in range(width)]
    rows = [{headers[i]: (cells.get(i) or "") for i in range(width)} for cells in grid[1:]]
    return headers, rows


def load(path: str, args) -> tuple[list[str], list[dict], dict]:
    raw = read_bytes(path)
    meta = {"size_bytes": len(raw), "line_endings": line_ending_report(raw)}
    ext = os.path.splitext(path)[1].lower()

    if ext == ".xlsx":
        meta["encoding"] = "n/a (xlsx is zipped xml)"
        headers, rows = load_xlsx(path, args.sheet)
    else:
        enc = args.encoding or detect_encoding(raw)[0]
        meta["encoding"] = enc
        meta["encoding_note"] = detect_encoding(raw)[1] if not args.encoding else "forced by --encoding"
        text = raw.decode(enc, errors="replace")
        if ext == ".json":
            headers, rows = load_json(text)
        else:
            headers, rows = load_delimited(text, args.delimiter)
    return headers, rows, meta


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def s(v) -> str:
    return "" if v is None else str(v)


def is_blank(v) -> bool:
    return s(v).strip().lower() in BLANK_TOKENS


def shape(v: str) -> str:
    """'MH/12345-A' -> 'AA/99999-A'. Digits to 9, letters to A, rest kept."""
    out = []
    for ch in v:
        if ch.isdigit():
            out.append("9")
        elif ch.isalpha():
            out.append("A")
        else:
            out.append(ch)
    return "".join(out)


def mask(v: str) -> str:
    """Redact a value while keeping its shape legible: 'MH12345' -> 'MH1***5'."""
    v = s(v)
    if len(v) <= 3:
        return "*" * len(v)
    return v[:2] + "*" * (len(v) - 3) + v[-1]


def provisional_normalize_license(v: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s(v).upper())


def provisional_normalize_text(v: str) -> str:
    v = unicodedata.normalize("NFKD", s(v))
    v = "".join(c for c in v if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9 ]", " ", v.upper())).strip()


def parse_date(v: str):
    t = s(v).strip()
    if is_blank(t):
        return None, "BLANK"
    for fmt, label in DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt).date(), label
        except ValueError:
            continue
    return None, "UNPARSEABLE"


def table(headers: list[str], rows: list[list], limit: int | None = None) -> str:
    rows = list(rows)
    truncated = limit is not None and len(rows) > limit
    if truncated:
        rows = rows[:limit]
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    if truncated:
        out.append(f"| ... | {'... | ' * (len(headers) - 1)}".rstrip())
    return "\n".join(out)


def pct(n: int, total: int) -> str:
    return f"{(100.0 * n / total):.1f}%" if total else "0.0%"


# --------------------------------------------------------------------------
# Column role mapping
# --------------------------------------------------------------------------

def guess_roles(headers: list[str]) -> dict[str, str]:
    """
    Match header names against ROLE_HINTS. Separators are folded first, so
    'registration_number', 'Registration Number' and 'registration-number' all
    match the same hint. Longest hint wins, exact match wins outright.
    """
    roles: dict[str, str] = {}
    lowered = {h: re.sub(r"[\s_\-.]+", " ", h.lower()).strip() for h in headers}
    for role, hints in ROLE_HINTS.items():
        best, best_score = None, 0
        for h, hl in lowered.items():
            if h in roles.values():
                continue
            for hint in hints:
                if hint in hl:
                    score = len(hint) + (5 if hl == hint else 0)
                    if score > best_score:
                        best, best_score = h, score
        if best:
            roles[role] = best
    return roles


# --------------------------------------------------------------------------
# Report sections
# --------------------------------------------------------------------------

def section_volume(rows, headers, roles, out):
    total = len(rows)
    exact = Counter(tuple(s(r.get(h)) for h in headers) for r in rows)
    dup_rows = sum(c - 1 for c in exact.values() if c > 1)

    body = [["Total data rows", total],
            ["Columns", len(headers)],
            ["Exact duplicate rows (beyond first copy)", dup_rows],
            ["Fully unique rows", len(exact)]]

    lic = roles.get("license")
    if lic:
        vals = [s(r.get(lic)) for r in rows if not is_blank(r.get(lic))]
        body.append(["Rows with a license value", len(vals)])
        body.append(["Distinct license values (raw)", len(set(vals))])
        body.append(["Distinct license values (normalized)",
                     len({provisional_normalize_license(v) for v in vals})])

    out.append("## 1. Volume\n")
    out.append(table(["Metric", "Value"], body))
    out.append("")


def section_license_formats(rows, roles, out):
    out.append("## 2. License number formats\n")
    lic = roles.get("license")
    if not lic:
        out.append("_No license column mapped. Pass `--map license=<column>`._\n")
        return
    vals = [s(r.get(lic)) for r in rows if not is_blank(r.get(lic))]
    if not vals:
        out.append("_License column is entirely blank._\n")
        return

    shapes = Counter(shape(v.strip()) for v in vals)
    out.append(f"**Distinct shapes: {len(shapes)}** (9 = digit, A = letter, other chars literal)\n")
    out.append(table(["Shape", "Rows", "Share", "Masked example"],
                     [[sh, n, pct(n, len(vals)),
                       mask(next(v.strip() for v in vals if shape(v.strip()) == sh))]
                      for sh, n in shapes.most_common(30)]))
    out.append("")

    traits = [
        ["Has leading/trailing whitespace", sum(1 for v in vals if v != v.strip())],
        ["Contains an internal space", sum(1 for v in vals if " " in v.strip())],
        ["Contains a hyphen", sum(1 for v in vals if "-" in v)],
        ["Contains a slash", sum(1 for v in vals if "/" in v)],
        ["Contains a dot", sum(1 for v in vals if "." in v)],
        ["Purely numeric", sum(1 for v in vals if v.strip().isdigit())],
        ["Alphanumeric mix", sum(1 for v in vals if any(c.isdigit() for c in v) and any(c.isalpha() for c in v))],
        ["Has a leading zero", sum(1 for v in vals if re.match(r"^\s*0\d", v))],
        ["All uppercase letters", sum(1 for v in vals if v.isupper() and any(c.isalpha() for c in v))],
        ["All lowercase letters", sum(1 for v in vals if v.islower() and any(c.isalpha() for c in v))],
        ["Mixed case letters", sum(1 for v in vals
                                   if any(c.isupper() for c in v) and any(c.islower() for c in v))],
    ]
    out.append("**Traits** (rows may count in more than one)\n")
    out.append(table(["Trait", "Rows", "Share"],
                     [[t, n, pct(n, len(vals))] for t, n in traits]))
    out.append("")

    lens = Counter(len(v.strip()) for v in vals)
    out.append("**Length distribution (raw)**\n")
    out.append(table(["Length", "Rows", "Share"],
                     [[L, n, pct(n, len(vals))] for L, n in sorted(lens.items())]))
    out.append("")

    prefixes = Counter(m.group(1).upper() for v in vals
                       if (m := re.match(r"^\s*([A-Za-z]{1,5})", v)))
    if prefixes:
        no_prefix = len(vals) - sum(prefixes.values())
        out.append("**Alphabetic prefixes** (the 'present on some rows, absent on others' problem)\n")
        out.append(table(["Prefix", "Rows", "Share"],
                         [[p, n, pct(n, len(vals))] for p, n in prefixes.most_common(20)]
                         + [["(none, starts with a digit)", no_prefix, pct(no_prefix, len(vals))]]))
        out.append("")


def section_duplicate_licenses(rows, headers, roles, out):
    out.append("## 3. Duplicate license numbers\n")
    lic = roles.get("license")
    if not lic:
        out.append("_No license column mapped._\n")
        return
    council = roles.get("council")

    groups = defaultdict(list)
    for i, r in enumerate(rows):
        if is_blank(r.get(lic)):
            continue
        key = provisional_normalize_license(s(r.get(lic)))
        if council:
            key = (key, provisional_normalize_text(s(r.get(council))))
        groups[key].append(i)

    dup_groups = {k: v for k, v in groups.items() if len(v) > 1}
    affected = sum(len(v) for v in dup_groups.values())

    out.append(table(["Metric", "Value"], [
        ["Key used", f"normalized license + council" if council else "normalized license only"],
        ["Distinct keys", len(groups)],
        ["Keys appearing on more than one row", len(dup_groups)],
        ["Rows involved in a duplicate key", affected],
        ["Share of rows affected", pct(affected, len(rows))],
    ]))
    out.append("")

    verdict = ("UNIQUE constraint on the natural key is SAFE."
               if not dup_groups else
               "UNIQUE constraint on the natural key is NOT possible. "
               "Duplicate resolution becomes the matcher's problem.")
    out.append(f"**Verdict: {verdict}**\n")

    if dup_groups:
        differing = Counter()
        identical_groups = 0
        for idxs in dup_groups.values():
            varies = False
            for h in headers:
                if len({s(rows[i].get(h)).strip() for i in idxs}) > 1:
                    differing[h] += 1
                    varies = True
            if not varies:
                identical_groups += 1
        out.append(f"Of {len(dup_groups)} duplicate keys, **{identical_groups}** have rows that are "
                   f"identical in every column (safe to deduplicate), and "
                   f"**{len(dup_groups) - identical_groups}** genuinely differ.\n")
        out.append("**Which columns differ within a duplicate group**\n")
        out.append(table(["Column", "Duplicate groups where it varies"],
                         [[h, n] for h, n in differing.most_common()]))
        out.append("")


def section_names(rows, roles, out):
    out.append("## 4. Name formats\n")
    name = roles.get("name")
    if not name:
        out.append("_No name column mapped. Pass `--map name=<column>`._\n")
        return
    vals = [s(r.get(name)) for r in rows if not is_blank(r.get(name))]
    if not vals:
        out.append("_Name column is entirely blank._\n")
        return

    titles = ["dr", "dr.", "doctor", "vaidya", "vd", "vd.", "prof", "prof.",
              "professor", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "shri",
              "smt", "sri", "md", "hakeem", "pt", "pt.", "pandit"]
    quals = ["bams", "mbbs", "md", "ms", "bhms", "bums", "phd", "ph.d", "msc",
             "m.d", "m.s", "b.a.m.s", "dnb", "dm", "mch", "pg", "dip", "frcp"]

    def has_token(v, tokens):
        toks = set(re.split(r"[\s,.()\-/]+", v.lower()))
        return any(t.replace(".", "") in {x.replace(".", "") for x in toks if x} for t in tokens)

    traits = [
        ["Leading title present (Dr, Vaidya, ...)", sum(1 for v in vals if has_token(v, titles))],
        ["Qualification suffix present (BAMS, MD, ...)", sum(1 for v in vals if has_token(v, quals))],
        ["Contains a comma (possible surname-first)", sum(1 for v in vals if "," in v)],
        ["Contains a period", sum(1 for v in vals if "." in v)],
        ["Contains an initial (single letter token)",
         sum(1 for v in vals if re.search(r"(?:^|\s)[A-Za-z](?:\.|\s|$)", v))],
        ["Contains a double space", sum(1 for v in vals if "  " in v)],
        ["Leading/trailing whitespace", sum(1 for v in vals if v != v.strip())],
        ["Non-ASCII characters", sum(1 for v in vals if any(ord(c) > 127 for c in v))],
        ["ALL UPPERCASE", sum(1 for v in vals if v.isupper())],
        ["all lowercase", sum(1 for v in vals if v.islower())],
        ["Title Case", sum(1 for v in vals if v.istitle())],
        ["Contains digits", sum(1 for v in vals if any(c.isdigit() for c in v))],
        ["Contains bracketed text", sum(1 for v in vals if "(" in v or ")" in v)],
    ]
    out.append(table(["Trait", "Rows", "Share"],
                     [[t, n, pct(n, len(vals))] for t, n in traits]))
    out.append("")

    tokens = Counter(len(v.strip().split()) for v in vals)
    out.append("**Token count per name**\n")
    out.append(table(["Tokens", "Rows", "Share"],
                     [[k, n, pct(n, len(vals))] for k, n in sorted(tokens.items())]))
    out.append("")

    non_ascii = Counter(c for v in vals for c in v if ord(c) > 127)
    if non_ascii:
        out.append("**Non-ASCII characters present**\n")
        out.append(table(["Char", "Codepoint", "Unicode name", "Occurrences"],
                         [[repr(c), f"U+{ord(c):04X}",
                           unicodedata.name(c, "?"), n]
                          for c, n in non_ascii.most_common(25)]))
        out.append("")


def section_nulls(rows, headers, out):
    out.append("## 5. Null and blank rates per column\n")
    total = len(rows)
    body = []
    for h in headers:
        missing = sum(1 for r in rows if r.get(h) is None)
        empty = sum(1 for r in rows if r.get(h) is not None and s(r.get(h)) == "")
        ws = sum(1 for r in rows if s(r.get(h)) != "" and s(r.get(h)).strip() == "")
        sentinel = sum(1 for r in rows
                       if s(r.get(h)).strip() != ""
                       and s(r.get(h)).strip().lower() in BLANK_TOKENS)
        blank = missing + empty + ws + sentinel
        distinct = len({s(r.get(h)).strip() for r in rows if not is_blank(r.get(h))})
        body.append([h, missing, empty, ws, sentinel, blank, pct(blank, total), distinct])
    out.append(table(
        ["Column", "null", '""', "whitespace", "'NA'-like", "Total blank", "Blank %", "Distinct non-blank"],
        body))
    out.append("")


def section_dates(rows, roles, out):
    out.append("## 6. Dates\n")
    date_roles = [r for r in ("registered", "expiry") if roles.get(r)]
    if not date_roles:
        out.append("_No date columns mapped. Pass `--map registered=<col>,expiry=<col>`._\n")
        return

    for role in date_roles:
        col = roles[role]
        vals = [s(r.get(col)) for r in rows]
        fmts, parsed = Counter(), []
        for v in vals:
            d, label = parse_date(v)
            fmts[label] += 1
            parsed.append(d)
        out.append(f"### `{col}` (mapped as {role})\n")
        out.append(table(["Detected format", "Rows", "Share"],
                         [[f, n, pct(n, len(vals))] for f, n in fmts.most_common()]))
        good = [d for d in parsed if d]
        if good:
            past = sum(1 for d in good if d < TODAY)
            out.append("")
            out.append(table(["Metric", "Value"], [
                ["Parsed successfully", len(good)],
                ["Failed to parse", fmts.get("UNPARSEABLE", 0)],
                ["Blank or missing", fmts.get("BLANK", 0)],
                ["Earliest", min(good).isoformat()],
                ["Latest", max(good).isoformat()],
                ["In the past (before today)", f"{past} ({pct(past, len(good))})"],
                ["Implausible (before 1900 or after 2100)",
                 sum(1 for d in good if d.year < 1900 or d.year > 2100)],
            ]))
        out.append("")


def section_status(rows, roles, out):
    out.append("## 7. Status column\n")
    col = roles.get("status")
    if not col:
        out.append("_No status column mapped. Pass `--map status=<column>`._\n")
        return
    exact = Counter(s(r.get(col)) for r in rows)
    out.append(f"**Exact distinct values: {len(exact)}**\n")
    out.append(table(["Exact value (repr)", "Rows", "Share"],
                     [[repr(v), n, pct(n, len(rows))] for v, n in exact.most_common(50)]))
    out.append("")

    folded = defaultdict(Counter)
    for v, n in exact.items():
        folded[provisional_normalize_text(v)][v] = n
    collapsible = {k: v for k, v in folded.items() if len(v) > 1}
    if collapsible:
        out.append("**Values that collapse once case and punctuation are folded**\n")
        out.append(table(["Folded key", "Raw variants", "Total rows"],
                         [[k or "(blank)", ", ".join(repr(x) for x in v),
                           sum(v.values())] for k, v in collapsible.items()]))
    else:
        out.append("_No case or punctuation variants found: every distinct value is genuinely distinct._")
    out.append("")


def section_council(rows, roles, out):
    out.append("## 8. Council / issuing board\n")
    col = roles.get("council")
    if not col:
        out.append("_No council column mapped. Pass `--map council=<column>`._\n")
        return
    exact = Counter(s(r.get(col)).strip() for r in rows)
    out.append(f"**Exact distinct values: {len(exact)}**\n")
    out.append(table(["Value", "Rows", "Share"],
                     [[v or "(blank)", n, pct(n, len(rows))] for v, n in exact.most_common(60)]))
    out.append("")

    keys = sorted({provisional_normalize_text(v) for v in exact if v})
    pairs = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            ratio = SequenceMatcher(None, a, b).ratio()
            if ratio >= 0.82:
                pairs.append([a, b, f"{ratio:.2f}"])
    if pairs:
        out.append("**Likely spelling variants of the same body** (normalized similarity >= 0.82)\n")
        out.append(table(["Value A (normalized)", "Value B (normalized)", "Similarity"], pairs, limit=40))
    else:
        out.append("_No near-duplicate council names detected._")
    out.append("")


def section_contradictions(rows, roles, out):
    out.append("## 9. Internal contradictions\n")
    status_col, exp_col, reg_col = roles.get("status"), roles.get("expiry"), roles.get("registered")
    findings = []

    if status_col and exp_col:
        n = 0
        for r in rows:
            st = provisional_normalize_text(s(r.get(status_col)))
            d, _ = parse_date(s(r.get(exp_col)))
            if d and d < TODAY and "ACTIVE" in st:
                n += 1
        findings.append(["Marked active, but expiry date is in the past", n])

    if status_col and exp_col:
        n = sum(1 for r in rows
                if "ACTIVE" in provisional_normalize_text(s(r.get(status_col)))
                and is_blank(r.get(exp_col)))
        findings.append(["Marked active, but no expiry date at all", n])

    if reg_col and exp_col:
        n = 0
        for r in rows:
            a, _ = parse_date(s(r.get(reg_col)))
            b, _ = parse_date(s(r.get(exp_col)))
            if a and b and b < a:
                n += 1
        findings.append(["Expiry date earlier than registration date", n])

    if reg_col:
        n = 0
        for r in rows:
            d, _ = parse_date(s(r.get(reg_col)))
            if d and d > TODAY:
                n += 1
        findings.append(["Registration date in the future", n])

    if not findings:
        out.append("_Not enough mapped columns to cross-check. Map status, registered and expiry._\n")
        return
    out.append(table(["Contradiction", "Rows"], findings))
    out.append("")


def section_encoding(rows, headers, meta, out):
    out.append("## 10. Encoding and whitespace\n")
    out.append(table(["Property", "Value"], [
        ["File size", f"{meta['size_bytes']:,} bytes"],
        ["Encoding used", meta.get("encoding", "?")],
        ["Encoding note", meta.get("encoding_note", "")],
        ["CRLF line endings", meta["line_endings"]["CRLF"]],
        ["LF only line endings", meta["line_endings"]["LF only"]],
        ["CR only line endings", meta["line_endings"]["CR only"]],
    ]))
    out.append("")

    body = []
    for h in headers:
        vals = [s(r.get(h)) for r in rows]
        lead = sum(1 for v in vals if v != v.lstrip())
        trail = sum(1 for v in vals if v != v.rstrip())
        dbl = sum(1 for v in vals if "  " in v)
        nb = sum(1 for v in vals if " " in v)
        na = sum(1 for v in vals if any(ord(c) > 127 for c in v))
        moj = sum(1 for v in vals if any(m in v for m in MOJIBAKE_MARKERS))
        if lead or trail or dbl or nb or na or moj:
            body.append([h, lead, trail, dbl, nb, na, moj])
    if body:
        out.append(table(["Column", "Leading ws", "Trailing ws", "Double space",
                          "Non-breaking space", "Non-ASCII", "Mojibake markers"], body))
    else:
        out.append("_No whitespace or encoding anomalies detected in any column._")
    out.append("")


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Phase 2A registry profiler (disposable).")
    ap.add_argument("path", help="path to the registry file")
    ap.add_argument("--inspect", action="store_true",
                    help="show headers and role mapping only, then exit")
    ap.add_argument("--map", default="",
                    help="override role mapping, e.g. license=RegNo,name=Practitioner")
    ap.add_argument("--delimiter", default=None, help="force a CSV delimiter")
    ap.add_argument("--encoding", default=None, help="force an encoding")
    ap.add_argument("--sheet", type=int, default=0, help="xlsx sheet index, default 0")
    ap.add_argument("--out", default=None, help="write the report to this file")
    ap.add_argument("--unsafe-show-values", action="store_true",
                    help="print unmasked values. Do not use on real data.")
    args = ap.parse_args()

    if not os.path.exists(args.path):
        raise SystemExit(f"File not found: {args.path}")

    headers, rows, meta = load(args.path, args)
    if not headers:
        raise SystemExit("No columns detected. Check --delimiter and --encoding.")

    roles = guess_roles(headers)
    for pair in filter(None, (p.strip() for p in args.map.split(","))):
        if "=" not in pair:
            raise SystemExit(f"Bad --map entry: {pair!r}. Use role=Column.")
        role, col = (x.strip() for x in pair.split("=", 1))
        if col not in headers:
            raise SystemExit(f"Column {col!r} not in file. Columns: {headers}")
        roles[role] = col

    if args.inspect:
        print(f"File:     {args.path}")
        print(f"Encoding: {meta.get('encoding')}")
        print(f"Rows:     {len(rows):,}")
        print(f"Columns:  {len(headers)}\n")
        print(table(["#", "Column", "Mapped role", "Blank %", "Distinct", "Masked sample"],
                    [[i + 1, h,
                      next((r for r, c in roles.items() if c == h), ""),
                      pct(sum(1 for r in rows if is_blank(r.get(h))), len(rows)),
                      len({s(r.get(h)).strip() for r in rows}),
                      mask(next((s(r.get(h)).strip() for r in rows
                                 if not is_blank(r.get(h))), ""))]
                     for i, h in enumerate(headers)]))
        print("\nIf a role is wrong or missing, re-run with e.g.")
        print("  --map license=<column>,name=<column>,status=<column>,council=<column>")
        return

    out: list[str] = []
    out.append(f"# Registry profile: `{os.path.basename(args.path)}`\n")
    out.append(f"_Generated {datetime.now().isoformat(timespec='seconds')}. "
               f"Values are masked unless stated._\n")
    out.append("**Column role mapping used**\n")
    out.append(table(["Role", "Column"],
                     [[r, roles.get(r, "(unmapped)")] for r in
                      ("license", "name", "status", "council", "registered", "expiry", "specialty")]))
    out.append("")

    section_volume(rows, headers, roles, out)
    section_license_formats(rows, roles, out)
    section_duplicate_licenses(rows, headers, roles, out)
    section_names(rows, roles, out)
    section_nulls(rows, headers, out)
    section_dates(rows, roles, out)
    section_status(rows, roles, out)
    section_council(rows, roles, out)
    section_contradictions(rows, roles, out)
    section_encoding(rows, headers, meta, out)

    report = "\n".join(out)
    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(report)
        print(f"Report written to {args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()

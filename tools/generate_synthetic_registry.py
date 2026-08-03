#!/usr/bin/env python3
"""
DISPOSABLE. Generates a synthetic practitioner registry that stands in for the
real HerbImmortal export until it arrives.

Deleted the day the real file lands. The schema and the ingestion job are built
against the SHAPE this produces, so the messiness here is deliberate and each
kind is documented below.

    python3 tools/generate_synthetic_registry.py data/registry_synthetic.csv --rows 5000

Injected defects, and why each one is here:

  license formats     six shapes, prefixed and unprefixed, spaced, hyphenated,
                      slashed, leading zeros, mixed case
                      -> forces license canonicalization in Normalizer
  duplicate keys      ~0.6% of rows share licence+council with a DIFFERENT
                      status or expiry, plus a handful of byte-identical rows
                      -> decides whether the natural key can be UNIQUE
  name noise          titles, appended qualifications, double spaces,
                      surname-first with a comma, initials, diacritics
                      -> forces title stripping and Unicode folding
  council variants    same body spelled several ways
                      -> forces a council code lookup rather than raw text
  status variants     case and whitespace variants, blanks, "N/A"
                      -> forces a parsed enum beside the raw string
  dates               five formats, blanks, junk strings
                      -> forces multi-format parsing and a rejects table
  contradictions      active rows with an expiry in the past
                      -> proves rules cannot trust the status column alone
  encoding            a few rows with non-breaking spaces and trailing spaces
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import sys

FIRST = ["Anil", "Priya", "Rajesh", "Meera", "Suresh", "Kavita", "Arun", "Deepa",
         "Ramesh", "Sunita", "Vikram", "Anjali", "Sanjay", "Lakshmi", "Prakash",
         "Rekha", "Mohan", "Shalini", "Girish", "Nandini", "Harish", "Padma",
         "Vinod", "Asha", "Kiran", "Manju", "Devendra", "Sarita", "Mukesh", "Uma"]

LAST = ["Sharma", "Patil", "Iyer", "Nair", "Desai", "Kulkarni", "Reddy", "Joshi",
        "Menon", "Rao", "Gupta", "Bhat", "Shetty", "Pillai", "Chauhan", "Verma",
        "Naik", "Hegde", "Trivedi", "Bose", "Mishra", "Kaur", "Sinha", "Pandey"]

# council canonical name -> the spelling variants that appear in the export
COUNCILS = {
    "Maharashtra Council of Indian Medicine": [
        "Maharashtra Council of Indian Medicine",
        "Maharashtra Council Of Indian Medicine",
        "MAHARASHTRA COUNCIL OF INDIAN MEDICINE",
        "Maharashtra Counsil of Indian Medicine",   # misspelling, on purpose
        "Maharashtra Council of Indian Med.",
    ],
    "Karnataka Ayurvedic and Unani Practitioners Board": [
        "Karnataka Ayurvedic and Unani Practitioners Board",
        "Karnataka Ayurvedic & Unani Practitioners Board",
        "Karnataka Ayurvedic and Unani Practitioners  Board",
    ],
    "Kerala State Medical Council (Indian Systems of Medicine)": [
        "Kerala State Medical Council (Indian Systems of Medicine)",
        "Kerala State Medical Council (ISM)",
        "Kerala State Medical Council",
    ],
    "Gujarat Board of Ayurvedic and Unani Systems of Medicine": [
        "Gujarat Board of Ayurvedic and Unani Systems of Medicine",
        "Gujarat Board of Ayurvedic & Unani Systems of Medicine",
    ],
}

COUNCIL_PREFIX = {
    "Maharashtra Council of Indian Medicine": "MH",
    "Karnataka Ayurvedic and Unani Practitioners Board": "KA",
    "Kerala State Medical Council (Indian Systems of Medicine)": "KL",
    "Gujarat Board of Ayurvedic and Unani Systems of Medicine": "GJ",
}

TITLES = ["Dr. ", "Dr ", "Dr.", "Vaidya ", "Vd. ", "Prof. ", "Shri ", "Smt. ",
          "", "", "", "", "", ""]            # most rows have no title
QUALS = ["", "", "", "", " BAMS", " B.A.M.S.", ", BAMS", " MD (Ayu)",
         ", M.D. (Ayurveda)", " BAMS, MD", " (BAMS)"]
SPECIALTIES = ["Ayurveda", "Panchakarma", "Kayachikitsa", "Shalya Tantra",
               "Prasuti Tantra", "Rasashastra", "Unani", ""]
STATUSES = (["Active"] * 60 + ["ACTIVE"] * 8 + ["active"] * 5 + ["Active "] * 3
            + ["Suspended"] * 6 + ["suspended"] * 2 + ["Revoked"] * 3
            + ["Expired"] * 5 + ["Inactive"] * 2 + [""] * 4 + ["N/A"] * 2)


def fmt_date(y: int, m: int, d: int, style: int) -> str:
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    if style == 0:
        return f"{y:04d}-{m:02d}-{d:02d}"
    if style == 1:
        return f"{d:02d}/{m:02d}/{y:04d}"
    if style == 2:
        return f"{d:02d}-{m:02d}-{y:04d}"
    if style == 3:
        return f"{d:02d}-{months[m - 1]}-{y:04d}"
    return f"{y:04d}/{m:02d}/{d:02d}"


def make_license(prefix: str, n: int, rng: random.Random) -> str:
    shape = rng.choices([0, 1, 2, 3, 4, 5], weights=[40, 20, 12, 10, 10, 8])[0]
    if shape == 0:
        return f"{prefix}{n}"
    if shape == 1:
        return f"{prefix}-{n}"
    if shape == 2:
        return f"{prefix} {n}"
    if shape == 3:
        return f"{prefix.lower()}{n}"
    if shape == 4:
        return f"{n}"                       # prefix missing entirely
    return f"{prefix}/{n}/A"


def make_name(rng: random.Random) -> str:
    first, last = rng.choice(FIRST), rng.choice(LAST)
    roll = rng.random()
    if roll < 0.04:                         # surname first, comma separated
        base = f"{last}, {first}"
    elif roll < 0.10:                       # middle initial
        base = f"{first} {rng.choice('ABCDEFGHKLMNPRSTV')}. {last}"
    else:
        base = f"{first} {last}"
    name = rng.choice(TITLES) + base + rng.choice(QUALS)
    if rng.random() < 0.04:
        name = name.replace(" ", "  ", 1)   # double space
    if rng.random() < 0.02:
        name = name.replace("a", "ā", 1)   # macron, Unicode folding case
    if rng.random() < 0.015:
        name = name + " "              # trailing non-breaking space
    return name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--rows", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=20260730)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    rows: list[dict] = []
    used: set[tuple[str, str]] = set()

    for i in range(args.rows):
        canonical = rng.choice(list(COUNCILS))
        prefix = COUNCIL_PREFIX[canonical]
        number = rng.randint(100, 99999)
        if (prefix, str(number)) in used:
            continue
        used.add((prefix, str(number)))

        reg_y = rng.randint(1998, 2024)
        exp_y = reg_y + rng.choice([5, 5, 10, 10, 3])
        style = rng.choices([0, 1, 2, 3, 4], weights=[45, 25, 15, 10, 5])[0]

        reg_date = fmt_date(reg_y, rng.randint(1, 12), rng.randint(1, 28), style)
        if rng.random() < 0.06:
            reg_date = rng.choice(["", "NA", "-", "not recorded"])

        exp_date = fmt_date(exp_y, rng.randint(1, 12), rng.randint(1, 28), style)
        if rng.random() < 0.08:
            exp_date = rng.choice(["", "N/A", "lifetime", "31/02/2025"])

        rows.append({
            "registration_number": make_license(prefix, number, rng),
            "practitioner_name": make_name(rng),
            "council": rng.choice(COUNCILS[canonical]),
            "qualification": rng.choice(["BAMS", "BAMS, MD", "BUMS", "BAMS, PhD", ""]),
            "specialty": rng.choice(SPECIALTIES),
            "registration_date": reg_date,
            "valid_until": exp_date,
            "status": rng.choice(STATUSES),
        })

    # byte-identical duplicate rows, the kind an export with a bad join produces
    for i in rng.sample(range(len(rows)), k=max(1, len(rows) // 250)):
        rows.append(dict(rows[i]))

    # same licence and council, DIFFERENT status and expiry. These are the rows
    # that decide whether the natural key can carry a UNIQUE constraint.
    for i in rng.sample(range(len(rows)), k=max(1, int(len(rows) * 0.006))):
        clone = dict(rows[i])
        clone["status"] = rng.choice(["Suspended", "Expired", "Revoked"])
        clone["valid_until"] = fmt_date(rng.randint(2016, 2022),
                                        rng.randint(1, 12), rng.randint(1, 28), 0)
        rows.append(clone)

    rng.shuffle(rows)

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    print(f"wrote {len(rows)} rows to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()

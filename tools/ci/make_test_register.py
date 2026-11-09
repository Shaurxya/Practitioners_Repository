#!/usr/bin/env python3
"""Generate a synthetic three-page ruled register, never real practitioner data."""
from __future__ import annotations
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, PageBreak


def generate(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    story = []
    for page in range(3):
        if page:
            story.append(PageBreak())
        rows = [["Sl No.", "National Registration Number", "Name", "State", "System", "Status", "Qualification"]]
        for offset in range(15):
            number = page * 15 + offset + 1
            rows.append([str(number), f"NR/AY/GA/{number:07d}", f"SYNTHETIC DEMO PERSON {number}",
                         "DEMO", "Ayurveda", "Active", "DEMO BAMS"])
        table = Table(rows, colWidths=[40, 170, 215, 50, 65, 50, 80], rowHeights=24)
        table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(table)
    SimpleDocTemplate(str(path), pagesize=landscape(A4),
                      leftMargin=30, rightMargin=30, topMargin=30, bottomMargin=30).build(story)


if __name__ == "__main__":
    generate(Path(sys.argv[1]))

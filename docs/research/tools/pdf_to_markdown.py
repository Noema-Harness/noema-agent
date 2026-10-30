#!/usr/bin/env python3
"""Extract a text-first Markdown reading copy from an academic PDF.

This preserves page boundaries for citation checks. It is not a layout-faithful
PDF converter; inspect equations, tables, figures, and two-column ordering in
the source PDF when they matter.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError as exc:  # pragma: no cover - depends on local research setup
    raise SystemExit(
        "PyMuPDF is required. Install the research-only dependency with: "
        "python -m pip install -r docs/research/tools/requirements.txt"
    ) from exc


NUMBERED_HEADING = re.compile(r"^(\d+(?:\.\d+)*\.?)[ \t]+(.{2,120})$")


def markdown_page(text: str) -> str:
    lines = [line.rstrip() for line in text.splitlines()]
    result: list[str] = []
    for line in lines:
        value = line.strip()
        if not value:
            if result and result[-1] != "":
                result.append("")
            continue
        match = NUMBERED_HEADING.match(value)
        if match and len(value) < 130:
            depth = min(match.group(1).count(".") + 1, 4)
            result.extend(["" if result and result[-1] else "", f"{'#' * depth} {value}", ""])
        elif result and result[-1] and not result[-1].startswith("#"):
            # PDF extraction often breaks a paragraph into lines. Join them so
            # the Markdown copy remains searchable and compact.
            result[-1] += " " + value
        else:
            result.append(value)
    return "\n".join(result).strip()


def convert(source: Path, destination: Path) -> None:
    with fitz.open(source) as document:
        title = (document.metadata or {}).get("title") or source.stem
        chunks = [f"# {title}\n", f"Source PDF: `{source.name}`\n", f"Pages: {len(document)}\n"]
        for page_number, page in enumerate(document, start=1):
            text = page.get_text("text", sort=True)
            chunks.append(f"\n---\n\n<!-- Page {page_number} -->\n\n{text and markdown_page(text) or '_No extractable text on this page._'}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text("\n".join(chunks).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="Local PDF path")
    parser.add_argument("-o", "--output", type=Path, help="Markdown output path (default: sibling .md)")
    args = parser.parse_args()
    source = args.pdf.expanduser().resolve()
    if not source.is_file():
        parser.error(f"PDF does not exist: {source}")
    destination = (args.output or source.with_suffix(".md")).expanduser().resolve()
    convert(source, destination)
    print(f"Converted {source.name}: {destination.stat().st_size:,} bytes -> {destination}")


if __name__ == "__main__":
    main()

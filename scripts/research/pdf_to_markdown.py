#!/usr/bin/env python3
"""Extract searchable, page-addressable text from an academic PDF."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

try:
    import fitz
except ImportError:
    raise SystemExit(
        "PyMuPDF is required. Install it with: python -m pip install PyMuPDF"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract PDF text to Markdown with page markers for source checking."
    )
    parser.add_argument("pdf", type=Path, help="Source PDF")
    parser.add_argument("-o", "--output", type=Path, help="Output Markdown path")
    parser.add_argument(
        "--force", action="store_true", help="Replace an existing output file"
    )
    args = parser.parse_args()

    source = args.pdf.expanduser().resolve()
    if not source.is_file():
        parser.error(f"PDF not found: {source}")

    output = (args.output or source.with_suffix(".md")).expanduser().resolve()
    if output == source:
        parser.error("Output path must differ from the source PDF")
    if output.exists() and not args.force:
        parser.error(f"Output already exists; pass --force to replace it: {output}")

    try:
        document = fitz.open(source)
    except Exception as exc:  # PyMuPDF exposes several format-specific exceptions.
        parser.error(f"Could not open PDF: {exc}")

    title = document.metadata.get("title") or source.stem
    pages: list[str] = []
    extracted = 0
    for number, page in enumerate(document, start=1):
        text = page.get_text("text", sort=True).replace("\x00", "").strip()
        if text:
            extracted += 1
            content = text
        else:
            content = "（本页没有可提取文本；可能是扫描页，需要 OCR。）"
        pages.append(f"<!-- page: {number} -->\n\n{content}")

    if extracted == 0:
        parser.error("No selectable text found; this PDF may require OCR")

    markdown = (
        f"# {title}\n\n"
        f"Source PDF: `{source.name}`\n\n"
        f"Pages: {len(document)} · Text pages: {extracted}\n\n"
        "> Searchable reading copy. Multi-column order, tables, equations and figures "
        "may need checking against the PDF.\n\n"
        + "\n\n---\n\n".join(pages)
        + "\n"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown, encoding="utf-8", newline="\n")
    print(f"Wrote {output} ({len(document)} pages, {extracted} with text)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

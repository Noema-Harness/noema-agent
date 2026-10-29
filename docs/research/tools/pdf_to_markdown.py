"""Extract a searchable, page-preserving Markdown copy of a research PDF.

The original PDF remains the source of truth for layout, tables, equations,
figures, and any passages whose reading order matters.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

try:
    import fitz
except ImportError as exc:  # pragma: no cover - environment-specific hint
    raise SystemExit(
        "PyMuPDF is required. Install it in the active Python environment with: "
        "python -m pip install pymupdf"
    ) from exc


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create page-separated Markdown text for searching a PDF."
    )
    parser.add_argument("pdf", type=Path, help="Input PDF path")
    parser.add_argument(
        "--output", "-o", type=Path,
        help="Output Markdown path (defaults to <pdf-name>.md beside the PDF)",
    )
    args = parser.parse_args()

    pdf_path = args.pdf.expanduser().resolve()
    if not pdf_path.is_file():
        parser.error(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        parser.error(f"Expected a .pdf file: {pdf_path}")

    output_path = (args.output or pdf_path.with_suffix(".md")).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    document = fitz.open(pdf_path)
    metadata = document.metadata or {}
    title = (metadata.get("title") or "").strip() or pdf_path.stem
    author = (metadata.get("author") or "").strip()

    sections = [
        f"# {title}",
        "",
        f"- Source PDF: `{pdf_path}`",
        f"- SHA-256: `{digest}`",
        f"- Pages: {len(document)}",
    ]
    if author:
        sections.append(f"- PDF metadata author: {author}")
    sections.extend([
        "",
        "> Searchable text copy. Verify layout-sensitive evidence in the source PDF.",
    ])

    extracted_pages = 0
    for page_number, page in enumerate(document, start=1):
        # sort=True gives a useful reading order for common single-column PDFs.
        # Multi-column pages still need visual checking against the PDF.
        text = page.get_text("text", sort=True).strip()
        if text:
            extracted_pages += 1
        else:
            text = "[No selectable text extracted. The page may require OCR.]"
        sections.extend(["", f"## Page {page_number}", "", text])

    output_path.write_text("\n".join(sections) + "\n", encoding="utf-8")
    print(f"Markdown: {output_path}")
    print(f"Pages with selectable text: {extracted_pages}/{len(document)}")
    print(f"Source SHA-256: {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

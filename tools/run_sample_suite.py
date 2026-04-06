import argparse
import asyncio
import base64
import io
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import pdfplumber

from backend.server import (
    ExcelRequest,
    FormatConfirmation,
    detect_format_locally,
    download_excel,
    parse_transactions,
)


def load_text_fixture(path: Path) -> Tuple[str, int]:
    full_text = path.read_text(encoding="utf-8")
    total_pages = sum(1 for line in full_text.splitlines() if line.startswith("--- PAGE "))
    return full_text, max(total_pages, 1)


def load_pdf_fixture(path: Path, password: str = "") -> Tuple[str, int]:
    all_text: List[str] = []
    with path.open("rb") as handle:
        pdf_bytes = handle.read()
    with pdfplumber.open(io.BytesIO(pdf_bytes), password=password or None) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                all_text.append(f"--- PAGE {index} ---\n{text}")
        return "\n".join(all_text), len(pdf.pages)


def preview_from_full_text(full_text: str) -> str:
    preview_pages: List[str] = []
    current_page: List[str] = []
    page_count = 0
    for line in full_text.splitlines():
        if line.startswith("--- PAGE "):
            if current_page:
                preview_pages.append("\n".join(current_page))
                current_page = []
                page_count += 1
            if page_count >= 2:
                break
        current_page.append(line)
    if current_page and page_count < 2:
        preview_pages.append("\n".join(current_page))
    return "\n".join(preview_pages[:2])


async def save_excel_if_requested(
    destination: Path,
    transactions: List[dict],
    summary: dict,
) -> None:
    response = await download_excel(ExcelRequest(transactions=transactions, summary=summary))
    content = b""
    async for chunk in response.body_iterator:
        content += chunk
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)


async def run_case(path: Path, export_excel: bool, output_dir: Path) -> Dict[str, Any]:
    password_file = path.with_suffix(path.suffix + ".password")
    password = password_file.read_text(encoding="utf-8").strip() if password_file.exists() else ""

    if path.suffix.lower() == ".pdf":
        full_text, total_pages = load_pdf_fixture(path, password=password)
    else:
        full_text, total_pages = load_text_fixture(path)

    preview_text = preview_from_full_text(full_text)
    detected = detect_format_locally(preview_text)
    payload = FormatConfirmation(
        bank_name=detected.get("bank_name", "Unknown Bank"),
        columns=detected.get("columns", []),
        date_format=detected.get("date_format", "DD/MM/YYYY"),
        amount_style=detected.get("amount_style", "separate"),
        currency_symbol=detected.get("currency_symbol", "₹"),
        full_text=base64.b64encode(full_text.encode("utf-8")).decode("utf-8"),
        total_pages=total_pages,
    )
    result = await parse_transactions(payload)

    export_path = None
    if export_excel and result["transactions"]:
        export_path = output_dir / f"{path.stem}_export.xlsx"
        await save_excel_if_requested(export_path, result["transactions"], result["summary"])

    return {
        "file": str(path),
        "detected_format": detected,
        "summary": result["summary"],
        "confidence": result.get("confidence", {}),
        "errors": result["errors"],
        "export_path": str(export_path) if export_path else None,
    }


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run parser smoke tests on sample bank statements.")
    parser.add_argument(
        "--samples-dir",
        default="samples/synthetic",
        help="Folder containing .txt extracted-text fixtures and/or .pdf sample files.",
    )
    parser.add_argument(
        "--output",
        default="test_reports/sample_suite.json",
        help="Where to write the JSON report.",
    )
    parser.add_argument(
        "--export-excel",
        action="store_true",
        help="Also export .xlsx files for successful cases.",
    )
    args = parser.parse_args()

    samples_dir = Path(args.samples_dir)
    output_path = Path(args.output)
    fixtures = sorted(
        path
        for path in samples_dir.iterdir()
        if path.is_file() and path.suffix.lower() in {".txt", ".pdf"}
    )

    if not fixtures:
        raise SystemExit(f"No sample fixtures found in {samples_dir}")

    results: List[Dict[str, Any]] = []
    for fixture in fixtures:
        try:
            case_result = await run_case(
                path=fixture,
                export_excel=args.export_excel,
                output_dir=output_path.parent / "exports",
            )
            results.append(case_result)
        except Exception as exc:
            results.append(
                {
                    "file": str(fixture),
                    "error": str(exc),
                }
            )

    report = {
        "samples_dir": str(samples_dir),
        "case_count": len(results),
        "results": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote report to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())

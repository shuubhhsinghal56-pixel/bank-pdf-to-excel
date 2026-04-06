Synthetic parser fixtures for safe regression testing.

What these are:
- plain-text fixtures that mimic extracted PDF text
- no personal data
- shaped after common Indian bank layouts

How to run:
```bash
cd "/Users/shubh/Desktop/untitled folder/archive"
python3 tools/run_sample_suite.py --samples-dir samples/synthetic --output test_reports/sample_suite.json --export-excel
```

What the runner supports:
- `.txt` files containing extracted text with `--- PAGE N ---` markers
- `.pdf` files in the same folder if you later add redacted real samples
- optional password sidecar files named like `statement.pdf.password`

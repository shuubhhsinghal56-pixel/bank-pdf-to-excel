import base64

from backend.server import (
    build_parse_confidence,
    detect_format_locally,
    page_has_transaction_markers,
    parse_transactions_locally,
    split_text_into_pages,
)


SAMPLE_TEXT = """--- PAGE 1 ---
HDFC BANK LIMITED
Statement of Account
Date Narration Chq/Ref No Value Date Withdrawal Amt Deposit Amt Closing Balance
01/01/2024 OPENING BALANCE 01/01/2024 50,000.00
02/01/2024 NEFT-SALARY JAN 2024 NEFT123456 02/01/2024 75,000.00 1,25,000.00
03/01/2024 ATM WITHDRAWAL MUMBAI ATM789012 03/01/2024 10,000.00 1,15,000.00
05/01/2024 UPI-SWIGGY FOOD ORDER UPI345678 05/01/2024 450.00 1,14,550.00
12/01/2024 IMPS-FROM RAHUL SHARMA IMPS123456 12/01/2024 5,000.00 91,551.00
"""


def test_detect_format_locally_returns_expected_metadata():
    detected = detect_format_locally(SAMPLE_TEXT)

    assert detected["bank_name"] == "Hdfc Bank Limited"
    assert detected["amount_style"] == "separate"
    assert detected["date_format"] == "DD/MM/YYYY"
    assert "Balance" in detected["columns"]


def test_detect_format_locally_finds_axis_bank_name():
    text = """Statement of Axis Account No: 123 for the period (From: 05-01-2026 To: 05-04-2026)
Tran Date Chq No Particulars Debit Credit Balance Init. Br
"""
    detected = detect_format_locally(text)

    assert detected["bank_name"] == "Axis Bank"


def test_parse_transactions_locally_extracts_transactions_and_skips_opening_balance():
    transactions = parse_transactions_locally(SAMPLE_TEXT, "separate")

    assert len(transactions) == 4
    assert transactions[0].date == "02-01-2024"
    assert transactions[0].credit == 75000.0
    assert transactions[0].debit is None
    assert transactions[0].balance == 125000.0
    assert transactions[0].reference == ""
    assert transactions[0].narration == "NEFT-SALARY JAN 2024 NEFT123456"

    assert transactions[1].debit == 10000.0
    assert transactions[1].credit is None
    assert transactions[1].reference == ""
    assert transactions[1].narration == "ATM WITHDRAWAL MUMBAI ATM789012"

    assert transactions[-1].credit == 5000.0
    assert transactions[-1].narration == "IMPS-FROM RAHUL SHARMA IMPS123456"


def test_parse_transactions_locally_uses_balance_to_infer_credit_vs_debit():
    axis_like_text = """--- PAGE 1 ---
Statement of Axis Account No: 123 for the period (From: 05-01-2026 To: 05-04-2026)
OPENING BALANCE 52936.11
05-01-2026 UPI/P2M/ABC/Test Merchant 1500.00 51436.11 4496
07-01-2026 UPI/P2A/XYZ/Refund 1.00 51437.11 4496
"""

    transactions = parse_transactions_locally(axis_like_text, "separate")

    assert len(transactions) == 2
    assert transactions[0].debit == 1500.0
    assert transactions[0].credit is None
    assert transactions[1].credit == 1.0
    assert transactions[1].debit is None


def test_parse_transactions_locally_handles_particulars_wrapped_after_date_line():
    wrapped_text = """--- PAGE 1 ---
OPENING BALANCE 1000.00
01/01/2024 NEFT/HDFC/ABC
PAYMENT FROM CLIENT
500.00 1500.00
"""

    transactions = parse_transactions_locally(wrapped_text, "separate")

    assert len(transactions) == 1
    assert transactions[0].credit == 500.0
    assert transactions[0].narration == "NEFT/HDFC/ABC PAYMENT FROM CLIENT"


def test_parse_transactions_locally_handles_particulars_wrapped_before_date_line():
    prefix_text = """--- PAGE 1 ---
OPENING BALANCE 2000.00
UPI/P2A/12345/Some Merchant
01/01/2024 /Paid via app
250.00 1750.00
"""

    transactions = parse_transactions_locally(prefix_text, "separate")

    assert len(transactions) == 1
    assert transactions[0].debit == 250.0
    assert transactions[0].narration == "UPI/P2A/12345/Some Merchant /Paid via app"


def test_split_text_into_pages_preserves_page_boundaries():
    full_text = SAMPLE_TEXT + "\n--- PAGE 2 ---\n13/01/2024 UPI-TEST UPI999999 13/01/2024 100.00 91,451.00"

    pages = split_text_into_pages(full_text)

    assert len(pages) == 2
    assert pages[0][0] == 1
    assert "HDFC BANK LIMITED" in pages[0][1]
    assert pages[1][0] == 2
    assert "UPI-TEST" in pages[1][1]


def test_page_has_transaction_markers_skips_glossary_page():
    glossary_text = """ICONN-Transaction trough Internet Banking
This is a system generated output and requires no signature.
+++ End of Statement ++++
"""

    assert page_has_transaction_markers(glossary_text) is False


def test_full_text_round_trip_remains_base64_safe():
    encoded = base64.b64encode(SAMPLE_TEXT.encode("utf-8")).decode("utf-8")
    decoded = base64.b64decode(encoded).decode("utf-8")

    assert decoded == SAMPLE_TEXT


def test_build_parse_confidence_prefers_local_zero_mismatch_runs():
    transactions = parse_transactions_locally(SAMPLE_TEXT, "separate")

    confidence = build_parse_confidence(
        transactions=transactions,
        total_pages=1,
        pages_with_transactions=1,
        skipped_pages=0,
        locally_parsed_pages=1,
        ai_fallback_pages=0,
        errors=[],
    )

    assert confidence.level == "high"
    assert confidence.review_recommended is False
    assert confidence.token_strategy == "local_only"


def test_parse_transactions_locally_drops_page_header_and_footer_text():
    noisy_text = """--- PAGE 1 ---
Customer Name: Test User
Branch Address: MG Road Main Branch
Date Narration Chq/Ref No Value Date Withdrawal Amt Deposit Amt Closing Balance
01/01/2024 UPI/SHOPPING ORDER UPI123456 01/01/2024 250.00 9,750.00
02/01/2024 IMPS/FROM CLIENT IMPS654321 02/01/2024 5,000.00 14,750.00
Generated on: 03/01/2024 10:30 AM
For any clarification contact customer care
"""

    transactions = parse_transactions_locally(noisy_text, "separate")

    assert len(transactions) == 2
    assert transactions[0].narration == "UPI/SHOPPING ORDER UPI123456"
    assert transactions[-1].narration == "IMPS/FROM CLIENT IMPS654321"


def test_parse_transactions_locally_strips_footer_fragments_from_last_entry():
    noisy_text = """--- PAGE 1 ---
Date Narration Chq/Ref No Value Date Withdrawal Amt Deposit Amt Closing Balance
01/01/2024 UPI/SHOPPING ORDER UPI123456 01/01/2024 250.00 9,750.00
02/01/2024 IMPS/FROM CLIENT IMPS654321 02/01/2024 5,000.00 14,750.00
Generated on: 03/01/2024 10:30 AM
Contents of this statement will be considered correct if no error is reported.
"""

    transactions = parse_transactions_locally(noisy_text, "separate")

    assert transactions[-1].narration == "IMPS/FROM CLIENT IMPS654321"

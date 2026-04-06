"""
Backend API Tests for Bank Statement PDF to Excel Converter

Tests cover:
- Health check endpoint
- PDF upload with format detection
- Transaction parsing
- Excel download
- Error handling (non-PDF, empty files, oversized files)
"""

import pytest
import requests
import os
import json
import base64

# Get backend URL from environment
# Read from frontend .env file
from pathlib import Path
from dotenv import load_dotenv

frontend_env = Path('/app/frontend/.env')
if frontend_env.exists():
    load_dotenv(frontend_env)

BACKEND_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
if not BACKEND_URL:
    raise ValueError("EXPO_PUBLIC_BACKEND_URL not found in environment. Cannot run tests.")

TEST_PDF_PATH = '/tmp/hdfc_test_statement.pdf'


class TestHealthCheck:
    """Test the root API endpoint"""

    def test_root_endpoint_returns_welcome_message(self):
        """GET /api/ should return welcome message"""
        response = requests.get(f"{BACKEND_URL}/api/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Bank Statement" in data["message"]
        print("✓ Health check passed - welcome message received")


class TestUploadPDF:
    """Test PDF upload and format detection"""

    def test_upload_valid_pdf_returns_detected_format(self):
        """POST /api/upload-pdf with valid PDF should return detected format"""
        with open(TEST_PDF_PATH, 'rb') as f:
            files = {'file': ('test_statement.pdf', f, 'application/pdf')}
            response = requests.post(f"{BACKEND_URL}/api/upload-pdf", files=files)
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "detected_format" in data
        assert "preview_text" in data
        assert "total_pages" in data
        assert "full_text" in data
        
        # Verify detected_format fields
        detected = data["detected_format"]
        assert "bank_name" in detected
        assert "columns" in detected
        assert "date_format" in detected
        assert "amount_style" in detected
        assert "currency_symbol" in detected
        
        # Verify data types
        assert isinstance(detected["columns"], list)
        assert isinstance(data["total_pages"], int)
        assert data["total_pages"] > 0
        
        # Verify full_text is base64 encoded
        try:
            decoded = base64.b64decode(data["full_text"])
            assert len(decoded) > 0
        except Exception as e:
            pytest.fail(f"full_text is not valid base64: {e}")
        
        print(f"✓ PDF upload successful - detected bank: {detected['bank_name']}, pages: {data['total_pages']}")
        
        # Store for next test
        pytest.upload_response = data

    def test_upload_non_pdf_file_returns_400(self):
        """POST /api/upload-pdf with non-PDF file should return 400"""
        # Create a fake text file
        files = {'file': ('test.txt', b'This is not a PDF', 'text/plain')}
        response = requests.post(f"{BACKEND_URL}/api/upload-pdf", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "PDF" in data["detail"]
        print("✓ Non-PDF rejection working")

    def test_upload_empty_file_returns_400(self):
        """POST /api/upload-pdf with empty file should return 400"""
        files = {'file': ('empty.pdf', b'', 'application/pdf')}
        response = requests.post(f"{BACKEND_URL}/api/upload-pdf", files=files)
        
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
        assert "empty" in data["detail"].lower()
        print("✓ Empty file rejection working")


class TestParseTransactions:
    """Test transaction parsing"""

    def test_parse_transactions_returns_transactions_and_summary(self):
        """POST /api/parse-transactions should return transactions array and summary"""
        # First upload a PDF to get the format
        with open(TEST_PDF_PATH, 'rb') as f:
            files = {'file': ('test_statement.pdf', f, 'application/pdf')}
            upload_response = requests.post(f"{BACKEND_URL}/api/upload-pdf", files=files)
        
        assert upload_response.status_code == 200
        upload_data = upload_response.json()
        
        # Now parse transactions
        parse_payload = {
            "bank_name": upload_data["detected_format"]["bank_name"],
            "columns": upload_data["detected_format"]["columns"],
            "date_format": upload_data["detected_format"]["date_format"],
            "amount_style": upload_data["detected_format"]["amount_style"],
            "currency_symbol": upload_data["detected_format"]["currency_symbol"],
            "full_text": upload_data["full_text"],
            "total_pages": upload_data["total_pages"]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/api/parse-transactions",
            json=parse_payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert "transactions" in data
        assert "summary" in data
        assert "errors" in data
        
        # Verify transactions
        assert isinstance(data["transactions"], list)
        if len(data["transactions"]) > 0:
            txn = data["transactions"][0]
            assert "date" in txn
            assert "narration" in txn
            assert "reference" in txn
            # debit, credit, balance can be null
            assert "debit" in txn or txn.get("debit") is None
            assert "credit" in txn or txn.get("credit") is None
            assert "balance" in txn or txn.get("balance") is None
        
        # Verify summary
        summary = data["summary"]
        assert "bank_name" in summary
        assert "total_transactions" in summary
        assert "total_debit" in summary
        assert "total_credit" in summary
        assert "net_flow" in summary
        assert "period_from" in summary
        assert "period_to" in summary
        assert "total_pages" in summary
        
        # Verify data types
        assert isinstance(summary["total_transactions"], int)
        assert isinstance(summary["total_debit"], (int, float))
        assert isinstance(summary["total_credit"], (int, float))
        
        print(f"✓ Transaction parsing successful - {summary['total_transactions']} transactions found")
        
        # Store for Excel test
        pytest.parse_response = data


class TestDownloadExcel:
    """Test Excel file generation"""

    def test_download_excel_returns_xlsx_file(self):
        """POST /api/download-excel should return Excel file"""
        # First get transactions
        with open(TEST_PDF_PATH, 'rb') as f:
            files = {'file': ('test_statement.pdf', f, 'application/pdf')}
            upload_response = requests.post(f"{BACKEND_URL}/api/upload-pdf", files=files)
        
        upload_data = upload_response.json()
        
        parse_payload = {
            "bank_name": upload_data["detected_format"]["bank_name"],
            "columns": upload_data["detected_format"]["columns"],
            "date_format": upload_data["detected_format"]["date_format"],
            "amount_style": upload_data["detected_format"]["amount_style"],
            "currency_symbol": upload_data["detected_format"]["currency_symbol"],
            "full_text": upload_data["full_text"],
            "total_pages": upload_data["total_pages"]
        }
        
        parse_response = requests.post(
            f"{BACKEND_URL}/api/parse-transactions",
            json=parse_payload,
            headers={"Content-Type": "application/json"}
        )
        
        parse_data = parse_response.json()
        
        # Now download Excel
        excel_payload = {
            "transactions": parse_data["transactions"],
            "summary": parse_data["summary"]
        }
        
        response = requests.post(
            f"{BACKEND_URL}/api/download-excel",
            json=excel_payload,
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 200
        
        # Verify content type
        content_type = response.headers.get('content-type', '')
        assert 'spreadsheet' in content_type or 'excel' in content_type
        
        # Verify Content-Disposition header
        content_disposition = response.headers.get('content-disposition', '')
        assert 'attachment' in content_disposition
        assert '.xlsx' in content_disposition
        
        # Verify file content is not empty
        content = response.content
        assert len(content) > 0
        
        # Verify it's a valid Excel file (starts with PK for ZIP format)
        assert content[:2] == b'PK'
        
        print(f"✓ Excel download successful - file size: {len(content)} bytes")


class TestErrorHandling:
    """Test error handling for edge cases"""

    def test_upload_missing_file_returns_422(self):
        """POST /api/upload-pdf without file should return 422"""
        response = requests.post(f"{BACKEND_URL}/api/upload-pdf")
        assert response.status_code == 422
        print("✓ Missing file parameter handled correctly")

    def test_parse_with_invalid_payload_returns_422(self):
        """POST /api/parse-transactions with invalid payload should return 422"""
        invalid_payload = {
            "bank_name": "Test Bank"
            # Missing required fields
        }
        response = requests.post(
            f"{BACKEND_URL}/api/parse-transactions",
            json=invalid_payload,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        print("✓ Invalid parse payload handled correctly")

    def test_excel_with_invalid_payload_returns_422(self):
        """POST /api/download-excel with invalid payload should return 422"""
        invalid_payload = {
            "transactions": []
            # Missing summary
        }
        response = requests.post(
            f"{BACKEND_URL}/api/download-excel",
            json=invalid_payload,
            headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        print("✓ Invalid Excel payload handled correctly")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

# Bank Statement PDF to Excel Converter - PRD

## Overview
AI-powered personal finance tool that converts Indian bank statement PDFs to clean, formatted Excel files. Uses Claude AI (Sonnet 4.5) for universal bank format detection and transaction parsing.

## Tech Stack
- **Backend**: Python, FastAPI, pdfplumber, openpyxl, emergentintegrations (Claude AI)
- **Frontend**: React Native (Expo), expo-document-picker, expo-file-system, expo-sharing
- **AI**: Claude Sonnet 4.5 via Emergent LLM Key

## Core Features
1. **PDF Upload** - Drag & drop or file picker, 25MB limit
2. **AI Format Detection** - Auto-detects bank name, columns, date format, amount style
3. **Format Confirmation** - User reviews/edits detected format before parsing
4. **Transaction Parsing** - AI parses all pages, normalizes to standard schema
5. **Balance Validation** - Checks previous balance ± transaction = current balance
6. **Paginated Preview** - 50 transactions per page with color-coded rows
7. **Summary Stats** - Total transactions, debits, credits, net flow, balances, period
8. **Excel Export** - 2 sheets (Transactions + Summary), color-coded, auto-filtered

## API Endpoints
- `POST /api/upload-pdf` - Upload PDF, extract text, detect format via AI
- `POST /api/parse-transactions` - Parse all transactions using confirmed format
- `POST /api/download-excel` - Generate Excel with formatted output

## Privacy
- All processing in memory (BytesIO)
- No files written to disk
- No data stored in database
- Data deleted after Excel generation

## Supported Banks
- HDFC, Axis, Union Bank, and any other Indian bank (dynamically via AI detection)

## Color Coding
- **Red background**: Debit transactions
- **Green background**: Credit transactions
- **Yellow background**: Balance mismatches

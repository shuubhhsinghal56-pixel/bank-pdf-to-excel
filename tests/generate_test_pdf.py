"""Generate a sample HDFC bank statement PDF for testing."""
import io
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

def create_hdfc_statement():
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = []

    # Header
    elements.append(Paragraph("HDFC BANK LIMITED", styles['Title']))
    elements.append(Paragraph("Statement of Account", styles['Heading2']))
    elements.append(Spacer(1, 12))
    elements.append(Paragraph("Account No: XXXX1234 | Branch: Mumbai Main", styles['Normal']))
    elements.append(Paragraph("Statement Period: 01/01/2024 to 31/01/2024", styles['Normal']))
    elements.append(Spacer(1, 20))

    # Transaction table
    data = [
        ["Date", "Narration", "Chq/Ref No", "Value Date", "Withdrawal Amt", "Deposit Amt", "Closing Balance"],
        ["01/01/2024", "OPENING BALANCE", "", "01/01/2024", "", "", "50,000.00"],
        ["02/01/2024", "NEFT-SALARY JAN 2024", "NEFT123456", "02/01/2024", "", "75,000.00", "1,25,000.00"],
        ["03/01/2024", "ATM WITHDRAWAL MUMBAI", "ATM789012", "03/01/2024", "10,000.00", "", "1,15,000.00"],
        ["05/01/2024", "UPI-SWIGGY FOOD ORDER", "UPI345678", "05/01/2024", "450.00", "", "1,14,550.00"],
        ["07/01/2024", "NEFT-RENT PAYMENT JAN", "NEFT901234", "07/01/2024", "25,000.00", "", "89,550.00"],
        ["10/01/2024", "UPI-AMAZON PAY", "UPI567890", "10/01/2024", "2,999.00", "", "86,551.00"],
        ["12/01/2024", "IMPS-FROM RAHUL SHARMA", "IMPS123456", "12/01/2024", "", "5,000.00", "91,551.00"],
        ["15/01/2024", "ECS-ELECTRICITY BILL", "ECS789012", "15/01/2024", "3,200.00", "", "88,351.00"],
        ["17/01/2024", "UPI-BIGBASKET GROCERY", "UPI345123", "17/01/2024", "1,850.00", "", "86,501.00"],
        ["18/01/2024", "NEFT-FREELANCE PAYMENT", "NEFT567891", "18/01/2024", "", "15,000.00", "1,01,501.00"],
        ["20/01/2024", "ATM WITHDRAWAL PUNE", "ATM234567", "20/01/2024", "5,000.00", "", "96,501.00"],
        ["22/01/2024", "UPI-UBER RIDE", "UPI890123", "22/01/2024", "350.00", "", "96,151.00"],
        ["23/01/2024", "ECS-INSURANCE PREMIUM", "ECS456789", "23/01/2024", "8,500.00", "", "87,651.00"],
        ["25/01/2024", "UPI-ZOMATO FOOD ORDER", "UPI012345", "25/01/2024", "680.00", "", "86,971.00"],
        ["27/01/2024", "NEFT-DIVIDEND RECEIVED", "NEFT234567", "27/01/2024", "", "2,500.00", "89,471.00"],
        ["28/01/2024", "UPI-JIO RECHARGE", "UPI678901", "28/01/2024", "999.00", "", "88,472.00"],
        ["30/01/2024", "NEFT-MF SIP PAYMENT", "NEFT890123", "30/01/2024", "10,000.00", "", "78,472.00"],
        ["31/01/2024", "UPI-PETROL PUMP", "UPI234567", "31/01/2024", "3,500.00", "", "74,972.00"],
    ]

    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0B2447')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('FONTSIZE', (0, 1), (-1, -1), 7),
        ('ALIGN', (4, 1), (6, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8F9FA')]),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    elements.append(table)

    doc.build(elements)
    buffer.seek(0)
    return buffer

if __name__ == "__main__":
    pdf = create_hdfc_statement()
    with open("/tmp/hdfc_test_statement.pdf", "wb") as f:
        f.write(pdf.read())
    print("Created /tmp/hdfc_test_statement.pdf")

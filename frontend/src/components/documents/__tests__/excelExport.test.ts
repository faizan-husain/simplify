import { describe, it, expect } from 'vitest';
import { buildReportWorkbook, num } from '../excelExport';

describe('excelExport', () => {
  it('num helper parses numbers safely', () => {
    expect(num(100)).toBe(100);
    expect(num('250.75')).toBe(250.75);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num('')).toBe(0);
    expect(num('invalid')).toBe(0);
  });

  it('throws an error if no report data is provided', async () => {
    await expect(
      buildReportWorkbook({
        activeTab: 'invoices',
        reportTitle: 'Bills & Invoices Register',
        periodLabel: 'FY 2026-27',
        reportData: null,
      })
    ).rejects.toThrow('No report data available to export');
  });

  it('generates an excel workbook for invoices tab with luxury styling and headers', async () => {
    const mockReportData = {
      business: { name: 'Super Tech Xerox', mobile: '9876543210' },
      total_billed: 1500,
      total_paid: 1000,
      total_balance: 500,
      count: 1,
      rows: [
        {
          id: '1',
          number: '101',
          invoice_date: '2026-10-15',
          due_date: '2026-10-20',
          party_name: 'Rahul Sharma',
          party_mobile: '9876543210',
          subtotal: 1000,
          discount_amount: 0,
          total: 1000,
          paid_amount: 1000,
          balance: 0,
          status: 'PAID',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'invoices',
      reportTitle: 'Bills & Invoices Register',
      periodLabel: 'FY 2026-27',
      reportData: mockReportData,
      filename: 'Test-Bills.xlsx',
    });

    expect(result.actualFilename).toBe('Test-Bills.xlsx');
    expect(result.sheetName).toBe('Bills Register');
    const ws = result.workbook.getWorksheet('Bills Register');
    expect(ws).toBeDefined();

    // Check Row 1 business name
    const cellA1 = ws?.getCell('A1');
    expect(cellA1?.value).toBe('SUPER TECH XEROX');
    expect(cellA1?.font?.bold).toBe(true);

    // Check banner
    const banner = ws?.getCell('A3');
    expect(banner?.value).toContain('BILLS & INVOICES REGISTER');
    expect(banner?.fill).toBeDefined();
  });

  it('generates an excel workbook for PnL tab with summary and category breakdown', async () => {
    const mockPnlData = {
      business: { name: 'Super Tech Xerox' },
      income: 50000,
      payments: 15000,
      expenses: 10000,
      outgoing: 25000,
      net_profit: 25000,
      loans: { taken: 100000, principal_repaid: 20000, interest_paid: 2000 },
      monthly_trend: [
        { month: 'Oct 2026', income: 50000, outgoing: 25000, profit: 25000 },
      ],
      expense_categories: [{ category_name: 'Shop Rent', total: 8000 }],
      income_categories: [{ kind: 'INVOICE_PAYMENT', category: 'Services', total: 50000 }],
    };

    const result = await buildReportWorkbook({
      activeTab: 'pnl',
      reportTitle: 'Profit & Loss Statement',
      periodLabel: 'This FY (2026-27)',
      reportData: mockPnlData,
    });

    expect(result.sheetName).toBe('Profit & Loss');
    const ws = result.workbook.getWorksheet('Profit & Loss');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for customer ledger tab', async () => {
    const mockLedgerData = {
      business: { name: 'Super Tech Xerox' },
      total_opening_balance: 500,
      total_period_billed: 5000,
      total_period_paid: 4000,
      total_closing_due: 1500,
      customer_count: 1,
      rows: [
        {
          customer_name: 'Amit Patel',
          customer_mobile: '9876543210',
          customer_type: 'REGULAR',
          opening_balance: 500,
          period_billed: 5000,
          period_paid: 4000,
          closing_due: 1500,
          bill_count: 5,
          receipt_count: 3,
          advance: 0,
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'ledger',
      ledgerSubTab: 'customer',
      reportTitle: 'Customer Ledger & Balances',
      periodLabel: 'All Active Accounts',
      reportData: mockLedgerData,
    });

    expect(result.sheetName).toBe('Customer Ledger');
    const ws = result.workbook.getWorksheet('Customer Ledger');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for jobs tab with proper formatting', async () => {
    const mockJobsData = {
      business: { name: 'Super Tech Xerox' },
      count: 1,
      rows: [
        {
          job_type_name: 'Passport Application',
          party_name: 'Suresh Kumar',
          applicant_name: 'Suresh Kumar',
          assigned_staff_name: 'Vikram',
          invoice_number: '104',
          amount: 1500,
          deadline_date: '2026-11-10',
          status: 'IN_PROGRESS',
        },
      ],
    };

    const jobsResult = await buildReportWorkbook({
      activeTab: 'jobs',
      reportTitle: 'Job Tracking & Work Orders',
      periodLabel: 'FY 2026-27',
      reportData: mockJobsData,
    });
    expect(jobsResult.sheetName).toBe('Jobs Register');
    const ws = jobsResult.workbook.getWorksheet('Jobs Register');
    expect(ws).toBeDefined();

    // Verify non-sticky view (smooth natural scrolling, no frozen panes)
    expect(ws?.views?.[0]?.state).toBe('normal');

    // Verify Simplify signature block at the bottom
    let foundSignature = false;
    ws?.eachRow((row) => {
      const val = String(row.getCell(1).value || '');
      if (val.includes('SIMPLIFY BILLING SAAS')) {
        foundSignature = true;
      }
    });
    expect(foundSignature).toBe(true);
  });

  it('generates an excel workbook for receipts tab', async () => {
    const mockReceiptsData = {
      type: 'receipts',
      business: { name: 'Super Tech Xerox' },
      total_amount: 3500,
      count: 1,
      rows: [
        {
          number: '12',
          receipt_date: '2026-10-16',
          customer_name: 'Priya Sharma',
          kind: 'INVOICE_PAYMENT',
          income_category: 'Services',
          mode: 'UPI',
          reference: 'UPI-987654',
          amount: 3500,
          unallocated_amount: 0,
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'receipts',
      reportTitle: 'Receipts Register',
      periodLabel: 'FY 2026-27',
      reportData: mockReceiptsData,
    });
    expect(result.sheetName).toBe('Receipts Register');
    const ws = result.workbook.getWorksheet('Receipts Register');
    expect(ws).toBeDefined();

    // Verify headers row contains Receipt # and Amount
    let hasReceiptHeader = false;
    ws?.eachRow((row) => {
      const values = row.values as any[];
      if (Array.isArray(values) && values.includes('Receipt #') && values.includes('Amount')) {
        hasReceiptHeader = true;
      }
    });
    expect(hasReceiptHeader).toBe(true);
  });

  it('generates an excel workbook for vendor payments tab', async () => {
    const mockPaymentsData = {
      type: 'payments',
      business: { name: 'Super Tech Xerox' },
      total_amount: 4200,
      count: 1,
      rows: [
        {
          payment_date: '2026-10-18',
          vendor_name: 'Metro Stationery',
          description: 'A4 paper cartons',
          invoice_number: '102',
          mode: 'UPI',
          amount: 4200,
          notes: 'Delivered',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'payments',
      reportTitle: 'Vendor Payments',
      periodLabel: 'FY 2026-27',
      reportData: mockPaymentsData,
    });
    expect(result.sheetName).toBe('Vendor Payments');
    const ws = result.workbook.getWorksheet('Vendor Payments');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for overhead expenses tab', async () => {
    const mockExpensesData = {
      type: 'expenses',
      business: { name: 'Super Tech Xerox' },
      total_amount: 1500,
      count: 1,
      rows: [
        {
          expense_date: '2026-10-19',
          category_name: 'Electricity',
          payee: 'Adani Electricity',
          description: 'Oct bill',
          mode: 'BANK',
          amount: 1500,
          notes: 'Paid online',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'expenses',
      reportTitle: 'Expenses Register',
      periodLabel: 'FY 2026-27',
      reportData: mockExpensesData,
    });
    expect(result.sheetName).toBe('Expenses Register');
    const ws = result.workbook.getWorksheet('Expenses Register');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for outstanding dues tab', async () => {
    const mockOutstandingData = {
      type: 'outstanding',
      business: { name: 'Super Tech Xerox' },
      total_outstanding: 8500,
      total_overdue: 2000,
      customer_count: 1,
      rows: [
        {
          customer_name: 'Rohan Verma',
          customer_mobile: '9876543210',
          customer_type: 'REGULAR',
          total_billed: 15000,
          total_paid: 6500,
          balance: 8500,
          overdue_balance: 2000,
          oldest_invoice_date: '2026-09-01',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'outstanding',
      reportTitle: 'Outstanding Dues',
      periodLabel: 'FY 2026-27',
      reportData: mockOutstandingData,
    });
    expect(result.sheetName).toBe('Outstanding Dues');
    const ws = result.workbook.getWorksheet('Outstanding Dues');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for capital loans tab', async () => {
    const mockLoansData = {
      type: 'loans',
      business: { name: 'Super Tech Xerox' },
      total_taken: 50000,
      total_principal_repaid: 10000,
      total_outstanding: 40000,
      rows: [
        {
          lender_name: 'Apex Finance',
          loan_date: '2026-05-01',
          taken_amount: 50000,
          principal_repaid: 10000,
          interest_paid: 1500,
          current_outstanding: 40000,
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'loans',
      reportTitle: 'Capital Loans',
      periodLabel: 'FY 2026-27',
      reportData: mockLoansData,
    });
    expect(result.sheetName).toBe('Capital Loans');
    const ws = result.workbook.getWorksheet('Capital Loans');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for staff commission tab', async () => {
    const mockCommissionData = {
      type: 'commission',
      business: { name: 'Super Tech Xerox' },
      total_amount: 2500,
      count: 1,
      rows: [
        {
          staff_name: 'Anil Kumar',
          job_type_name: 'Passport Express',
          base_amount: 5000,
          percent: 50,
          amount: 2500,
          earned_at: '2026-10-20',
          status: 'EARNED',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'commission',
      reportTitle: 'Staff Commission',
      periodLabel: 'FY 2026-27',
      reportData: mockCommissionData,
    });
    expect(result.sheetName).toBe('Staff Commission');
    const ws = result.workbook.getWorksheet('Staff Commission');
    expect(ws).toBeDefined();
  });

  it('generates an excel workbook for vendor ledger tab', async () => {
    const mockVendorLedgerData = {
      party_type: 'VENDOR',
      business: { name: 'Super Tech Xerox' },
      total_paid: 25000,
      total_cash_paid: 10000,
      total_bank_paid: 15000,
      vendor_count: 1,
      rows: [
        {
          vendor_name: 'Global Paper Suppliers',
          vendor_mobile: '9876543210',
          cash_paid: 10000,
          bank_paid: 15000,
          total_paid: 25000,
          payment_count: 5,
          last_payment_date: '2026-10-22',
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'ledger',
      ledgerSubTab: 'vendor',
      reportTitle: 'Vendor Ledger',
      periodLabel: 'All Vendors',
      reportData: mockVendorLedgerData,
    });
    expect(result.sheetName).toBe('Vendor Ledger');
    const ws = result.workbook.getWorksheet('Vendor Ledger');
    expect(ws).toBeDefined();
  });

  it('intelligently uses reportData.type so switching tabs never mistakenly exports P&L', async () => {
    // Scenario: UI activeTab is still 'pnl' or out-of-sync, but reportData is 'receipts'
    const mockReceiptsData = {
      type: 'receipts',
      business: { name: 'Super Tech Xerox' },
      total_amount: 5000,
      count: 1,
      rows: [
        {
          number: '88',
          receipt_date: '2026-10-21',
          customer_name: 'Customer A',
          kind: 'INVOICE_PAYMENT',
          income_category: 'Services',
          mode: 'CASH',
          reference: '—',
          amount: 5000,
          unallocated_amount: 0,
        },
      ],
    };

    const result = await buildReportWorkbook({
      activeTab: 'pnl', // Even if activeTab says 'pnl'
      reportTitle: 'Report',
      periodLabel: 'FY 2026-27',
      reportData: mockReceiptsData,
    });

    // Must resolve to Receipts Register, NOT Profit & Loss!
    expect(result.sheetName).toBe('Receipts Register');
    const ws = result.workbook.getWorksheet('Receipts Register');
    expect(ws).toBeDefined();
  });
});

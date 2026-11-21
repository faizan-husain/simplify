import ExcelJS from 'exceljs';
import { formatDate } from '../../lib/dates';

export interface ExportReportExcelOptions {
  activeTab: string;
  ledgerSubTab?: 'customer' | 'vendor';
  reportTitle: string;
  periodLabel: string;
  reportData: any;
  filename?: string;
}

/**
 * Safely parse numbers so Excel treats them as actual numeric cells for formulas & sums.
 */
export function num(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// Convert column index (1-based) to Excel letter (A, B, ..., Z, AA, AB...)
function colToLetter(colIndex: number): string {
  let temp = colIndex;
  let letter = '';
  while (temp > 0) {
    const mod = (temp - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    temp = Math.floor((temp - mod) / 26);
  }
  return letter;
}

// Styling Constants for Luxury SaaS Theme
const FONT_FAMILY = 'Segoe UI';
const COLOR_BRAND_TEAL = 'FF0F766E';    // #0F766E (Primary Deep Teal)
const COLOR_DARK_INK = 'FF0F172A';      // #0F172A (Charcoal Body)
const COLOR_SLATE_HEADER = 'FF1E293B';  // #1E293B (Section Headers)
const COLOR_MUTED_TEXT = 'FF64748B';    // #64748B (Muted Gray)
const COLOR_ZEBRA_BG = 'FFF8FAFC';      // #F8FAFC (Subtle stripe)
const COLOR_CARD_HEADER = 'FFF1F5F9';   // #F1F5F9 (KPI header)
const COLOR_TOTAL_BG = 'FFF0FDFA';      // #F0FDFA (Light Mint/Teal total row)
const COLOR_BORDER = 'FFE2E8F0';        // #E2E8F0 (Subtle border)
const COLOR_WHITE = 'FFFFFFFF';
const COLOR_EMERALD = 'FF059669';       // #059669
const COLOR_ROSE = 'FFE11D48';          // #E11D48
const COLOR_AMBER = 'FFD97706';         // #D97706

const BORDER_THIN = {
  top: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
  left: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
  bottom: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
  right: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
};

const BORDER_TOTAL = {
  top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
  bottom: { style: 'double' as const, color: { argb: COLOR_BRAND_TEAL } },
  right: { style: 'thin' as const, color: { argb: COLOR_BORDER } },
};

const NUM_FMT_CURRENCY = '[$₹-en-IN] #,##0.00;[Red]-[$₹-en-IN] #,##0.00;"₹"0.00';
const NUM_FMT_INT = '#,##0';

/**
 * Generates an ExcelJS Workbook object configured with Luxury Quiet SaaS styling.
 */
export async function buildReportWorkbook({
  activeTab,
  ledgerSubTab = 'customer',
  reportTitle,
  periodLabel,
  reportData,
  filename,
}: ExportReportExcelOptions): Promise<{
  workbook: ExcelJS.Workbook;
  sheetName: string;
  actualFilename: string;
}> {
  if (!reportData) {
    throw new Error('No report data available to export');
  }

  const bizName = reportData.business?.name || 'SIMPLIFY BILLING SAAS';
  const bizAddress = reportData.business?.address || '';
  const bizPhone = reportData.business?.mobile || '';
  const bizUPI = reportData.business?.upi_id || '';

  // Intelligently infer targetTab from reportData if available, so exported data matches the actual payload
  let targetTab = (activeTab || '').toLowerCase();
  let targetSubTab = ledgerSubTab || 'customer';

  if (reportData.party_type === 'CUSTOMER') {
    targetTab = 'ledger';
    targetSubTab = 'customer';
  } else if (reportData.party_type === 'VENDOR') {
    targetTab = 'ledger';
    targetSubTab = 'vendor';
  } else if (reportData.type) {
    const rType = String(reportData.type).toLowerCase();
    if (rType === 'customer_ledger') {
      targetTab = 'ledger';
      targetSubTab = 'customer';
    } else if (rType === 'vendor_ledger') {
      targetTab = 'ledger';
      targetSubTab = 'vendor';
    } else {
      targetTab = rType;
    }
  }

  const actualFilename =
    filename ||
    `Report-${targetTab === 'ledger' ? targetSubTab : targetTab}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  let sheetName = 'Report';
  if (targetTab === 'pnl') sheetName = 'Profit & Loss';
  else if (targetTab === 'ledger') sheetName = targetSubTab === 'customer' ? 'Customer Ledger' : 'Vendor Ledger';
  else if (targetTab === 'invoices') sheetName = 'Bills Register';
  else if (targetTab === 'receipts') sheetName = 'Receipts Register';
  else if (targetTab === 'payments') sheetName = 'Vendor Payments';
  else if (targetTab === 'expenses') sheetName = 'Expenses Register';
  else if (targetTab === 'outstanding') sheetName = 'Outstanding Dues';
  else if (targetTab === 'loans') sheetName = 'Capital Loans';
  else if (targetTab === 'jobs') sheetName = 'Jobs Register';
  else if (targetTab === 'commission') sheetName = 'Staff Commission';

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIMPLIFY SaaS';
  workbook.lastModifiedBy = 'SIMPLIFY SaaS';
  workbook.created = new Date();
  workbook.modified = new Date();

  const ws = workbook.addWorksheet(sheetName.slice(0, 31), {
    views: [{ showGridLines: true }],
  });

  // Collect table definitions based on targetTab
  let tableHeaders: string[] = [];
  let tableRows: any[][] = [];
  let kpiMetrics: { label: string; value: number | string; isCurrency?: boolean }[] = [];
  let numAlignments: ('left' | 'center' | 'right')[] = [];
  let isCurrencyCol: boolean[] = [];
  let isNumericCol: boolean[] = [];

  if (targetTab === 'pnl') {
    kpiMetrics = [
      { label: 'Total Income (Receipts)', value: num(reportData.income), isCurrency: true },
      { label: 'Vendor Payments', value: num(reportData.payments), isCurrency: true },
      { label: 'Operating Expenses', value: num(reportData.expenses), isCurrency: true },
      { label: 'Total Outgoing', value: num(reportData.outgoing), isCurrency: true },
      { label: 'Net Profit (Cash Basis)', value: num(reportData.net_profit), isCurrency: true },
    ];
    if (reportData.loans) {
      kpiMetrics.push(
        { label: 'Outside Loans Taken', value: num(reportData.loans.taken), isCurrency: true },
        { label: 'Outside Principal Repaid', value: num(reportData.loans.principal_repaid), isCurrency: true },
        { label: 'Loan Interest Paid', value: num(reportData.loans.interest_paid), isCurrency: true }
      );
    }

    tableHeaders = ['Period / Month', 'Income', 'Outgoing', 'Net Profit'];
    numAlignments = ['left', 'right', 'right', 'right'];
    isCurrencyCol = [false, true, true, true];
    isNumericCol = [false, true, true, true];

    (reportData.monthly_trend || []).forEach((m: any) => {
      tableRows.push([m.month, num(m.income), num(m.outgoing), num(m.profit)]);
    });
  } else if (targetTab === 'ledger') {
    if (targetSubTab === 'customer') {
      kpiMetrics = [
        { label: 'Total Opening Balance', value: num(reportData.total_opening_balance), isCurrency: true },
        { label: 'Total Period Billed', value: num(reportData.total_period_billed), isCurrency: true },
        { label: 'Total Period Received', value: num(reportData.total_period_paid), isCurrency: true },
        { label: 'Total Net Closing Dues', value: num(reportData.total_closing_due), isCurrency: true },
        { label: 'Active Customers Count', value: num(reportData.customer_count || reportData.rows?.length) },
      ];

      tableHeaders = [
        'Customer Name',
        'Mobile',
        'Customer Type',
        'Opening Balance',
        'Period Billed (+)',
        'Period Received (-)',
        'Closing Due',
        'Bills Count',
        'Receipts Count',
        'Customer Advance',
      ];
      numAlignments = ['left', 'center', 'center', 'right', 'right', 'right', 'right', 'center', 'center', 'right'];
      isCurrencyCol = [false, false, false, true, true, true, true, false, false, true];
      isNumericCol = [false, false, false, true, true, true, true, true, true, true];

      (reportData.rows || []).forEach((r: any) => {
        tableRows.push([
          r.customer_name || 'Walk-in',
          r.customer_mobile || '—',
          r.customer_type || 'REGULAR',
          num(r.opening_balance),
          num(r.period_billed),
          num(r.period_paid),
          num(r.closing_due),
          num(r.bill_count),
          num(r.receipt_count),
          num(r.advance),
        ]);
      });
    } else {
      kpiMetrics = [
        { label: 'Total Paid to Vendors', value: num(reportData.total_paid), isCurrency: true },
        { label: 'Cash Paid', value: num(reportData.total_cash_paid), isCurrency: true },
        { label: 'Bank / Online Paid', value: num(reportData.total_bank_paid), isCurrency: true },
        { label: 'Active Suppliers Count', value: num(reportData.vendor_count || reportData.rows?.length) },
      ];

      tableHeaders = ['Vendor Name', 'Mobile', 'Cash Paid', 'Bank Paid', 'Total Paid', 'Txns Count', 'Last Payment Date'];
      numAlignments = ['left', 'center', 'right', 'right', 'right', 'center', 'center'];
      isCurrencyCol = [false, false, true, true, true, false, false];
      isNumericCol = [false, false, true, true, true, true, false];

      (reportData.rows || []).forEach((r: any) => {
        tableRows.push([
          r.vendor_name,
          r.vendor_mobile || '—',
          num(r.cash_paid),
          num(r.bank_paid),
          num(r.total_paid),
          num(r.payment_count),
          r.last_payment_date ? formatDate(r.last_payment_date) : '—',
        ]);
      });
    }
  } else if (targetTab === 'invoices') {
    kpiMetrics = [
      { label: 'Total Billed Amount', value: num(reportData.total_billed), isCurrency: true },
      { label: 'Total Paid Amount', value: num(reportData.total_paid), isCurrency: true },
      { label: 'Total Balance Due', value: num(reportData.total_balance), isCurrency: true },
      { label: 'Total Bills Count', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = [
      'Bill #',
      'Date',
      'Due Date',
      'Party / Customer',
      'Mobile',
      'Subtotal',
      'Discount',
      'Total Amount',
      'Paid Amount',
      'Balance Due',
      'Status',
    ];
    numAlignments = ['center', 'center', 'center', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'center'];
    isCurrencyCol = [false, false, false, false, false, true, true, true, true, true, false];
    isNumericCol = [false, false, false, false, false, true, true, true, true, true, false];

    (reportData.rows || []).forEach((r: any) => {
      const status =
        r.status === 'CANCELLED'
          ? 'Cancelled'
          : num(r.balance) === 0
          ? 'Paid'
          : r.is_overdue
          ? 'Overdue'
          : 'Unpaid';

      tableRows.push([
        `#${r.number}`,
        formatDate(r.invoice_date),
        formatDate(r.due_date),
        r.party_name || 'Walk-in',
        r.party_mobile || '—',
        num(r.subtotal),
        num(r.discount_amount),
        num(r.total),
        num(r.paid_amount),
        num(r.balance),
        status,
      ]);
    });
  } else if (targetTab === 'receipts') {
    kpiMetrics = [
      { label: 'Total Receipts Amount', value: num(reportData.total_amount), isCurrency: true },
      { label: 'Total Receipts Count', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = [
      'Receipt #',
      'Date',
      'Customer / Source',
      'Kind',
      'Income Category',
      'Payment Mode',
      'Reference / Txn ID',
      'Amount',
      'Unallocated (Advance)',
    ];
    numAlignments = ['center', 'center', 'left', 'center', 'left', 'center', 'center', 'right', 'right'];
    isCurrencyCol = [false, false, false, false, false, false, false, true, true];
    isNumericCol = [false, false, false, false, false, false, false, true, true];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        `#${r.number}`,
        formatDate(r.receipt_date),
        r.customer_name || 'Walk-in / Other',
        r.kind || 'INVOICE_PAYMENT',
        r.income_category || '—',
        r.mode || 'CASH',
        r.reference || '—',
        num(r.amount),
        num(r.unallocated_amount),
      ]);
    });
  } else if (targetTab === 'payments') {
    kpiMetrics = [
      { label: 'Total Vendor Payments', value: num(reportData.total_amount), isCurrency: true },
      { label: 'Total Payments Count', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = ['Payment Date', 'Vendor Name', 'Description', 'Linked Bill #', 'Mode', 'Amount', 'Notes'];
    numAlignments = ['center', 'left', 'left', 'center', 'center', 'right', 'left'];
    isCurrencyCol = [false, false, false, false, false, true, false];
    isNumericCol = [false, false, false, false, false, true, false];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        formatDate(r.payment_date),
        r.vendor_name,
        r.description || '—',
        r.invoice_number ? `#${r.invoice_number}` : '—',
        r.mode || 'CASH',
        num(r.amount),
        r.notes || '—',
      ]);
    });
  } else if (targetTab === 'expenses') {
    kpiMetrics = [
      { label: 'Total Overhead Expenses', value: num(reportData.total_amount), isCurrency: true },
      { label: 'Total Expenses Count', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = ['Date', 'Category', 'Payee', 'Description', 'Mode', 'Amount', 'Notes'];
    numAlignments = ['center', 'left', 'left', 'left', 'center', 'right', 'left'];
    isCurrencyCol = [false, false, false, false, false, true, false];
    isNumericCol = [false, false, false, false, false, true, false];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        formatDate(r.expense_date),
        r.category_name || 'General',
        r.payee || '—',
        r.description || '—',
        r.mode || 'CASH',
        num(r.amount),
        r.notes || '—',
      ]);
    });
  } else if (targetTab === 'outstanding') {
    kpiMetrics = [
      { label: 'Total Outstanding Balance', value: num(reportData.total_outstanding || reportData.total_balance), isCurrency: true },
      { label: 'Total Overdue Dues', value: num(reportData.total_overdue), isCurrency: true },
      { label: 'Debtors Count', value: num(reportData.customer_count || reportData.rows?.length) },
    ];

    tableHeaders = [
      'Customer Name',
      'Mobile',
      'Customer Type',
      'Total Billed',
      'Total Paid',
      'Balance Due',
      'Overdue Balance',
      'Oldest Bill Date',
    ];
    numAlignments = ['left', 'center', 'center', 'right', 'right', 'right', 'right', 'center'];
    isCurrencyCol = [false, false, false, true, true, true, true, false];
    isNumericCol = [false, false, false, true, true, true, true, false];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        r.customer_name || 'Walk-in',
        r.customer_mobile || '—',
        r.customer_type || 'REGULAR',
        num(r.total_billed),
        num(r.total_paid),
        num(r.balance),
        num(r.overdue_balance),
        r.oldest_invoice_date ? formatDate(r.oldest_invoice_date) : '—',
      ]);
    });
  } else if (targetTab === 'loans') {
    kpiMetrics = [
      { label: 'Total Loans Taken', value: num(reportData.total_taken), isCurrency: true },
      { label: 'Total Principal Repaid', value: num(reportData.total_principal_repaid), isCurrency: true },
      { label: 'Current Balance Outstanding', value: num(reportData.total_outstanding), isCurrency: true },
    ];

    tableHeaders = [
      'Lender Name',
      'Loan Date',
      'Taken Amount',
      'Principal Repaid',
      'Interest Paid',
      'Current Outstanding',
    ];
    numAlignments = ['left', 'center', 'right', 'right', 'right', 'right'];
    isCurrencyCol = [false, false, true, true, true, true];
    isNumericCol = [false, false, true, true, true, true];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        r.lender_name,
        formatDate(r.loan_date),
        num(r.taken_amount),
        num(r.principal_repaid),
        num(r.interest_paid),
        num(r.current_outstanding),
      ]);
    });
  } else if (targetTab === 'jobs') {
    kpiMetrics = [
      { label: 'Total Workflow Jobs', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = [
      'Job Type',
      'Customer / Party',
      'Applicant Name',
      'Assigned Staff',
      'Linked Bill #',
      'Amount',
      'Deadline Date',
      'Status',
    ];
    numAlignments = ['left', 'left', 'left', 'left', 'center', 'right', 'center', 'center'];
    isCurrencyCol = [false, false, false, false, false, true, false, false];
    isNumericCol = [false, false, false, false, false, true, false, false];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        r.job_type_name,
        r.party_name || 'Walk-in',
        r.applicant_name || '—',
        r.assigned_staff_name || 'Unassigned',
        r.invoice_number ? `#${r.invoice_number}` : '—',
        num(r.amount),
        formatDate(r.deadline_date),
        r.status || 'IN_PROGRESS',
      ]);
    });
  } else if (targetTab === 'commission') {
    kpiMetrics = [
      { label: 'Total Staff Commission', value: num(reportData.total_amount), isCurrency: true },
      { label: 'Commission Entries Count', value: num(reportData.count || reportData.rows?.length) },
    ];

    tableHeaders = [
      'Staff Member',
      'Job Type',
      'Job Base Amount',
      'Commission %',
      'Commission Amount',
      'Earned Date',
      'Status',
    ];
    numAlignments = ['left', 'left', 'right', 'center', 'right', 'center', 'center'];
    isCurrencyCol = [false, false, true, false, true, false, false];
    isNumericCol = [false, false, true, true, true, false, false];

    (reportData.rows || []).forEach((r: any) => {
      tableRows.push([
        r.staff_name,
        r.job_type_name,
        num(r.base_amount),
        `${num(r.percent)}%`,
        num(r.amount),
        r.earned_at ? formatDate(r.earned_at) : 'In Progress',
        r.status || 'UPCOMING',
      ]);
    });
  }

  const tableColCount = Math.max(tableHeaders.length, 4);

  // 1. Business Header Block (Row 1 & Row 2)
  const row1 = ws.addRow([bizName.toUpperCase()]);
  row1.height = 26;
  row1.getCell(1).font = { name: FONT_FAMILY, size: 15, bold: true, color: { argb: COLOR_DARK_INK } };
  row1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  const subDetails = [bizAddress, bizPhone ? `Phone: ${bizPhone}` : '', bizUPI ? `UPI: ${bizUPI}` : '']
    .filter(Boolean)
    .join('  •  ');
  const row2 = ws.addRow([subDetails || 'Verified Business Financial Record']);
  row2.height = 18;
  row2.getCell(1).font = { name: FONT_FAMILY, size: 9, color: { argb: COLOR_MUTED_TEXT } };
  row2.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  // 2. Report Banner Header (Row 3)
  const bannerRow = ws.addRow([`${reportTitle.toUpperCase()}  •  ${periodLabel.toUpperCase()}`]);
  bannerRow.height = 28;
  ws.mergeCells(3, 1, 3, tableColCount);
  const bannerCell = bannerRow.getCell(1);
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BRAND_TEAL } };
  bannerCell.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLOR_WHITE } };
  bannerCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  // Metadata Subtitle (Row 4) with Simplify Certification Mark
  const metaRow = ws.addRow([
    `Generated on: ${formatDate(new Date())}  •  Financial Period: ${periodLabel}  •  ⚡ SIMPLIFY Verified Statement`,
  ]);
  metaRow.height = 18;
  metaRow.getCell(1).font = { name: FONT_FAMILY, size: 8.5, italic: true, color: { argb: COLOR_MUTED_TEXT } };
  metaRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };

  // Blank row separator (Row 5)
  const blankRow5 = ws.addRow([]);
  blankRow5.height = 8;

  // 3. Executive KPI Cards Bar (Row 6: Labels, Row 7: Values)
  // Displayed horizontally across columns for clean, executive dashboard look
  if (kpiMetrics.length > 0) {
    const kpiLabelRow = ws.addRow([]);
    kpiLabelRow.height = 19;
    const kpiValRow = ws.addRow([]);
    kpiValRow.height = 24;

    const cardsToShow = kpiMetrics.slice(0, tableColCount);
    cardsToShow.forEach((metric, idx) => {
      const colIdx = idx + 1;

      // Label cell
      const lblCell = kpiLabelRow.getCell(colIdx);
      lblCell.value = metric.label.toUpperCase();
      lblCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CARD_HEADER } };
      lblCell.font = { name: FONT_FAMILY, size: 8, bold: true, color: { argb: COLOR_SLATE_HEADER } };
      lblCell.border = {
        top: { style: 'thin', color: { argb: COLOR_BORDER } },
        left: { style: 'thin', color: { argb: COLOR_BORDER } },
        right: { style: 'thin', color: { argb: COLOR_BORDER } },
      };
      lblCell.alignment = { vertical: 'middle', horizontal: metric.isCurrency ? 'right' : 'center' };

      // Value cell
      const valCell = kpiValRow.getCell(colIdx);
      valCell.value = metric.value;
      valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_WHITE } };
      valCell.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLOR_BRAND_TEAL } };
      valCell.border = {
        bottom: { style: 'medium', color: { argb: COLOR_BRAND_TEAL } },
        left: { style: 'thin', color: { argb: COLOR_BORDER } },
        right: { style: 'thin', color: { argb: COLOR_BORDER } },
      };
      valCell.alignment = { vertical: 'middle', horizontal: metric.isCurrency ? 'right' : 'center' };

      if (metric.isCurrency && typeof metric.value === 'number') {
        valCell.numFmt = NUM_FMT_CURRENCY;
      } else if (typeof metric.value === 'number') {
        valCell.numFmt = NUM_FMT_INT;
      }
    });

    const blankRowAfterKPI = ws.addRow([]);
    blankRowAfterKPI.height = 10;
  }

  // 4. Detailed Register Table Section
  const tableHeaderRowIndex = ws.rowCount + 1;
  const thRow = ws.addRow(tableHeaders);
  thRow.height = 26;

  tableHeaders.forEach((_, colIdx) => {
    const cell = thRow.getCell(colIdx + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_BRAND_TEAL } };
    cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_WHITE } };
    cell.alignment = { vertical: 'middle', horizontal: numAlignments[colIdx] || 'left' };
    cell.border = {
      top: { style: 'medium', color: { argb: COLOR_BRAND_TEAL } },
      bottom: { style: 'medium', color: { argb: COLOR_BRAND_TEAL } },
      left: { style: 'thin', color: { argb: 'FF0D645D' } },
      right: { style: 'thin', color: { argb: 'FF0D645D' } },
    };
  });

  const firstDataRowIndex = ws.rowCount + 1;

  // Data Rows
  tableRows.forEach((rowValues, rIdx) => {
    const row = ws.addRow(rowValues);
    row.height = 21;
    const isEven = rIdx % 2 === 0;
    const rowBg = isEven ? COLOR_WHITE : COLOR_ZEBRA_BG;

    rowValues.forEach((val, cIdx) => {
      const cell = row.getCell(cIdx + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.font = { name: FONT_FAMILY, size: 9, color: { argb: COLOR_DARK_INK } };
      cell.border = BORDER_THIN;
      cell.alignment = {
        vertical: 'middle',
        horizontal: numAlignments[cIdx] || 'left',
        indent: numAlignments[cIdx] === 'left' ? 1 : 0,
      };

      // Number Formatting
      if (isCurrencyCol[cIdx] && typeof val === 'number') {
        cell.numFmt = NUM_FMT_CURRENCY;
      } else if (typeof val === 'number') {
        cell.numFmt = NUM_FMT_INT;
      }

      // Status Highlighting
      if (typeof val === 'string') {
        const lower = val.toLowerCase();
        if (lower === 'paid' || lower === 'completed') {
          cell.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR_EMERALD } };
        } else if (lower === 'overdue' || lower === 'cancelled') {
          cell.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR_ROSE } };
        } else if (lower === 'unpaid' || lower === 'in_progress' || lower === 'upcoming') {
          cell.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR_AMBER } };
        }
      }
    });
  });

  const lastDataRowIndex = ws.rowCount;

  // 5. Grand Total / Summary Row (if table has rows and summable columns)
  if (tableRows.length > 0) {
    const totalRow = ws.addRow([]);
    totalRow.height = 24;

    tableHeaders.forEach((_, cIdx) => {
      const cell = totalRow.getCell(cIdx + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL_BG } };
      cell.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_DARK_INK } };
      cell.border = BORDER_TOTAL;
      cell.alignment = { vertical: 'middle', horizontal: numAlignments[cIdx] || 'left' };

      const colLetter = colToLetter(cIdx + 1);

      if (cIdx === 0) {
        cell.value = 'TOTAL';
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else if (isCurrencyCol[cIdx]) {
        cell.value = {
          formula: `SUM(${colLetter}${firstDataRowIndex}:${colLetter}${lastDataRowIndex})`,
        };
        cell.numFmt = NUM_FMT_CURRENCY;
      } else if (isNumericCol[cIdx]) {
        cell.value = {
          formula: `SUM(${colLetter}${firstDataRowIndex}:${colLetter}${lastDataRowIndex})`,
        };
        cell.numFmt = NUM_FMT_INT;
      } else {
        cell.value = '';
      }
    });
  }

  // 6. P&L Category Breakdowns (if present)
  if (targetTab === 'pnl') {
    if (reportData.expense_categories && reportData.expense_categories.length > 0) {
      ws.addRow([]);
      const expTitle = ws.addRow(['EXPENSES BREAKDOWN BY CATEGORY']);
      expTitle.getCell(1).font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_SLATE_HEADER } };

      const expHeader = ws.addRow(['Expense Category', 'Total Amount']);
      expHeader.height = 22;
      [1, 2].forEach((idx) => {
        const c = expHeader.getCell(idx);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CARD_HEADER } };
        c.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR_SLATE_HEADER } };
        c.border = BORDER_THIN;
        c.alignment = { vertical: 'middle', horizontal: idx === 1 ? 'left' : 'right' };
      });

      reportData.expense_categories.forEach((ec: any, idx: number) => {
        const r = ws.addRow([ec.category_name, num(ec.total)]);
        r.height = 20;
        const bg = idx % 2 === 0 ? COLOR_WHITE : COLOR_ZEBRA_BG;
        r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        r.getCell(1).font = { name: FONT_FAMILY, size: 9, color: { argb: COLOR_DARK_INK } };
        r.getCell(1).border = BORDER_THIN;
        r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

        const c2 = r.getCell(2);
        c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c2.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_DARK_INK } };
        c2.border = BORDER_THIN;
        c2.alignment = { vertical: 'middle', horizontal: 'right' };
        c2.numFmt = NUM_FMT_CURRENCY;
      });
    }

    if (reportData.income_categories && reportData.income_categories.length > 0) {
      ws.addRow([]);
      const incTitle = ws.addRow(['INCOME BREAKDOWN BY SOURCE']);
      incTitle.getCell(1).font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_SLATE_HEADER } };

      const incHeader = ws.addRow(['Income Kind', 'Category', 'Total Amount']);
      incHeader.height = 22;
      [1, 2, 3].forEach((idx) => {
        const c = incHeader.getCell(idx);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CARD_HEADER } };
        c.font = { name: FONT_FAMILY, size: 9, bold: true, color: { argb: COLOR_SLATE_HEADER } };
        c.border = BORDER_THIN;
        c.alignment = { vertical: 'middle', horizontal: idx <= 2 ? 'left' : 'right' };
      });

      reportData.income_categories.forEach((ic: any, idx: number) => {
        const r = ws.addRow([ic.kind, ic.category || 'General Services', num(ic.total)]);
        r.height = 20;
        const bg = idx % 2 === 0 ? COLOR_WHITE : COLOR_ZEBRA_BG;
        [1, 2].forEach((cIdx) => {
          const c = r.getCell(cIdx);
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
          c.font = { name: FONT_FAMILY, size: 9, color: { argb: COLOR_DARK_INK } };
          c.border = BORDER_THIN;
          c.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        });

        const c3 = r.getCell(3);
        c3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c3.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_DARK_INK } };
        c3.border = BORDER_THIN;
        c3.alignment = { vertical: 'middle', horizontal: 'right' };
        c3.numFmt = NUM_FMT_CURRENCY;
      });
    }
  }

  // 7. Official Simplify Verification & Signature Block
  ws.addRow([]); // Blank spacer row
  const sigRowIndex1 = ws.rowCount + 1;
  const sigRow1 = ws.addRow(['⚡ SIMPLIFY BILLING SAAS  •  OFFICIAL BUSINESS STATEMENT']);
  sigRow1.height = 24;
  ws.mergeCells(sigRowIndex1, 1, sigRowIndex1, tableColCount);
  const sigCell1 = sigRow1.getCell(1);
  sigCell1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_CARD_HEADER } };
  sigCell1.font = { name: FONT_FAMILY, size: 9.5, bold: true, color: { argb: COLOR_BRAND_TEAL } };
  sigCell1.alignment = { vertical: 'middle', horizontal: 'center' };
  sigCell1.border = {
    top: { style: 'thin', color: { argb: COLOR_BORDER } },
    left: { style: 'thin', color: { argb: COLOR_BORDER } },
    right: { style: 'thin', color: { argb: COLOR_BORDER } },
    bottom: { style: 'thin', color: { argb: COLOR_BORDER } },
  };

  const sigRowIndex2 = ws.rowCount + 1;
  const sigRow2 = ws.addRow([
    'Certified digital record generated via Simplify SaaS  •  Accurate Cash-Basis Accounting  •  www.simplifybilling.in  •  Confidential',
  ]);
  sigRow2.height = 18;
  ws.mergeCells(sigRowIndex2, 1, sigRowIndex2, tableColCount);
  const sigCell2 = sigRow2.getCell(1);
  sigCell2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ZEBRA_BG } };
  sigCell2.font = { name: FONT_FAMILY, size: 8, italic: true, color: { argb: COLOR_MUTED_TEXT } };
  sigCell2.alignment = { vertical: 'middle', horizontal: 'center' };
  sigCell2.border = {
    left: { style: 'thin', color: { argb: COLOR_BORDER } },
    right: { style: 'thin', color: { argb: COLOR_BORDER } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };

  // 8. Auto-fit column widths strictly based on table headers and table data rows
  tableHeaders.forEach((header, colIndex) => {
    let maxLen = header.length;

    // Scan ONLY table rows (from tableHeaderRowIndex to lastDataRowIndex)
    for (let r = tableHeaderRowIndex; r <= lastDataRowIndex; r++) {
      const row = ws.getRow(r);
      const cellVal = row.getCell(colIndex + 1).value;
      if (cellVal !== null && cellVal !== undefined) {
        let str = '';
        if (typeof cellVal === 'object') {
          // Formulas in totals row (e.g. { formula: 'SUM(...)' })
          str = header + ' 12345678';
        } else if (typeof cellVal === 'number' && isCurrencyCol[colIndex]) {
          str = `₹ ${cellVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        } else {
          str = String(cellVal);
        }
        if (str.length > maxLen) {
          maxLen = str.length;
        }
      }
    }

    // Set width: min 14 (18 for currency) so ### overflow never occurs, max 40, plus 4 chars padding
    const minWidth = isCurrencyCol[colIndex] ? 18 : 14;
    ws.getColumn(colIndex + 1).width = Math.min(Math.max(maxLen + 4, minWidth), 40);
  });

  // 9. Natural, smooth scrolling view (no sticky/frozen rows blocking the screen)
  ws.views = [
    {
      state: 'normal',
      showGridLines: true,
      activeCell: 'A1',
    },
  ];

  // 10. Printable page setup with Simplify header/footer watermark
  ws.headerFooter = {
    oddHeader: '&L&B&8SIMPLIFY BILLING SAAS&R&8&D',
    oddFooter: '&L&8Verified Business Statement · www.simplifybilling.in&C&8SIMPLIFY SAAS&R&8Page &P of &N',
  };

  return { workbook, sheetName, actualFilename };
}

/**
 * Export report data into a professional, luxury-grade Excel workbook (.xlsx) and download to client.
 */
export async function exportReportExcel(options: ExportReportExcelOptions): Promise<string> {
  const { workbook, actualFilename } = await buildReportWorkbook(options);

  // Write binary .xlsx buffer directly in browser
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = actualFilename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);

  return actualFilename;
}

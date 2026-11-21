// qa/fixtures/sentinels.ts
// Unique recognizable Owner-only sentinel values specified by PILOT AUDIT PROMPT §1.
// These must NEVER be visible or leaked in any payload, RPC, table or report accessed by Staff or cross-tenant actors.

export const SENTINELS = {
  EXPENSE_AMOUNT: 13579.13,
  EXPENSE_AMOUNT_STR: '13579.13',
  EXPENSE_DESC: 'SENTINEL-EXPENSE-OVERHEAD',
  LOAN_LENDER: 'SENTINEL-LOAN-LTD',
  LOAN_AMOUNT: 50000.00,
  BANK_NAME: 'SENTINEL-BANK ••7777',
  BANK_ACC_NUM: '••••7777',
  VENDOR_PAYMENT_AMOUNT: 24680.24,
  VENDOR_PAYMENT_AMOUNT_STR: '24680.24',
  VENDOR_NAME: 'SENTINEL-VENDOR-SUPPLIES',
  STAFF2_SALARY: 19191.00,
  STAFF2_SALARY_STR: '19191',
};

export const SENTINEL_SEARCH_TOKENS = [
  '13579.13',
  '13,579.13',
  'SENTINEL-EXPENSE-OVERHEAD',
  'SENTINEL-LOAN-LTD',
  'SENTINEL-BANK',
  '••••7777',
  'SENT0007777',
  '24680.24',
  '24,680.24',
  'SENTINEL-VENDOR',
  '19191',
];


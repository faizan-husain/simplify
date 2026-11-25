import { forwardRef } from 'react';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';

export interface ReceiptItem {
  id?: string;
  invoice_id?: string;
  invoice_number?: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  applicant_name?: string | null;
}

export interface ReceiptDocumentProps {
  receipt: {
    id?: string;
    number: string;
    receipt_date: string;
    fy_label?: string;
    amount: number;
    mode: string;
    reference?: string | null;
    kind: string;
    income_category?: string | null;
    unallocated_amount?: number;
    notes?: string | null;
    bank_name?: string | null;
  };
  customer?: {
    name: string;
    mobile?: string | null;
    type?: string | null;
    address?: string | null;
  } | null;
  items?: ReceiptItem[];
  allocations?: Array<{
    id?: string;
    invoice_id?: string;
    invoice_number: string;
    invoice_date: string;
    invoice_total: number;
    allocated_amount: number;
    invoice_balance?: number;
    items?: ReceiptItem[];
  }>;
  business?: {
    name: string;
    owner_name?: string | null;
    mobile?: string | null;
    email?: string | null;
    address?: string | null;
    upi_id?: string | null;
    receipt_header?: string | null;
    receipt_footer?: string | null;
  } | null;
  ledger_summary?: {
    previous_due: number;
    amount_paid: number;
    allocated_to_bills: number;
    remaining_due: number;
    customer_advance: number;
  } | null;
  format?: 'a5' | 'a4' | 'thermal58' | 'thermal80';
}

export const ReceiptDocument = forwardRef<HTMLDivElement, ReceiptDocumentProps>(
  ({ receipt, customer, items, allocations = [], ledger_summary, business, format = 'a5' }, ref) => {
    const isThermal = format === 'thermal58' || format === 'thermal80';
    const is58 = format === 'thermal58';

    // Collect all items across allocations or from the explicit items prop
    const allItems: ReceiptItem[] =
      items && items.length > 0
        ? items
        : allocations.flatMap((a) =>
            (a.items || []).map((it) => ({
              ...it,
              invoice_number: it.invoice_number || a.invoice_number,
            }))
          );

    // Thermal Format (58mm / 80mm)
    if (isThermal) {
      return (
        <div
          ref={ref}
          className={`bg-white text-black p-3 font-mono leading-tight mx-auto border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.02)] rounded-lg print:shadow-none print:border-none ${
            is58 ? 'w-[58mm] text-[9.5px]' : 'w-[80mm] text-[11px]'
          }`}
        >
          {/* Header */}
          <div className="text-center pb-2 border-b border-black">
            <div className="font-bold text-sm uppercase">{business?.name || 'SIMPLIFY'}</div>
            {business?.address && <div>{business.address}</div>}
            {business?.mobile && <div>Phone: {business.mobile}</div>}
            {business?.receipt_header && <div className="mt-0.5 italic">{business.receipt_header}</div>}
            <div className="font-bold text-xs mt-1.5 uppercase tracking-widest border border-black inline-block px-2 py-0.5">
              PAYMENT RECEIPT
            </div>
          </div>

          {/* Receipt Info */}
          <div className="py-2 border-b border-black text-[9.5px] space-y-0.5">
            <div className="flex justify-between">
              <span>Receipt: #{receipt.number}</span>
              <span>{formatDate(receipt.receipt_date)}</span>
            </div>
            {customer && (
              <div>
                <div className="break-words">Customer: {customer.name}</div>
                {customer.mobile && <div>Mobile: {customer.mobile}</div>}
              </div>
            )}
            <div className="flex justify-between">
              <span>Mode: {receipt.mode}</span>
              {receipt.bank_name && <span className="break-words">Bank: {receipt.bank_name}</span>}
            </div>
            {receipt.reference && <div className="break-words">Ref/Txn: {receipt.reference}</div>}
          </div>

          {/* Items & Particulars Breakdown (if present) */}
          {allItems.length > 0 && (
            <div className="py-2 border-b border-black space-y-1">
              <div className="flex justify-between font-bold border-b border-gray-300 pb-0.5 text-[9px]">
                <span>Item / Particulars</span>
                <span>Qty x Rate</span>
                <span>Amt</span>
              </div>
              {allItems.map((item, idx) => (
                <div key={idx} className="flex justify-between text-[9px]">
                  <span className="pr-1 break-words">
                    {item.description}
                    {item.applicant_name && ` (${item.applicant_name})`}
                  </span>
                  <span className="whitespace-nowrap">
                    {item.quantity} x {item.rate}
                  </span>
                  <span className="font-bold pl-1">{formatINR(item.amount)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Allocations Table */}
          {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 ? (
            <div className="py-2 border-b border-black space-y-1">
              <div className="flex justify-between font-bold border-b border-gray-300 pb-0.5 text-[9px]">
                <span>Bill #</span>
                <span>Total</span>
                <span>Paid</span>
              </div>
              {allocations.map((a, idx) => (
                <div key={idx} className="flex justify-between text-[9px]">
                  <span className="pr-1">#{a.invoice_number}</span>
                  <span className="text-gray-600">{formatINR(a.invoice_total)}</span>
                  <span className="font-bold">{formatINR(a.allocated_amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 border-b border-black text-[9.5px]">
              <div className="font-semibold">Category: {receipt.income_category || 'Other Income'}</div>
              {receipt.notes && <div className="text-gray-600">{receipt.notes}</div>}
            </div>
          )}

          {/* Totals & Dues Ledger Summary */}
          <div className="py-2 border-b border-black space-y-1 text-[9.5px]">
            {ledger_summary && (
              <div className="flex justify-between text-gray-700">
                <span>Total Balance Due:</span>
                <span className="font-semibold">{formatINR(ledger_summary.previous_due)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs font-bold pt-0.5 border-t border-dashed border-gray-300">
              <span>AMOUNT PAID:</span>
              <span>{formatINR(receipt.amount)}</span>
            </div>
            {ledger_summary && (
              <div className="flex justify-between text-[10.5px] font-black pt-0.5 border-t border-black">
                <span>REMAINING DUE:</span>
                <span className={ledger_summary.remaining_due > 0 ? 'text-black font-extrabold' : 'font-extrabold'}>
                  {formatINR(ledger_summary.remaining_due)}
                  {ledger_summary.remaining_due === 0 && ' (Cleared)'}
                </span>
              </div>
            )}
            {(receipt.unallocated_amount || ledger_summary?.customer_advance || 0) > 0 && (
              <div className="flex justify-between text-[9px] text-gray-700 font-bold border-t border-dashed border-gray-300 pt-0.5">
                <span>Customer Advance:</span>
                <span>+{formatINR(receipt.unallocated_amount || ledger_summary?.customer_advance || 0)}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center pt-2 text-[9px]">
            <div>{business?.receipt_footer || 'Thank you for your payment!'}</div>
          </div>

          {/* Simplify Brand Footer */}
          <div className="pt-1.5 mt-1 border-t border-dashed border-gray-400 text-center text-[8.5px] flex items-center justify-center gap-1 text-gray-600">
            <span>Powered by</span>
            <img src="/simplify-logo.png" alt="Simplify" className="h-3 w-auto object-contain inline-block filter grayscale" />
          </div>
        </div>
      );
    }

    // Professional A5 Format (148mm × 210mm, perfectly fits 2 prints per A4 sheet)
    return (
      <div
        ref={ref}
        className="bg-white text-slate-800 mx-auto border-0 shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.02)] rounded-xl print:shadow-none print:border-none print:mx-auto"
        style={{
          boxSizing: 'border-box',
          width: '148mm',
          maxWidth: '148mm',
          padding: '8mm 8mm 10mm 8mm',
          margin: '0 auto',
        }}
      >
        {/* Header Bar */}
        <div
          className="flex justify-between items-start pb-2.5 mb-2.5 gap-2"
          style={{ borderBottom: '1px solid #CBD5E1' }}
        >
          <div className="flex-1 min-w-0 pr-1">
            <h1 className="text-base font-bold text-text leading-normal">
              {business?.name || 'SIMPLIFY'}
            </h1>
            {business?.receipt_header && (
              <p className="text-[10px] font-medium text-text-muted mt-0.5 leading-normal whitespace-pre-line">
                {business.receipt_header}
              </p>
            )}
            {business?.address && (
              <p className="text-[10px] text-text-muted mt-0.5 leading-normal whitespace-pre-line">
                {business.address}
              </p>
            )}
            <div className="text-[9.5px] text-text-muted mt-0.5 flex flex-wrap gap-x-2 leading-normal">
              {business?.mobile && <span>Phone: {business.mobile}</span>}
              {business?.email && <span>• {business.email}</span>}
              {business?.upi_id && <span>• UPI: {business.upi_id}</span>}
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="flex items-center justify-end gap-1 mb-0.5">
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border-0 font-bold text-[9px] uppercase tracking-wider">
                PAYMENT RECEIPT
              </span>
            </div>
            <div className="text-xs font-bold text-text font-mono">#{receipt.number}</div>
            <div className="text-[9.5px] text-text-muted mt-0.5">
              Date: <strong className="text-text">{formatDate(receipt.receipt_date)}</strong>
            </div>
            {receipt.fy_label && (
              <div className="text-[9px] text-text-muted">FY: {receipt.fy_label}</div>
            )}
          </div>
        </div>

        {/* Payer and Payment Details Bar */}
        <div
          className="bg-[#EEF0F3] p-2.5 rounded-lg mb-2.5 flex items-center justify-between gap-2 text-[10px]"
          style={{ border: '1px solid #CBD5E1' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[8px] font-bold text-text-muted uppercase tracking-wider">
              Received From
            </div>
            <div className="font-bold text-xs text-text mt-0.5 leading-normal break-words">
              {customer ? customer.name : 'Direct / Walk-in Customer'}
            </div>
            {customer?.mobile && (
              <div className="text-[9px] font-mono text-text-muted leading-normal">Mobile: {customer.mobile}</div>
            )}
          </div>

          <div className="text-right shrink-0 space-y-0.5">
            <div className="text-[8px] font-bold text-text-muted uppercase tracking-wider">
              Payment Mode &amp; Details
            </div>
            <div className="flex items-center justify-end gap-1.5 text-[9.5px] mt-0.5">
              <span className="font-semibold text-slate-800 px-1.5 py-0.5 rounded bg-white border border-slate-300">
                {receipt.mode === 'BANK' ? 'Bank Transfer' : receipt.mode}
              </span>
              {receipt.bank_name && (
                <span className="text-slate-600 font-medium break-words">
                  ({receipt.bank_name})
                </span>
              )}
            </div>
            {receipt.reference && (
              <div className="text-[8.5px] text-slate-600 font-mono leading-normal">
                Ref: <strong className="text-slate-800 font-semibold">{receipt.reference}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Items & Particulars Table (Just like invoice bill) */}
        {allItems.length > 0 && (
          <div
            className="rounded-lg overflow-hidden mb-2.5"
            style={{ border: '1px solid #CBD5E1' }}
          >
            <table className="w-full text-left text-[10.5px] table-fixed border-collapse">
              <colgroup>
                <col style={{ width: '50%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead className="bg-[#F8FAFC] text-slate-600 uppercase text-[9px] font-semibold">
                <tr>
                  <th
                    className="px-3"
                    style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.3', borderBottom: '1px solid #CBD5E1' }}
                  >
                    Description &amp; Particulars
                  </th>
                  <th
                    className="px-1 text-center"
                    style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.3', borderBottom: '1px solid #CBD5E1' }}
                  >
                    Qty
                  </th>
                  <th
                    className="px-2 text-right"
                    style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.3', borderBottom: '1px solid #CBD5E1' }}
                  >
                    Rate
                  </th>
                  <th
                    className="px-3 text-right"
                    style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.3', borderBottom: '1px solid #CBD5E1' }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {allItems.map((item, idx) => {
                  const isLast = idx === allItems.length - 1;
                  const borderClass = isLast ? '' : 'border-b border-slate-200';
                  return (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td
                        className={`px-3 text-slate-800 break-words ${borderClass}`}
                        style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4' }}
                      >
                        <span className="font-medium">{item.description}</span>
                        {item.applicant_name && (
                          <span className="block text-[9.5px] text-slate-500 mt-0.5" style={{ lineHeight: '1.3' }}>
                            Particular: {item.applicant_name}
                          </span>
                        )}
                        {allocations.length > 1 && item.invoice_number && (
                          <span className="inline-block text-[8.5px] bg-slate-100 text-slate-600 px-1 py-0.5 rounded mt-0.5 font-mono">
                            Bill #{item.invoice_number}
                          </span>
                        )}
                      </td>
                      <td
                        className={`px-1 text-center text-slate-600 tabular-nums ${borderClass}`}
                        style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4' }}
                      >
                        {item.quantity}
                      </td>
                      <td
                        className={`px-2 text-right text-slate-600 tabular-nums whitespace-nowrap ${borderClass}`}
                        style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4' }}
                      >
                        {formatINR(item.rate)}
                      </td>
                      <td
                        className={`px-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap ${borderClass}`}
                        style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4' }}
                      >
                        {formatINR(item.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Allocations & Ledger Accounting Split Grid */}
        <div className="grid grid-cols-2 gap-3 items-start mb-2.5">
          {/* Left Column: Purpose & Allocation */}
          <div className="min-w-0">
            <div className="text-[8.5px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Purpose &amp; Bill Allocation
            </div>

            {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 ? (
              <div className="border border-slate-300 rounded-lg overflow-hidden bg-white">
                <table className="w-full text-left text-[9.5px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: '48%' }} />
                    <col style={{ width: '26%' }} />
                    <col style={{ width: '26%' }} />
                  </colgroup>
                  <thead className="bg-[#F8FAFC] text-slate-600 uppercase text-[8px] font-semibold">
                    <tr>
                      <th
                        className="px-2.5 border-b border-slate-300"
                        style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                      >
                        Bill #
                      </th>
                      <th
                        className="px-1.5 text-right border-b border-slate-300"
                        style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                      >
                        Total
                      </th>
                      <th
                        className="px-2.5 text-right border-b border-slate-300"
                        style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                      >
                        Paid
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {allocations.map((a, i) => {
                      const isLast = i === allocations.length - 1;
                      const borderClass = isLast ? '' : 'border-b border-slate-200';
                      return (
                        <tr key={i} className="hover:bg-slate-50/50">
                          <td
                            className={`px-2.5 text-slate-800 break-words ${borderClass}`}
                            style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                          >
                            <span className="font-semibold text-teal-800">#{a.invoice_number}</span>
                          </td>
                          <td
                            className={`px-1.5 text-right text-slate-600 tabular-nums whitespace-nowrap ${borderClass}`}
                            style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                          >
                            {formatINR(a.invoice_total)}
                          </td>
                          <td
                            className={`px-2.5 text-right font-bold text-emerald-700 tabular-nums whitespace-nowrap ${borderClass}`}
                            style={{ verticalAlign: 'middle', paddingTop: '6px', paddingBottom: '6px' }}
                          >
                            {formatINR(a.allocated_amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-[#F8FAFC] border border-slate-300 rounded-lg p-2.5 flex flex-col justify-center">
                <div className="text-[8px] text-slate-600 uppercase font-bold">Category</div>
                <div className="font-bold text-xs text-slate-800 mt-0.5 leading-normal">
                  {receipt.income_category || 'Other Business Income'}
                </div>
                {receipt.notes && (
                  <div className="text-[9px] text-slate-600 mt-1 leading-normal whitespace-pre-line">
                    {receipt.notes}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Amount Received & Ledger Summary */}
          <div className="bg-[#F8FAFC] p-2.5 rounded-lg border border-slate-300 space-y-1 text-[10px]">
            {ledger_summary && (
              <div className="flex justify-between items-center text-slate-600 text-[9.5px] py-0.5">
                <span>Total Due (Before)</span>
                <span className="font-medium text-slate-800 tabular-nums">{formatINR(ledger_summary.previous_due)}</span>
              </div>
            )}

            <div className="flex justify-between items-center text-xs font-bold pt-1.5 pb-0.5 border-t border-slate-300">
              <span>Amount Paid</span>
              <span className="text-emerald-700 font-extrabold tabular-nums text-xs">{formatINR(receipt.amount)}</span>
            </div>

            {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 && (
              <div className="flex justify-between items-center text-[9px] text-slate-600 py-0.5">
                <span>Allocated to Bills</span>
                <span className="font-medium text-slate-800 tabular-nums">
                  {formatINR(
                    allocations.reduce((sum, a) => sum + parseFloat(String(a.allocated_amount || 0)), 0)
                  )}
                </span>
              </div>
            )}

            {ledger_summary && (
              <div className="flex justify-between items-center text-[10.5px] font-bold pt-1.5 pb-0.5 border-t border-slate-300">
                <span>Remaining Due</span>
                <span
                  className={`tabular-nums ${
                    ledger_summary.remaining_due > 0 ? 'text-red-600' : 'text-emerald-700'
                  }`}
                >
                  {formatINR(ledger_summary.remaining_due)}
                  {ledger_summary.remaining_due === 0 && ' (Cleared)'}
                </span>
              </div>
            )}

            {(receipt.unallocated_amount || ledger_summary?.customer_advance || 0) > 0 && (
              <div className="flex justify-between items-center text-[9px] font-semibold text-teal-800 border-t border-teal-200/60 pt-1 pb-0.5">
                <span>Customer Advance</span>
                <span className="tabular-nums">
                  +{formatINR(receipt.unallocated_amount || ledger_summary?.customer_advance || 0)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Remarks if any */}
        {receipt.notes && receipt.kind === 'INVOICE_PAYMENT' && (
          <div className="mb-2.5 p-2 bg-amber-50/70 border border-amber-200/60 rounded text-[9px] text-amber-900 leading-normal">
            <span className="font-bold">Remarks: </span>
            {receipt.notes}
          </div>
        )}

        {/* Signatures & Footer Bar */}
        <div
          className="pt-2.5 flex justify-between items-end mb-2"
          style={{ borderTop: '1px solid #CBD5E1' }}
        >
          <div className="text-slate-500 text-[9px] space-y-0.5">
            <div className="font-semibold text-slate-700">{business?.receipt_footer || 'Thank you for your payment!'}</div>
            <div>Computer generated official receipt.</div>
          </div>

          <div className="text-center shrink-0">
            <div className="w-24 mb-0.5" style={{ borderBottom: '1px solid #CBD5E1' }}></div>
            <div className="text-[8.5px] font-bold text-slate-700">Authorized Signatory</div>
            <div className="text-[8px] text-slate-500">{business?.name}</div>
          </div>
        </div>

        {/* Simplify Software Small Logo & Brand Footer */}
        <div
          className="mt-3 pt-2.5 pb-1 flex items-center justify-between text-[8.5px] text-slate-500"
          style={{ borderTop: '1px solid #CBD5E1' }}
        >
          <div className="flex items-center gap-1.5">
            <span>Powered by</span>
            <img
              src="/simplify-logo.png"
              alt="Simplify"
              className="h-3.5 w-auto object-contain inline-block"
            />
          </div>
          <div className="text-[8px] text-text-muted font-medium">
            Business Management &amp; Billing Software
          </div>
        </div>
      </div>
    );
  }
);

ReceiptDocument.displayName = 'ReceiptDocument';

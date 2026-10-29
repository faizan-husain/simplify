import { forwardRef } from 'react';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';

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
  allocations?: Array<{
    id?: string;
    invoice_number: string;
    invoice_date: string;
    invoice_total: number;
    allocated_amount: number;
    invoice_balance?: number;
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
  format?: 'a4' | 'thermal58' | 'thermal80';
}

export const ReceiptDocument = forwardRef<HTMLDivElement, ReceiptDocumentProps>(
  ({ receipt, customer, allocations = [], business, format = 'a4' }, ref) => {
    const isThermal = format === 'thermal58' || format === 'thermal80';
    const is58 = format === 'thermal58';

    // Thermal Format (58mm / 80mm)
    if (isThermal) {
      return (
        <div
          ref={ref}
          className={`bg-white text-black p-3 font-mono leading-tight mx-auto border border-border shadow-xs print:shadow-none print:border-none ${
            is58 ? 'w-[58mm] text-[10px]' : 'w-[80mm] text-[11px]'
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
          <div className="py-2 border-b border-black text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span>Receipt: #{receipt.number}</span>
              <span>{formatDate(receipt.receipt_date)}</span>
            </div>
            {customer && (
              <div>
                <div>Customer: {customer.name}</div>
                {customer.mobile && <div>Mobile: {customer.mobile}</div>}
              </div>
            )}
            <div className="flex justify-between">
              <span>Mode: {receipt.mode}</span>
              {receipt.bank_name && <span>Bank: {receipt.bank_name}</span>}
            </div>
            {receipt.reference && <div>Ref/Txn: {receipt.reference}</div>}
          </div>

          {/* Allocations Table */}
          {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 ? (
            <div className="py-2 border-b border-black space-y-1">
              <div className="flex justify-between font-bold border-b border-gray-300 pb-0.5">
                <span>Bill # / Date</span>
                <span>Bill Amt</span>
                <span>Paid</span>
              </div>
              {allocations.map((a, idx) => (
                <div key={idx} className="flex justify-between text-[10px]">
                  <span>#{a.invoice_number} ({formatDate(a.invoice_date)})</span>
                  <span>{formatINR(a.invoice_total)}</span>
                  <span className="font-bold">{formatINR(a.allocated_amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 border-b border-black text-[10px]">
              <div className="font-semibold">Category: {receipt.income_category || 'Other Income'}</div>
              {receipt.notes && <div className="text-gray-600">{receipt.notes}</div>}
            </div>
          )}

          {/* Totals */}
          <div className="py-2 border-b border-black space-y-0.5 text-[10px]">
            <div className="flex justify-between text-xs font-bold pt-0.5">
              <span>TOTAL RECEIVED:</span>
              <span>{formatINR(receipt.amount)}</span>
            </div>
            {(receipt.unallocated_amount || 0) > 0 && (
              <div className="flex justify-between text-[9px] text-gray-700">
                <span>Customer Advance:</span>
                <span>{formatINR(receipt.unallocated_amount || 0)}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center pt-2 text-[9px]">
            <div>{business?.receipt_footer || 'Thank you for your payment!'}</div>
          </div>
        </div>
      );
    }

    // Standard A4 Format
    return (
      <div
        ref={ref}
        className="bg-white text-slate-800 p-8 w-[210mm] min-h-[297mm] mx-auto text-xs leading-relaxed font-sans shadow-md print:shadow-none print:w-full print:p-6"
      >
        {/* Header Bar */}
        <div className="flex justify-between items-start border-b-2 border-primary/20 pb-6 mb-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              {business?.name || 'SIMPLIFY'}
            </h1>
            {business?.address && (
              <p className="text-slate-600 text-xs max-w-sm">{business.address}</p>
            )}
            <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 pt-1">
              {business?.mobile && <span>Phone: {business.mobile}</span>}
              {business?.email && <span>Email: {business.email}</span>}
              {business?.upi_id && <span>UPI: {business.upi_id}</span>}
            </div>
          </div>

          <div className="text-right">
            <div className="inline-block bg-primary text-white font-black text-sm px-4 py-1.5 rounded-md tracking-wider uppercase mb-2">
              Payment Receipt
            </div>
            <div className="text-base font-bold text-slate-900">#{receipt.number}</div>
            <div className="text-xs text-slate-500 font-medium">Date: {formatDate(receipt.receipt_date)}</div>
            {receipt.fy_label && (
              <div className="text-[11px] text-slate-400">Financial Year: {receipt.fy_label}</div>
            )}
          </div>
        </div>

        {/* Payer and Payment Details */}
        <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200 mb-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Received From
            </div>
            {customer ? (
              <div className="space-y-0.5">
                <div className="font-bold text-slate-900 text-sm">{customer.name}</div>
                {customer.mobile && (
                  <div className="text-xs text-slate-600">Mobile: {customer.mobile}</div>
                )}
                {customer.address && (
                  <div className="text-xs text-slate-500">{customer.address}</div>
                )}
                <div className="text-[10px] inline-block px-2 py-0.5 mt-1 bg-white border border-slate-200 rounded text-slate-600 font-semibold">
                  {customer.type || 'Customer'}
                </div>
              </div>
            ) : (
              <div className="font-bold text-slate-900 text-sm">Direct / Walk-in Customer</div>
            )}
          </div>

          <div className="space-y-1.5 text-right sm:text-left">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              Payment Details
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Payment Mode:</span>
              <span className="font-bold text-slate-900 px-2 py-0.5 rounded bg-white border border-slate-200">
                {receipt.mode === 'BANK' ? '🏦 Bank Transfer' : receipt.mode === 'UPI' ? '📱 UPI' : receipt.mode}
              </span>
            </div>
            {receipt.bank_name && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Bank Account:</span>
                <span className="font-semibold text-slate-800">{receipt.bank_name}</span>
              </div>
            )}
            {receipt.reference && (
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Ref / Txn / Cheque #:</span>
                <span className="font-mono text-slate-900 font-bold">{receipt.reference}</span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Receipt Type:</span>
              <span className="text-slate-700 font-medium">
                {receipt.kind === 'OTHER_INCOME'
                  ? `Other Income (${receipt.income_category || 'General'})`
                  : 'Invoice Payment'}
              </span>
            </div>
          </div>
        </div>

        {/* Breakdown / Allocations Table */}
        <div className="mb-6">
          <div className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">
            Payment Allocation & Purpose
          </div>

          {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-600 uppercase font-semibold text-[11px] border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Bill Number</th>
                    <th className="py-2.5 px-3">Bill Date</th>
                    <th className="py-2.5 px-3 text-right">Bill Total</th>
                    <th className="py-2.5 px-3 text-right font-bold text-slate-900">
                      Amount Paid (Allocated)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allocations.map((a, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-2 px-3 font-bold text-primary">#{a.invoice_number}</td>
                      <td className="py-2 px-3 text-slate-600">{formatDate(a.invoice_date)}</td>
                      <td className="py-2 px-3 text-right text-slate-500">{formatINR(a.invoice_total)}</td>
                      <td className="py-2 px-3 text-right font-bold text-success text-sm">
                        {formatINR(a.allocated_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-bold text-slate-900 text-sm">
                    {receipt.income_category || 'Other Business Income'}
                  </div>
                  {receipt.notes && (
                    <div className="text-slate-600 text-xs mt-1">{receipt.notes}</div>
                  )}
                </div>
                <div className="text-lg font-black text-success">
                  {formatINR(receipt.amount)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Card */}
        <div className="flex justify-end mb-8">
          <div className="w-72 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <div className="flex justify-between text-xs text-slate-600">
              <span>Total Received:</span>
              <span className="font-black text-slate-900 text-base">{formatINR(receipt.amount)}</span>
            </div>
            {receipt.kind === 'INVOICE_PAYMENT' && allocations.length > 0 && (
              <div className="flex justify-between text-xs text-slate-500 border-t border-slate-200 pt-2">
                <span>Allocated to Bills:</span>
                <span className="font-semibold text-slate-800">
                  {formatINR(
                    allocations.reduce((sum, a) => sum + parseFloat(String(a.allocated_amount || 0)), 0)
                  )}
                </span>
              </div>
            )}
            {(receipt.unallocated_amount || 0) > 0 && (
              <div className="flex justify-between text-xs font-semibold text-primary border-t border-primary/20 pt-2">
                <span>Added to Advance Balance:</span>
                <span>+{formatINR(receipt.unallocated_amount || 0)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Notes if any */}
        {receipt.notes && (
          <div className="mb-6 p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs text-amber-900">
            <span className="font-bold">Remarks: </span>
            {receipt.notes}
          </div>
        )}

        {/* Signatures & Footer */}
        <div className="mt-16 pt-6 border-t border-slate-200 flex justify-between items-end">
          <div className="text-slate-500 text-[11px] space-y-1">
            <div className="font-bold text-slate-700">{business?.receipt_footer || 'Thank you for your business!'}</div>
            <div>This is a computer-generated official receipt.</div>
          </div>

          <div className="text-center">
            <div className="w-40 border-b border-slate-400 mb-1"></div>
            <div className="text-[11px] font-bold text-slate-700">Authorized Signatory</div>
            <div className="text-[10px] text-slate-400">{business?.name}</div>
          </div>
        </div>
      </div>
    );
  }
);

ReceiptDocument.displayName = 'ReceiptDocument';

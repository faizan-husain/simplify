import { forwardRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';

export interface InvoiceDocumentProps {
  invoice: {
    number: string;
    invoice_date: string;
    due_date?: string;
    party_name: string;
    party_mobile?: string | null;
    subtotal: number;
    discount_type?: string;
    discount_amount?: number;
    total: number;
    paid_amount: number;
    notes?: string | null;
    invoice_items?: Array<{
      id?: string;
      description: string;
      quantity: number;
      rate: number;
      amount: number;
      applicant_name?: string | null;
    }>;
  };
  business?: {
    name: string;
    owner_name?: string | null;
    mobile?: string | null;
    email?: string | null;
    address?: string | null;
    upi_id?: string | null;
    footer_text?: string | null;
    receipt_header?: string | null;
    receipt_footer?: string | null;
  } | null;
  format?: 'a5' | 'a4' | 'thermal58' | 'thermal80';
}

export const InvoiceDocument = forwardRef<HTMLDivElement, InvoiceDocumentProps>(
  ({ invoice, business, format = 'a5' }, ref) => {
    const balance = Math.max(0, invoice.total - invoice.paid_amount);

    // UPI QR String per BR-19
    const upiQrString =
      business?.upi_id && balance > 0
        ? `upi://pay?pa=${encodeURIComponent(business.upi_id)}&pn=${encodeURIComponent(
            business.name
          )}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.number)}`
        : null;

    // Thermal Formats (58mm and 80mm)
    if (format === 'thermal58' || format === 'thermal80') {
      const is58 = format === 'thermal58';
      return (
        <div
          ref={ref}
          className={`bg-white text-black p-3 font-mono leading-tight mx-auto border-0 shadow-[0_4px_20px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.02)] rounded-lg print:shadow-none print:border-none ${
            is58 ? 'w-[58mm] text-[10px]' : 'w-[80mm] text-[11px]'
          }`}
        >
          {/* Header */}
          <div className="text-center pb-2 border-b border-black">
            <div className="font-bold text-sm uppercase">{business?.name || 'SIMPLIFY'}</div>
            {business?.address && <div>{business.address}</div>}
            {business?.mobile && <div>Phone: {business.mobile}</div>}
            {business?.receipt_header && <div className="mt-0.5 italic">{business.receipt_header}</div>}
          </div>

          {/* Bill Info */}
          <div className="py-2 border-b border-black text-[10px] space-y-0.5">
            <div className="flex justify-between">
              <span>Bill: #{invoice.number}</span>
              <span>{formatDate(invoice.invoice_date)}</span>
            </div>
            <div>Customer: {invoice.party_name}</div>
            {invoice.party_mobile && <div>Mobile: {invoice.party_mobile}</div>}
          </div>

          {/* Items */}
          <div className="py-2 border-b border-black space-y-1">
            <div className="flex justify-between font-bold border-b border-gray-300 pb-0.5">
              <span>Item</span>
              <span>Qty x Rate</span>
              <span>Amt</span>
            </div>
            {invoice.invoice_items?.map((item, idx) => (
              <div key={idx} className="flex justify-between">
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

          {/* Totals */}
          <div className="py-2 border-b border-black space-y-0.5">
            <div className="flex justify-between">
              <span>Subtotal:</span>
              <span>{formatINR(invoice.subtotal)}</span>
            </div>
            {invoice.discount_amount && invoice.discount_amount > 0 ? (
              <div className="flex justify-between text-danger">
                <span>Discount:</span>
                <span>-{formatINR(invoice.discount_amount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-bold text-xs pt-1 border-t border-black">
              <span>TOTAL:</span>
              <span>{formatINR(invoice.total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Paid:</span>
              <span>{formatINR(invoice.paid_amount)}</span>
            </div>
            <div className="flex justify-between font-bold">
              <span>Balance Due:</span>
              <span>{formatINR(balance)}</span>
            </div>
          </div>

          {/* QR Code */}
          {upiQrString && (
            <div className="py-2 text-center flex flex-col items-center border-b border-black">
              <div className="text-[9px] font-bold mb-1">SCAN TO PAY (UPI)</div>
              <QRCodeSVG value={upiQrString} size={is58 ? 85 : 110} level="M" />
              <div className="text-[9px] mt-0.5">{business?.upi_id}</div>
            </div>
          )}

          {/* Footer */}
          <div className="text-center pt-2 text-[9px] text-gray-700">
            {business?.footer_text || business?.receipt_footer || 'Thank you for your business!'}
          </div>

          {/* Simplify Brand Footer */}
          <div className="pt-1.5 mt-1 border-t border-dashed border-gray-400 text-center text-[8.5px] flex items-center justify-center gap-1 text-gray-600">
            <span>Powered by</span>
            <img src="/simplify-logo.png" alt="Simplify" className="h-3 w-auto object-contain inline-block filter grayscale" />
          </div>
        </div>
      );
    }

    // Default: Professional A5 Format (148mm × 210mm, perfectly fits 2 prints per A4 sheet)
    return (
      <div
        ref={ref}
        className="bg-white text-text mx-auto border-0 shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.02)] rounded-xl print:shadow-none print:border-none print:mx-auto"
        style={{
          boxSizing: 'border-box',
          width: '148mm',
          maxWidth: '148mm',
          padding: '8mm 8mm 10mm 8mm',
          margin: '0 auto',
        }}
      >
        {/* Top Header */}
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
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="flex items-center justify-end gap-1 mb-0.5">
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border-0 font-bold text-[9px] uppercase tracking-wider">
                INVOICE
              </span>
            </div>
            <div className="text-xs font-bold text-text font-mono">#{invoice.number}</div>
            <div className="text-[9.5px] text-text-muted mt-0.5">
              Date: <strong className="text-text">{formatDate(invoice.invoice_date)}</strong>
            </div>
            {invoice.due_date && (
              <div className="text-[9.5px] text-text-muted">
                Due: <strong className="text-text">{formatDate(invoice.due_date)}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Billed To / Party Info */}
        <div
          className="bg-[#EEF0F3] p-2.5 rounded-lg mb-2.5 flex items-center justify-between gap-2"
          style={{ border: '1px solid #CBD5E1' }}
        >
          <div className="min-w-0 flex-1">
            <div className="text-[8.5px] font-bold text-text-muted uppercase tracking-wider">
              Billed To
            </div>
            <div className="font-bold text-xs text-text mt-0.5 leading-normal break-words">
              {invoice.party_name}
            </div>
          </div>
          {invoice.party_mobile && (
            <div className="text-right shrink-0">
              <div className="text-[8.5px] font-bold text-text-muted uppercase tracking-wider">
                Mobile
              </div>
              <div className="text-xs font-mono font-medium text-text mt-0.5 leading-normal">
                {invoice.party_mobile}
              </div>
            </div>
          )}
        </div>

        {/* Items Table - table-fixed with exact percentage widths guarantees zero right-side clipping */}
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
                  Description
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
              {invoice.invoice_items?.map((item, idx) => {
                const isLast = idx === (invoice.invoice_items?.length ?? 1) - 1;
                const rowBorderStyle = isLast ? {} : { borderBottom: '1px solid #E2E8F0' };
                return (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td
                      className="px-3 text-slate-800 break-words"
                      style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4', ...rowBorderStyle }}
                    >
                      <span className="font-medium">{item.description}</span>
                      {item.applicant_name && (
                        <span className="block text-[9.5px] text-slate-500 mt-0.5" style={{ lineHeight: '1.3' }}>
                          Particular: {item.applicant_name}
                        </span>
                      )}
                    </td>
                    <td
                      className="px-1 text-center text-slate-600 tabular-nums"
                      style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4', ...rowBorderStyle }}
                    >
                      {item.quantity}
                    </td>
                    <td
                      className="px-2 text-right text-slate-600 tabular-nums whitespace-nowrap"
                      style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4', ...rowBorderStyle }}
                    >
                      {formatINR(item.rate)}
                    </td>
                    <td
                      className="px-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap"
                      style={{ verticalAlign: 'middle', paddingTop: '8px', paddingBottom: '8px', lineHeight: '1.4', ...rowBorderStyle }}
                    >
                      {formatINR(item.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals & UPI QR Code Split */}
        <div className="grid grid-cols-2 gap-3 items-start mb-3">
          {/* UPI QR Payment Block (BR-19) */}
          {upiQrString && balance > 0 ? (
            <div
              className="p-2 rounded-lg bg-white flex items-center gap-2"
              style={{ border: '1px solid #CBD5E1' }}
            >
              <QRCodeSVG value={upiQrString} size={54} level="M" />
              <div className="min-w-0 flex-1 leading-normal">
                <div className="text-[9.5px] font-bold text-slate-800">Scan &amp; Pay UPI</div>
                <div className="text-[11px] font-bold text-teal-700 mt-0.5 leading-normal">
                  {formatINR(balance)}
                </div>
                <div
                  className="text-[8.5px] text-slate-600 mt-0.5 font-mono font-medium leading-normal whitespace-nowrap"
                  title={business?.upi_id || ''}
                >
                  {business?.upi_id}
                </div>
                <div className="text-[7.5px] text-slate-400 mt-0.5 leading-normal">
                  GPay · PhonePe · Paytm · BHIM
                </div>
              </div>
            </div>
          ) : (
            <div className="p-2.5 text-[9.5px] text-slate-400 italic flex items-center h-full">
              Verified computer generated invoice
            </div>
          )}

          {/* Totals Summary */}
          <div
            className="bg-[#F8FAFC] p-3 rounded-lg space-y-1 text-[10.5px]"
            style={{ border: '1px solid #CBD5E1' }}
          >
            <div className="flex justify-between items-center text-slate-600 py-0.5">
              <span>Subtotal</span>
              <span className="font-medium text-slate-900 tabular-nums">{formatINR(invoice.subtotal)}</span>
            </div>
            {invoice.discount_amount && invoice.discount_amount > 0 ? (
              <div className="flex justify-between items-center text-red-600 py-0.5">
                <span>Discount ({invoice.discount_type})</span>
                <span className="tabular-nums">-{formatINR(invoice.discount_amount)}</span>
              </div>
            ) : null}
            <div
              className="flex justify-between items-center text-[11px] font-bold text-slate-900 pt-2 pb-0.5"
              style={{ borderTop: '1px solid #CBD5E1' }}
            >
              <span>Total Amount</span>
              <span className="tabular-nums">{formatINR(invoice.total)}</span>
            </div>
            <div className="flex justify-between items-center text-slate-600 py-0.5">
              <span>Paid Amount</span>
              <span className="text-emerald-700 font-semibold tabular-nums">
                {formatINR(invoice.paid_amount)}
              </span>
            </div>
            <div
              className="flex justify-between items-center text-[11px] font-bold pt-2 pb-0.5"
              style={{ borderTop: '1px solid #CBD5E1' }}
            >
              <span>Balance Due</span>
              <span className={`tabular-nums ${balance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                {formatINR(balance)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Text, Terms & Notes */}
        {(invoice.notes || business?.footer_text) && (
          <div
            className="pt-2.5 pb-1 text-[9.5px] text-slate-500 space-y-1 text-center whitespace-pre-line leading-relaxed"
            style={{ borderTop: '1px solid #CBD5E1' }}
          >
            {invoice.notes && (
              <div>
                <strong>Notes:</strong> {invoice.notes}
              </div>
            )}
            {business?.footer_text && (
              <div className="text-[9px] font-normal text-slate-500">
                {business.footer_text}
              </div>
            )}
          </div>
        )}

        {/* Simplify Software Small Logo & Brand Footer */}
        <div
          className="mt-3 pt-2.5 pb-1 flex items-center justify-between text-[9px] text-slate-500"
          style={{ borderTop: '1px solid #CBD5E1' }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-text-muted">Powered by</span>
            <img
              src="/simplify-logo.png"
              alt="Simplify"
              className="h-3.5 w-auto object-contain inline-block"
            />
          </div>
          <div className="text-[8.5px] text-text-muted font-medium">
            Business Management &amp; Billing Software
          </div>
        </div>
      </div>
    );
  }
);

InvoiceDocument.displayName = 'InvoiceDocument';

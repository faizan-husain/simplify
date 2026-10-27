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
  format?: 'a4' | 'thermal58' | 'thermal80';
}


export const InvoiceDocument = forwardRef<HTMLDivElement, InvoiceDocumentProps>(
  ({ invoice, business, format = 'a4' }, ref) => {
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
          className={`bg-white text-black p-3 font-mono leading-tight mx-auto border border-border shadow-sm print:shadow-none print:border-none ${
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
                <span className="truncate pr-1">
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
        </div>
      );
    }

    // Default: Standard A4 Format
    return (
      <div
        ref={ref}
        className="bg-white text-text p-6 md:p-8 max-w-3xl mx-auto rounded-card border border-border shadow-soft print:shadow-none print:border-none print:p-0"
      >
        {/* Top Header */}
        <div className="flex justify-between items-start border-b border-border pb-6 mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-text">
              {business?.name || 'SIMPLIFY'}
            </h1>
            {business?.address && (
              <p className="text-xs text-text-muted mt-1 max-w-sm whitespace-pre-line">
                {business.address}
              </p>
            )}
            <div className="text-xs text-text-muted mt-1 space-x-2">
              {business?.mobile && <span>Phone: {business.mobile}</span>}
              {business?.email && <span>• Email: {business.email}</span>}
            </div>
          </div>

          <div className="text-right">
            <span className="inline-block px-3 py-1 rounded bg-primary/10 text-primary font-bold text-sm uppercase tracking-wider mb-2">
              Tax Invoice
            </span>
            <div className="text-sm font-bold text-text">#{invoice.number}</div>
            <div className="text-xs text-text-muted mt-1">
              Date: <strong>{formatDate(invoice.invoice_date)}</strong>
            </div>
            {invoice.due_date && (
              <div className="text-xs text-text-muted">
                Due: <strong>{formatDate(invoice.due_date)}</strong>
              </div>
            )}
          </div>
        </div>

        {/* Billed To / Party Info */}
        <div className="bg-surface p-4 rounded-lg border border-border mb-6">
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-1">
            Billed To
          </div>
          <div className="font-bold text-base text-text">{invoice.party_name}</div>
          {invoice.party_mobile && (
            <div className="text-xs text-text-muted mt-0.5">
              Mobile: {invoice.party_mobile}
            </div>
          )}
        </div>

        {/* Items Table */}
        <div className="border border-border rounded-lg overflow-hidden mb-6">
          <table className="w-full text-left text-xs">
            <thead className="bg-surface text-text-muted uppercase border-b border-border">
              <tr>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-center">Qty</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.invoice_items?.map((item, idx) => (
                <tr key={idx} className="hover:bg-surface/50">
                  <td className="px-4 py-3 text-text">
                    <span className="font-medium">{item.description}</span>
                    {item.applicant_name && (
                      <span className="block text-[11px] text-text-muted">
                        Applicant: {item.applicant_name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-text-muted">
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3 text-right text-text-muted">
                    {formatINR(item.rate)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-text">
                    {formatINR(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals & UPI QR Code Split */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start mb-6">
          {/* UPI QR Payment Block (BR-19) */}
          {upiQrString && balance > 0 ? (
            <div className="border border-border p-4 rounded-lg bg-white flex items-center gap-4">
              <QRCodeSVG value={upiQrString} size={110} level="M" />
              <div>
                <div className="text-xs font-bold text-text">Scan &amp; Pay via UPI</div>
                <div className="text-sm font-bold text-primary mt-0.5">
                  {formatINR(balance)}
                </div>
                <div className="text-[11px] text-text-muted mt-1">
                  UPI ID: <span className="font-mono text-text">{business?.upi_id}</span>
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Pay via GPay, PhonePe, Paytm or BHIM
                </div>
              </div>
            </div>
          ) : (
            <div />
          )}

          {/* Totals Summary */}
          <div className="bg-surface p-4 rounded-lg border border-border space-y-2 text-xs">
            <div className="flex justify-between text-text-muted">
              <span>Subtotal</span>
              <span className="font-medium text-text">{formatINR(invoice.subtotal)}</span>
            </div>
            {invoice.discount_amount && invoice.discount_amount > 0 ? (
              <div className="flex justify-between text-danger">
                <span>Discount ({invoice.discount_type})</span>
                <span>-{formatINR(invoice.discount_amount)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-bold text-text pt-2 border-t border-border">
              <span>Total</span>
              <span>{formatINR(invoice.total)}</span>
            </div>
            <div className="flex justify-between text-text-muted">
              <span>Paid Amount</span>
              <span className="text-success font-semibold">
                {formatINR(invoice.paid_amount)}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-1 border-t border-border">
              <span>Balance Due</span>
              <span className={balance > 0 ? 'text-danger' : 'text-success'}>
                {formatINR(balance)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Text & Notes */}
        {(invoice.notes || business?.footer_text) && (
          <div className="pt-4 border-t border-border text-xs text-text-muted space-y-1">
            {invoice.notes && <div><strong>Notes:</strong> {invoice.notes}</div>}
            {business?.footer_text && <div className="italic">{business.footer_text}</div>}
          </div>
        )}
      </div>
    );
  }
);

InvoiceDocument.displayName = 'InvoiceDocument';

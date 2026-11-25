import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { setPrintPageSize } from '../pdfExport';
import { InvoiceDocument } from '../InvoiceDocument';
import { ReceiptDocument } from '../ReceiptDocument';

describe('PDF Export & Print Layout Formatting', () => {
  it('correctly injects A5 print page size with exact zero margins for print preview', () => {
    setPrintPageSize('a5', 0);
    const styleEl = document.getElementById('print-page-size-style');
    expect(styleEl).toBeTruthy();
    expect(styleEl?.textContent).toContain('size: A5 portrait !important');
    expect(styleEl?.textContent).toContain('margin: 0mm !important');
  });

  it('renders InvoiceDocument with crisp border-slate-300 borders and brand footer', () => {
    const dummyInvoice = {
      id: 'inv-1',
      number: 'INV-0003',
      fy_label: '2026-27',
      invoice_date: '2026-11-24',
      due_date: '2026-12-01',
      party_name: 'Aayesha Clinic',
      party_mobile: '9623874183',
      subtotal: 8000,
      discount_type: 'FLAT' as const,
      discount_value: 2000,
      discount_amount: 2000,
      total: 6000,
      paid_amount: 0,
      status: 'ACTIVE' as const,
      cancel_reason: null,
      notes: null,
      invoice_items: [
        {
          id: 'item-1',
          invoice_id: 'inv-1',
          service_id: 'srv-1',
          description: 'NT 1 Side',
          applicant_name: 'Visiting Card',
          quantity: 10,
          rate: 800,
          amount: 8000,
          is_job: false,
        },
      ],
    };

    const dummyBusiness = {
      id: 'biz-1',
      name: 'Global Computers',
      receipt_header: 'Printing & Online Works',
      address: 'Ali Sahab Mohalla, Nandurbar',
      mobile: '9764971786',
      email: 'global.graphics007@gmail.com',
    };

    const { container } = render(
      <InvoiceDocument invoice={dummyInvoice} business={dummyBusiness} format="a5" />
    );

    // Verify header border is crisp slate-300
    const header = container.querySelector('div.flex.justify-between.items-start') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.borderBottom).toContain('1px solid');

    // Verify billed to border is slate-300
    const billedTo = container.querySelector('.bg-\\[\\#EEF0F3\\]') as HTMLElement;
    expect(billedTo).toBeTruthy();
    expect(billedTo.style.border).toContain('1px solid');

    // Verify bottom brand footer has border-t border-slate-300 and pb-1 padding
    const brandFooter = container.querySelector('div.mt-3.pt-2\\.5.pb-1') as HTMLElement;
    expect(brandFooter).toBeTruthy();
    expect(brandFooter.style.borderTop).toContain('1px solid');
    expect(brandFooter?.textContent).toContain('Powered by');
    expect(brandFooter?.textContent).toContain('Business Management & Billing Software');
  });

  it('renders ReceiptDocument with crisp border-slate-300 and brand footer', () => {
    const dummyReceipt = {
      id: 'rc-1',
      number: 'RC-001',
      fy_label: '2026-27',
      receipt_date: '2026-11-24',
      customer_id: 'c-1',
      amount: 6000,
      mode: 'CASH' as const,
      reference: null,
      kind: 'INVOICE_PAYMENT' as const,
      income_category: null,
      unallocated_amount: 0,
      notes: null,
    };

    const dummyCustomer = {
      id: 'c-1',
      name: 'Aayesha Clinic',
      mobile: '9623874183',
    };

    const dummyBusiness = {
      id: 'biz-1',
      name: 'Global Computers',
      receipt_header: 'Printing & Online Works',
      receipt_footer: 'Thank you for your payment!',
    };

    const { container } = render(
      <ReceiptDocument
        receipt={dummyReceipt}
        customer={dummyCustomer}
        allocations={[]}
        business={dummyBusiness}
        format="a5"
      />
    );

    // Verify header border is crisp slate-300
    const header = container.querySelector('div.flex.justify-between.items-start') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.borderBottom).toContain('1px solid');

    // Verify payer details border is slate-300
    const payerBox = container.querySelector('.bg-\\[\\#EEF0F3\\]') as HTMLElement;
    expect(payerBox).toBeTruthy();
    expect(payerBox.style.border).toContain('1px solid');

    // Verify signature bar border is slate-300
    const sigBar = container.querySelector('.pt-2\\.5.flex.justify-between') as HTMLElement;
    expect(sigBar).toBeTruthy();
    expect(sigBar.style.borderTop).toContain('1px solid');

    // Verify brand footer has pb-1 and border-slate-300
    const brandFooter = container.querySelector('div.mt-3.pt-2\\.5.pb-1') as HTMLElement;
    expect(brandFooter).toBeTruthy();
    expect(brandFooter.style.borderTop).toContain('1px solid');
    expect(brandFooter?.textContent).toContain('Powered by');
    expect(brandFooter?.textContent).toContain('Business Management & Billing Software');
  });
});

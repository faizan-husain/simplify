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

  it('renders InvoiceDocument with crisp solid hex borders, single-line UPI ID, and brand footer', () => {
    const dummyInvoice = {
      id: 'inv-1',
      number: 'INV-0004',
      fy_label: '2026-27',
      invoice_date: '2026-11-24',
      due_date: '2026-12-01',
      party_name: 'Sayyed Restorant',
      party_mobile: '7020257442',
      subtotal: 6200,
      total: 6200,
      paid_amount: 0,
      status: 'ACTIVE' as const,
      cancel_reason: null,
      notes: null,
      invoice_items: [
        {
          id: 'item-1',
          invoice_id: 'inv-1',
          description: 'Hotel Menu Card',
          applicant_name: 'A4 size Front Back with Lamination and Spiral Binding',
          quantity: 8,
          rate: 775,
          amount: 6200,
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
      upi_id: 'global.graphics007-2@okhdfcbank',
    };

    const { container } = render(
      <InvoiceDocument invoice={dummyInvoice} business={dummyBusiness} format="a5" />
    );

    // Verify header border is crisp solid #CBD5E1 (rgb(203, 213, 225))
    const header = container.querySelector('div.flex.justify-between.items-start') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.borderBottom).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify billed to border is solid #CBD5E1
    const billedTo = container.querySelector('.bg-\\[\\#EEF0F3\\]') as HTMLElement;
    expect(billedTo).toBeTruthy();
    expect(billedTo.style.border).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify items table has outer border and header has borderBottom
    const tableWrapper = container.querySelector('.rounded-lg.overflow-hidden.mb-2\\.5') as HTMLElement;
    expect(tableWrapper).toBeTruthy();
    expect(tableWrapper.style.border).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    const thList = container.querySelectorAll('th');
    thList.forEach((th) => {
      expect((th as HTMLElement).style.borderBottom).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);
    });

    // Verify UPI QR block has solid border and UPI ID contains break-words
    const upiBox = container.querySelector('div.grid.grid-cols-2 > div') as HTMLElement;
    expect(upiBox).toBeTruthy();
    expect(upiBox.style.border).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    const upiTextEl = upiBox.querySelector('.font-mono') as HTMLElement;
    expect(upiTextEl).toBeTruthy();
    expect(upiTextEl.textContent).toBe('global.graphics007-2@okhdfcbank');

    // Verify totals summary has solid border and dividers
    const totalsBox = container.querySelector('div.grid.grid-cols-2 > div:last-child') as HTMLElement;
    expect(totalsBox).toBeTruthy();
    expect(totalsBox.style.border).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify bottom brand footer has borderTop and brand text
    const brandFooter = container.querySelector('div.mt-3.pt-2\\.5.pb-1') as HTMLElement;
    expect(brandFooter).toBeTruthy();
    expect(brandFooter.style.borderTop).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);
    expect(brandFooter?.textContent).toContain('Powered by');
    expect(brandFooter?.textContent).toContain('Business Management & Billing Software');
  });

  it('renders multiline items, large totals, and long customer names without clipping', () => {
    const multilineInvoice = {
      id: 'inv-multi',
      number: 'INV-9999',
      invoice_date: '2026-11-24',
      due_date: '2026-12-01',
      party_name: 'M/S Royal Palace Luxury Banquet & Hospitality Services Pvt Ltd',
      party_mobile: '9876543210',
      subtotal: 125000,
      total: 125000,
      paid_amount: 25000,
      notes: 'Customer requested express delivery before Saturday.',
      invoice_items: [
        {
          description: 'Special Deluxe Visiting Card with Velvet Matte UV Spot Lamination',
          applicant_name: 'Front & Back 400 GSM Art Card with Rounded Corner Die Cutting and Gold Foil Embossing',
          quantity: 50,
          rate: 2500,
          amount: 125000,
        },
      ],
    };

    const business = {
      name: 'Global Computers & Advanced Digital Printing Solutions LLP',
      address: 'Shop No 1, Main Market, Complex Road',
      mobile: '9764971786',
      upi_id: 'global.graphics007-2@okhdfcbank',
      footer_text: 'Thank you for your business! All disputes subject to local jurisdiction.',
    };

    const { container } = render(
      <InvoiceDocument invoice={multilineInvoice} business={business} format="a5" />
    );

    // Verify table has table-fixed layout for stable percentage columns
    const table = container.querySelector('table') as HTMLTableElement;
    expect(table).toBeTruthy();
    expect(table.className).toContain('table-fixed');

    // Verify long applicant / particular text is present
    expect(container.textContent).toContain('Gold Foil Embossing');

    // Verify large amount formatting
    expect(container.textContent).toContain('₹1,25,000');

    // Verify terms/notes footer has solid top border
    const notesBox = container.querySelector('div.pt-2\\.5.pb-1.text-\\[9\\.5px\\]') as HTMLElement;
    expect(notesBox).toBeTruthy();
    expect(notesBox.style.borderTop).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);
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

    // Verify header border is crisp solid #CBD5E1
    const header = container.querySelector('div.flex.justify-between.items-start') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.style.borderBottom).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify payer details border is solid #CBD5E1
    const payerBox = container.querySelector('.bg-\\[\\#EEF0F3\\]') as HTMLElement;
    expect(payerBox).toBeTruthy();
    expect(payerBox.style.border).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify signature bar border is solid #CBD5E1
    const sigBar = container.querySelector('.pt-2\\.5.flex.justify-between') as HTMLElement;
    expect(sigBar).toBeTruthy();
    expect(sigBar.style.borderTop).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);

    // Verify brand footer has solid #CBD5E1 border
    const brandFooter = container.querySelector('div.mt-3.pt-2\\.5.pb-1') as HTMLElement;
    expect(brandFooter).toBeTruthy();
    expect(brandFooter.style.borderTop).toMatch(/1px solid (?:#CBD5E1|rgb\(203, 213, 225\))/);
    expect(brandFooter?.textContent).toContain('Powered by');
    expect(brandFooter?.textContent).toContain('Business Management & Billing Software');
  });
});

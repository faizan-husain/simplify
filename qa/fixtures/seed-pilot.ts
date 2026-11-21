// qa/fixtures/seed-pilot.ts
// Synthetic Pilot Fixture Generator for PILOT AUDIT
// Seeds Business "Pilot" (Tenant A) with Sentinels & Multi-Year Data, and Business "Other" (Tenant B).

import { Client } from 'pg';
import crypto from 'crypto';
import { SENTINELS } from './sentinels';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

export function uuid(): string {
  return crypto.randomUUID();
}

export interface SeedIds {
  tenantA: {
    businessId: string;
    ownerAuthId: string;
    ownerMemberId: string;
    staff1AuthId: string;
    staff1MemberId: string;
    staff2AuthId: string;
    staff2MemberId: string;
    staff3MemberId: string; // no login
    staffDeactivatedAuthId: string;
    staffDeactivatedMemberId: string;
    sbiBankId: string;
    hdfcBankId: string;
    sentinelBankId: string;
    passportServiceId: string;
    panServiceId: string;
    xeroxServiceId: string;
    laminationServiceId: string;
    customerIds: string[];
    sentinelVendorId: string;
    sentinelLoanId: string;
    sentinelExpenseId: string;
    sentinelPaymentId: string;
  };
  tenantB: {
    businessId: string;
    ownerAuthId: string;
    ownerMemberId: string;
    staffAuthId: string;
    staffMemberId: string;
    customerIds: string[];
  };
}

export async function seedPilotData(): Promise<SeedIds> {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await client.connect();

  try {
    await client.query('BEGIN');

    // 0. Clean prior pilot test data if any
    const testEmails = [
      'owner@pilottest.com',
      'staff1@pilottest.com',
      'staff2@pilottest.com',
      'staff_deactivated@pilottest.com',
      'owner_b@othertest.com',
      'staff_b@othertest.com',
    ];

    await client.query(
      `DELETE FROM public.businesses WHERE name IN ('Pilot Business', 'Other Business Ltd')`
    );
    await client.query(
      `DELETE FROM auth.users WHERE email = ANY($1::text[])`,
      [testEmails]
    );

    // ==========================================
    // 1. TENANT A: Business "Pilot"
    // ==========================================
    const bizAId = uuid();
    const ownerAAuthId = uuid();
    const staff1AAuthId = uuid();
    const staff2AAuthId = uuid();
    const staffDeactivatedAuthId = uuid();

    const ownerAMemberId = uuid();
    const staff1AMemberId = uuid();
    const staff2AMemberId = uuid();
    const staff3AMemberId = uuid();
    const staffDeactivatedMemberId = uuid();

    // 1.1 Create Tenant A Business
    await client.query(`
      INSERT INTO public.businesses (
        id, name, owner_name, mobile, email, address, upi_id,
        invoice_prefix, numbering_mode, default_terms_days, default_notes,
        footer_text, thermal_width, receipt_header, receipt_footer,
        job_management_enabled, yellow_days, red_days, timezone, plan, opening_cash_balance
      ) VALUES (
        $1, 'Pilot Business', 'Owner Pilot', '9876543001', 'owner@pilottest.com',
        'Pilot HQ, Market Square, New Delhi', 'pilot@upi',
        'INV-', 'FY_RESET', 7, 'Thank you for your business!',
        'Terms: Service fees non-refundable after job processing begins.',
        80, 'PILOT BUSINESS\nFast • Reliable • Professional', 'Visit Again!',
        true, 5, 3, 'Asia/Kolkata', 'PRO', 5000.00
      )
    `, [bizAId]);

    // 1.2 Auth Users for Tenant A
    const passwordHash = '$2a$10$wT1YfQeU4h7N6M9lG8X1x.7WvS.sL0u6Tf5E9Kj7k1R8O4y9M0aW.'; // bcrypt for 'pass123'
    await client.query(`
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES
        ($1, 'owner@pilottest.com', public.crypt('ownerpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Owner Pilot","role":"OWNER"}', now(), now()),
        ($2, 'staff1@pilottest.com', public.crypt('staffpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Staff 1 (Comm)","role":"STAFF"}', now(), now()),
        ($3, 'staff2@pilottest.com', public.crypt('staffpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Staff 2 (Salary)","role":"STAFF"}', now(), now()),
        ($4, 'staff_deactivated@pilottest.com', public.crypt('staffpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Staff Deactivated","role":"STAFF"}', now(), now())
    `, [ownerAAuthId, staff1AAuthId, staff2AAuthId, staffDeactivatedAuthId]);

    // 1.3 Members for Tenant A
    await client.query(`
      INSERT INTO public.members (
        id, business_id, auth_user_id, name, email, mobile, role,
        can_login, active, compensation_type, monthly_salary, salary_start_date, created_by, updated_by
      ) VALUES
        ($1, $6, $7, 'Owner Pilot', 'owner@pilottest.com', '9876543001', 'OWNER', true, true, 'COMMISSION', NULL, NULL, NULL, NULL),
        ($2, $6, $8, 'Staff 1 (Comm)', 'staff1@pilottest.com', '9876543002', 'STAFF', true, true, 'COMMISSION', NULL, NULL, $1, $1),
        ($3, $6, $9, 'Staff 2 (Salary)', 'staff2@pilottest.com', '9876543003', 'STAFF', true, true, 'SALARY', $11, '2026-04-01', $1, $1),
        ($4, $6, NULL, 'Helper Ramesh (No Login)', NULL, '9876543004', 'STAFF', false, true, 'COMMISSION', NULL, NULL, $1, $1),
        ($5, $6, $10, 'Staff Deactivated', 'staff_deactivated@pilottest.com', '9876543005', 'STAFF', true, false, 'COMMISSION', NULL, NULL, $1, $1)
    `, [
      ownerAMemberId, staff1AMemberId, staff2AMemberId, staff3AMemberId, staffDeactivatedMemberId,
      bizAId, ownerAAuthId, staff1AAuthId, staff2AAuthId, staffDeactivatedAuthId,
      SENTINELS.STAFF2_SALARY
    ]);

    // Update business secrets (PIN 5432)
    await client.query(`
      INSERT INTO public.business_secrets (business_id, privacy_pin_hash)
      VALUES ($1, public.crypt('5432', public.gen_salt('bf')))
      ON CONFLICT (business_id) DO UPDATE SET privacy_pin_hash = EXCLUDED.privacy_pin_hash
    `, [bizAId]);

    // 1.4 Categories
    await client.query(`
      INSERT INTO public.expense_categories (business_id, name, system) VALUES
        ($1, 'Salary / Commission', true),
        ($1, 'Loan Interest', true),
        ($1, 'Office Rent', false),
        ($1, 'Electricity & Utilities', false),
        ($1, 'Paper & Supplies', false),
        ($1, 'Tea & Refreshments', false)
    `, [bizAId]);

    // 1.5 Bank Accounts (SBI, HDFC + Sentinel Bank)
    const sbiBankId = uuid();
    const hdfcBankId = uuid();
    const sentinelBankId = uuid();
    await client.query(`
      INSERT INTO public.bank_accounts (id, business_id, bank_name, account_name, account_number, ifsc, upi_id, opening_balance, active)
      VALUES
        ($1, $4, 'State Bank of India', 'SBI Main Current A/c', '••••1234', 'SBIN0001234', 'pilot@sbi', 25000.00, true),
        ($2, $4, 'HDFC Bank', 'HDFC Business A/c', '••••5678', 'HDFC0000567', 'pilot@hdfc', 15000.00, true),
        ($3, $4, $5, 'Confidential Reserve', $6, 'SENT0007777', 'sentinel@bank', 100000.00, true)
    `, [sbiBankId, hdfcBankId, sentinelBankId, bizAId, SENTINELS.BANK_NAME, SENTINELS.BANK_ACC_NUM]);

    // 1.6 WhatsApp Templates
    await client.query(`
      INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
        ($1, 'INVOICE', 'Hello {customer_name}, bill #{invoice_no} amount {amount}. Balance: {balance}. - {business_name}'),
        ($1, 'RECEIPT', 'Hello {customer_name}, received {amount} for bill #{invoice_no}. - {business_name}'),
        ($1, 'REMINDER', 'Hello {customer_name}, bill #{invoice_no} balance {balance} due on {due_date}. - {business_name}')
    `, [bizAId]);

    // 1.7 Services & Job Types
    const xeroxServiceId = uuid();
    const scanServiceId = uuid();
    const laminationServiceId = uuid();
    const panServiceId = uuid();
    const passportServiceId = uuid();

    await client.query(`
      INSERT INTO public.services (id, business_id, name, default_rate, category, active, is_job_type, deadline_days, commission_percent)
      VALUES
        ($1, $6, 'Xerox / Photocopy', 2.00, 'Print', true, false, NULL, NULL),
        ($2, $6, 'Document Scanning', 10.00, 'Digital', true, false, NULL, NULL),
        ($3, $6, 'Lamination', 30.00, 'Finishing', true, false, NULL, NULL),
        ($4, $6, 'PAN Card Application', 250.00, 'Government', true, true, 3, 10.00),
        ($5, $6, 'Passport Application', 1500.00, 'Government', true, true, 7, 15.00)
    `, [xeroxServiceId, scanServiceId, laminationServiceId, panServiceId, passportServiceId, bizAId]);

    // Job steps for Passport & PAN
    await client.query(`
      INSERT INTO public.job_type_steps (business_id, service_id, position, name, whatsapp_message) VALUES
        ($2, $1, 1, 'Document Verification', 'Your documents for {job_name} ({applicant}) have been verified.'),
        ($2, $1, 2, 'Online Form Filing', 'Online form submitted for {job_name}. Application ref: {bill_no}'),
        ($2, $1, 3, 'Appointment Booking', 'Passport Seva Kendra appointment booked for {applicant}.'),
        ($2, $1, 4, 'Biometric at PSK', 'Biometric stage completed for {applicant}.'),
        ($2, $1, 5, 'Police Verification & Dispatch', 'Passport approved and dispatched. Thank you from {business_name}!')
    `, [passportServiceId, bizAId]);

    await client.query(`
      INSERT INTO public.job_type_steps (business_id, service_id, position, name, whatsapp_message) VALUES
        ($2, $1, 1, 'Form Filling', 'PAN card form filled.'),
        ($2, $1, 2, 'Document Upload', 'Documents uploaded.'),
        ($2, $1, 3, 'Fee Payment', 'Govt fee paid.'),
        ($2, $1, 4, 'Acknowledgement Generation', 'PAN Acknowledgement generated.')
    `, [panServiceId, bizAId]);

    // 1.8 30 Customers
    const customerIds: string[] = [];
    const customerNames = [
      'Aarav Sharma', 'Aditi Verma', 'Amitabh Roy', 'Ananya Gupta', 'Bhavin Patel',
      'Chetan Bhagat', 'Deepa Nair', 'Divya Mehra', 'Farhan Akhtar', 'Gaurav Khanna',
      'Geeta Rao', 'Harish Chandra', 'Isha Ambani', 'Jaspreet Singh', 'Kavita Joshi',
      'Karan Johar', 'Lata Mangeshkar', 'Manish Malhotra', 'Neha Dhupia', 'Nikhil Advani',
      'Pooja Bhatt', 'Prateek Kuhad', 'Rahul Dravid', 'Riya Sen', 'Sachin Tendulkar',
      'Shreya Ghoshal', 'Tarun Tahiliani', 'Udit Narayan', 'Varun Dhawan', 'Zoya Akhtar'
    ];

    for (let i = 0; i < customerNames.length; i++) {
      const cId = uuid();
      customerIds.push(cId);
      const isRegular = i < 20; // 20 Regular, 10 Walk-in
      const mobile = `981000${String(1000 + i).slice(-4)}`;
      await client.query(`
        INSERT INTO public.customers (id, business_id, type, name, mobile, email, address, created_by, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
      `, [
        cId, bizAId, isRegular ? 'REGULAR' : 'WALK_IN', customerNames[i],
        mobile, `${customerNames[i].toLowerCase().replace(/\s+/g, '.')}@test.com`,
        `Sector ${i + 1}, Rohini, Delhi`, ownerAMemberId
      ]);
    }

    // 1.9 Vendors (including Sentinel Vendor)
    const normalVendorId = uuid();
    const sentinelVendorId = uuid();
    await client.query(`
      INSERT INTO public.vendors (id, business_id, name, mobile, created_by, updated_by)
      VALUES
        ($1, $3, 'Shree Stationery Suppliers', '9899001122', $4, $4),
        ($2, $3, $5, '9899009988', $4, $4)
    `, [normalVendorId, sentinelVendorId, bizAId, ownerAMemberId, SENTINELS.VENDOR_NAME]);

    // 1.10 Sentinel Expense & Vendor Payment & Loan
    const sentinelExpenseId = uuid();
    const rentCat = await client.query(`SELECT id FROM public.expense_categories WHERE business_id = $1 AND name = 'Office Rent'`, [bizAId]);
    const rentCatId = rentCat.rows[0].id;
    await client.query(`
      INSERT INTO public.expenses (id, business_id, fy_label, expense_date, category_id, description, amount, mode, created_by, updated_by)
      VALUES ($1, $2, '2026-27', CURRENT_DATE, $3, $4, $5, 'BANK', $6, $6)
    `, [sentinelExpenseId, bizAId, rentCatId, SENTINELS.EXPENSE_DESC, SENTINELS.EXPENSE_AMOUNT, ownerAMemberId]);

    const sentinelPaymentId = uuid();
    await client.query(`
      INSERT INTO public.payments (id, business_id, fy_label, payment_date, vendor_id, description, amount, mode, created_by, updated_by)
      VALUES ($1, $2, '2026-27', CURRENT_DATE, $3, 'Sentinel Material Purchase', $4, 'BANK', $5, $5)
    `, [sentinelPaymentId, bizAId, sentinelVendorId, SENTINELS.VENDOR_PAYMENT_AMOUNT, ownerAMemberId]);

    const sentinelLoanId = uuid();
    await client.query(`
      INSERT INTO public.loans (id, business_id, lender_name, amount, loan_date, interest_rate, notes, created_by, updated_by)
      VALUES ($1, $2, $3, $4, '2026-05-01', 10.0, 'Capital loan for equipment', $5, $5)
    `, [sentinelLoanId, bizAId, SENTINELS.LOAN_LENDER, SENTINELS.LOAN_AMOUNT, ownerAMemberId]);

    // 1.11 ~150 Invoices Across 2 Financial Years
    // FY 2025-26: 50 invoices (dates: 2026-01-01 to 2026-03-31)
    // FY 2026-27: 100 invoices (dates: 2026-04-01 to 2026-11-01)
    let invCounter = 1;

    for (let i = 1; i <= 150; i++) {
      const isFY25 = i <= 50;
      const fyLabel = isFY25 ? '2025-26' : '2026-27';
      const invId = uuid();
      const invNum = `INV-${fyLabel}-${String(invCounter++).padStart(4, '0')}`;

      // Date distribution
      let invDateStr: string;
      if (isFY25) {
        const day = (i % 28) + 1;
        const month = (i % 3) + 1; // Jan, Feb, Mar 2026
        invDateStr = `2026-0${month}-${String(day).padStart(2, '0')}`;
      } else {
        const offset = i - 50;
        const day = (offset % 28) + 1;
        const month = ((offset % 7) + 4); // Apr to Oct 2026
        invDateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }

      const custIdx = i % customerIds.length;
      const cId = customerIds[custIdx];
      const pName = customerNames[custIdx];
      const pMobile = `981000${String(1000 + custIdx).slice(-4)}`;

      // Line item setup
      const isJobBill = i % 4 === 0; // 25% are job bills (Passport / PAN)
      const isPassport = isJobBill && (i % 2 === 0);
      const isStaff1Creator = (i % 3 === 0); // 1 in 3 created by staff1
      const creatorId = isStaff1Creator ? staff1AMemberId : ownerAMemberId;

      let subtotal = 0;
      let serviceId = xeroxServiceId;
      let serviceName = 'Xerox / Photocopy';
      let rate = 2.0;
      let qty = (i % 20) + 5;

      if (isJobBill) {
        qty = 1;
        if (isPassport) {
          serviceId = passportServiceId;
          serviceName = 'Passport Application';
          rate = 1500.0;
        } else {
          serviceId = panServiceId;
          serviceName = 'PAN Card Application';
          rate = 250.0;
        }
      }
      subtotal = rate * qty;

      // Payment scenario:
      // 60% fully paid
      // 25% partially paid
      // 15% unpaid
      let paid = 0;
      if (i % 10 <= 5) {
        paid = subtotal; // full paid
      } else if (i % 10 <= 8) {
        paid = Math.round(subtotal * 0.5 * 100) / 100; // partial
      } else {
        paid = 0; // unpaid
      }

      // Insert invoice
      await client.query(`
        INSERT INTO public.invoices (
          id, business_id, number, fy_label, invoice_date, due_date,
          customer_id, party_name, party_mobile, subtotal,
          discount_type, discount_value, discount_amount, total, paid_amount,
          status, notes, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, ($5::date + INTERVAL '7 days')::date,
          $6, $7, $8, $9,
          'NONE', 0, 0, $9, $10,
          'ACTIVE', 'Pilot generated invoice', $11, $11
        )
      `, [invId, bizAId, invNum, fyLabel, invDateStr, cId, pName, pMobile, subtotal, paid, creatorId]);

      // Insert invoice item
      const itemId = uuid();
      await client.query(`
        INSERT INTO public.invoice_items (
          id, business_id, invoice_id, service_id, description, quantity, rate, amount, is_job, applicant_name
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
      `, [itemId, bizAId, invId, serviceId, serviceName, qty, rate, subtotal, isJobBill, isJobBill ? pName : null]);

      // If job bill, create job & steps
      if (isJobBill) {
        const jobId = uuid();
        const deadlineOffset = isPassport ? 7 : 3;
        const commPercent = isPassport ? 15.0 : 10.0;
        const assignedStaffId = isStaff1Creator ? staff1AMemberId : staff2AMemberId;

        // Progress status:
        // Older jobs completed, newer jobs in progress / different buckets
        const isCompleted = i % 3 === 0;
        const status = isCompleted ? 'COMPLETED' : 'IN_PROGRESS';
        const completedAt = isCompleted ? `${invDateStr} 16:00:00Z` : null;

        await client.query(`
          INSERT INTO public.jobs (
            id, business_id, invoice_id, invoice_item_id, service_id, job_type_name,
            party_name, party_mobile, applicant_name, amount, deadline_date,
            assigned_staff_id, commission_percent, status, completed_at, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $7, $9, ($10::date + ($11 || ' days')::interval)::date,
            $12, $13, $14, $15, $16, $16
          )
        `, [
          jobId, bizAId, invId, itemId, serviceId, serviceName,
          pName, pMobile, subtotal, invDateStr, deadlineOffset,
          assignedStaffId, commPercent, status, completedAt, creatorId
        ]);

        // Copy steps
        const stepTemplates = await client.query(
          `SELECT position, name, whatsapp_message FROM public.job_type_steps WHERE service_id = $1 ORDER BY position`,
          [serviceId]
        );

        for (const st of stepTemplates.rows) {
          const stepId = uuid();
          const ticked = isCompleted || (st.position <= (i % 3));
          await client.query(`
            INSERT INTO public.job_steps (id, business_id, job_id, position, name, whatsapp_message, ticked, ticked_at, ticked_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            stepId, bizAId, jobId, st.position, st.name, st.whatsapp_message,
            ticked, ticked ? `${invDateStr} 12:00:00Z` : null, ticked ? creatorId : null
          ]);
        }

        // Commission entry (per Migration 47: created by STAFF only)
        if (isStaff1Creator) {
          const commEntryId = uuid();
          const commAmount = Math.round(subtotal * (commPercent / 100) * 100) / 100;
          const commStatus = isCompleted ? 'EARNED' : 'UPCOMING';
          await client.query(`
            INSERT INTO public.commission_entries (
              id, business_id, job_id, staff_id, base_amount, percent, amount, status, earned_at, created_by, updated_by
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10
            )
          `, [
            commEntryId, bizAId, jobId, staff1AMemberId, subtotal, commPercent, commAmount,
            commStatus, isCompleted ? `${invDateStr} 16:00:00Z` : null, staff1AMemberId
          ]);
        }
      }

      // If paid > 0, create receipt & allocation
      if (paid > 0) {
        const rcId = uuid();
        const rcNum = `RC-${fyLabel}-${String(i).padStart(4, '0')}`;
        const mode = i % 2 === 0 ? 'CASH' : 'UPI';
        await client.query(`
          INSERT INTO public.receipts (
            id, business_id, number, fy_label, receipt_date, customer_id,
            amount, mode, reference, kind, unallocated_amount, created_by, updated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, 'INVOICE_PAYMENT', 0, $10, $10
          )
        `, [rcId, bizAId, rcNum, fyLabel, invDateStr, cId, paid, mode, `REF-${rcNum}`, creatorId]);

        await client.query(`
          INSERT INTO public.receipt_allocations (id, business_id, receipt_id, invoice_id, amount)
          VALUES ($1, $2, $3, $4, $5)
        `, [uuid(), bizAId, rcId, invId, paid]);
      }
    }

    // 1.12 Unallocated Customer Advance Receipt for Customer 1
    const advReceiptId = uuid();
    await client.query(`
      INSERT INTO public.receipts (
        id, business_id, number, fy_label, receipt_date, customer_id,
        amount, mode, reference, kind, unallocated_amount, notes, created_by, updated_by
      ) VALUES (
        $1, $2, 'RC-2026-27-ADV01', '2026-27', CURRENT_DATE, $3,
        5000.00, 'UPI', 'ADVANCE-UPI-123', 'INVOICE_PAYMENT', 5000.00, 'Customer advance payment', $4, $4
      )
    `, [advReceiptId, bizAId, customerIds[0], ownerAMemberId]);

    // 1.13 Staff 2 Salary Accruals & Payout
    const salaryCat = await client.query(`SELECT id FROM public.expense_categories WHERE business_id = $1 AND name = 'Salary / Commission'`, [bizAId]);
    const salaryCatId = salaryCat.rows[0].id;

    // Payout ₹20,000 to Staff 2
    const payoutId = uuid();
    const payoutExpId = uuid();
    await client.query(`
      INSERT INTO public.expenses (
        id, business_id, fy_label, expense_date, category_id, description, amount, mode, staff_id, created_by, updated_by
      ) VALUES (
        $1, $2, '2026-27', CURRENT_DATE, $3, 'Staff Salary Payout', 20000.00, 'BANK', $4, $5, $5
      )
    `, [payoutExpId, bizAId, salaryCatId, staff2AMemberId, ownerAMemberId]);

    await client.query(`
      INSERT INTO public.staff_payouts (
        id, business_id, staff_id, amount, payout_date, mode, expense_id, created_by, updated_by
      ) VALUES (
        $1, $2, $3, 20000.00, CURRENT_DATE, 'BANK', $4, $5, $5
      )
    `, [payoutId, bizAId, staff2AMemberId, payoutExpId, ownerAMemberId]);

    // 1.14 Normal Expenses & Vendor Payments & Transfers
    const utilCat = await client.query(`SELECT id FROM public.expense_categories WHERE business_id = $1 AND name = 'Electricity & Utilities'`, [bizAId]);
    const utilCatId = utilCat.rows[0].id;
    await client.query(`
      INSERT INTO public.expenses (id, business_id, fy_label, expense_date, category_id, description, amount, mode, created_by, updated_by)
      VALUES
        ($1, $2, '2026-27', CURRENT_DATE, $3, 'Monthly Electricity Bill', 2450.00, 'BANK', $4, $4),
        ($5, $2, '2026-27', CURRENT_DATE, $3, 'Office Internet Broadband', 999.00, 'UPI', $4, $4)
    `, [uuid(), bizAId, utilCatId, ownerAMemberId, uuid()]);

    await client.query(`
      INSERT INTO public.payments (id, business_id, fy_label, payment_date, vendor_id, description, amount, mode, created_by, updated_by)
      VALUES ($1, $2, '2026-27', CURRENT_DATE, $3, 'Paper A4 75GSM 20 Reams', 5200.00, 'CASH', $4, $4)
    `, [uuid(), bizAId, normalVendorId, ownerAMemberId]);

    // Cash Deposit to SBI
    await client.query(`
      INSERT INTO public.money_transfers (
        id, business_id, transfer_type, transfer_date, amount, from_bank_account_id, to_bank_account_id, notes, created_by, updated_by
      ) VALUES (
        $1, $2, 'CASH_TO_BANK', CURRENT_DATE, 3000.00, NULL, $3, 'Cash deposit to SBI', $4, $4
      )
    `, [uuid(), bizAId, sbiBankId, ownerAMemberId]);

    // ==========================================
    // 2. TENANT B: Business "Other" (Attacker)
    // ==========================================
    const bizBId = uuid();
    const ownerBAuthId = uuid();
    const staffBAuthId = uuid();
    const ownerBMemberId = uuid();
    const staffBMemberId = uuid();

    await client.query(`
      INSERT INTO public.businesses (
        id, name, owner_name, mobile, email, address, upi_id,
        invoice_prefix, numbering_mode, default_terms_days, default_notes,
        footer_text, thermal_width, receipt_header, receipt_footer,
        job_management_enabled, yellow_days, red_days, timezone, plan, opening_cash_balance
      ) VALUES (
        $1, 'Other Business Ltd', 'Owner B', '9876543101', 'owner_b@othertest.com',
        'Other Town, Mumbai', 'other@upi',
        'OTH-', 'CONTINUOUS', 0, 'Other terms',
        'Other Footer', 80, 'OTHER BIZ', 'Thanks',
        false, 5, 3, 'Asia/Kolkata', 'PRO', 2000.00
      )
    `, [bizBId]);

    await client.query(`
      INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      VALUES
        ($1, 'owner_b@othertest.com', public.crypt('ownerpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Owner B","role":"OWNER"}', now(), now()),
        ($2, 'staff_b@othertest.com', public.crypt('staffpass123', public.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"name":"Staff B","role":"STAFF"}', now(), now())
    `, [ownerBAuthId, staffBAuthId]);

    await client.query(`
      INSERT INTO public.members (
        id, business_id, auth_user_id, name, email, mobile, role, can_login, active, compensation_type, monthly_salary, salary_start_date, created_by, updated_by
      ) VALUES
        ($1, $3, $4, 'Owner B', 'owner_b@othertest.com', '9876543101', 'OWNER', true, true, 'COMMISSION', NULL, NULL, NULL, NULL),
        ($2, $3, $5, 'Staff B', 'staff_b@othertest.com', '9876543102', 'STAFF', true, true, 'COMMISSION', NULL, NULL, $1, $1)
    `, [ownerBMemberId, staffBMemberId, bizBId, ownerBAuthId, staffBAuthId]);

    const tenantBCustomerIds: string[] = [];
    for (let j = 1; j <= 5; j++) {
      const cId = uuid();
      tenantBCustomerIds.push(cId);
      await client.query(`
        INSERT INTO public.customers (id, business_id, type, name, mobile, created_by, updated_by)
        VALUES ($1, $2, 'REGULAR', $3, $4, $5, $5)
      `, [cId, bizBId, `Tenant B Customer ${j}`, `982000${String(1000 + j).slice(-4)}`, ownerBMemberId]);
    }

    await client.query('COMMIT');

    console.log('✅ Pilot synthetic fixtures seeded successfully:');
    console.log(`   Tenant A (Pilot Business): ID ${bizAId}`);
    console.log(`   Tenant B (Other Business): ID ${bizBId}`);

    return {
      tenantA: {
        businessId: bizAId,
        ownerAuthId: ownerAAuthId,
        ownerMemberId: ownerAMemberId,
        staff1AuthId: staff1AAuthId,
        staff1MemberId: staff1AMemberId,
        staff2AuthId: staff2AAuthId,
        staff2MemberId: staff2AMemberId,
        staff3MemberId: staff3AMemberId,
        staffDeactivatedAuthId: staffDeactivatedAuthId,
        staffDeactivatedMemberId: staffDeactivatedMemberId,
        sbiBankId,
        hdfcBankId,
        sentinelBankId,
        passportServiceId,
        panServiceId,
        xeroxServiceId,
        laminationServiceId,
        customerIds,
        sentinelVendorId,
        sentinelLoanId,
        sentinelExpenseId,
        sentinelPaymentId,
      },
      tenantB: {
        businessId: bizBId,
        ownerAuthId: ownerBAuthId,
        ownerMemberId: ownerBMemberId,
        staffAuthId: staffBAuthId,
        staffMemberId: staffBMemberId,
        customerIds: tenantBCustomerIds,
      },
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seeding failed:', err);
    throw err;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed-pilot.ts')) {
  seedPilotData().catch(() => process.exit(1));
}

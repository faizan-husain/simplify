import { Client } from 'pg';
import crypto from 'crypto';

const DB_HOST = process.env.PGHOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.PGPORT || '5432', 10);
const DB_USER = process.env.PGUSER || 'postgres';
const DB_PASSWORD = process.env.PGPASSWORD || 'admin';
const DB_NAME = process.env.PGDATABASE || 'simplify_dev';

function uuid(): string {
  return crypto.randomUUID();
}

async function runSeed() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await client.connect();
  console.log(`Connected to ${DB_NAME} for seeding demo dataset...`);

  try {
    await client.query('BEGIN');

    // Clean previous demo business and demo auth users if re-running seed
    await client.query(`
      DELETE FROM public.businesses WHERE mobile = '9876543210';
      DELETE FROM auth.users WHERE email IN ('919876543210@simplify.local', '919876543211@simplify.local');
    `);

    // 1. Create Business
    const bizId = uuid();
    const ownerAuthId = uuid();
    const staff1AuthId = uuid();

    console.log('Seeding Business: Global Xerox & Doc Services...');
    await client.query(`
      INSERT INTO public.businesses (
        id, name, owner_name, mobile, email, address, upi_id,
        invoice_prefix, numbering_mode, default_terms_days, default_notes,
        footer_text, thermal_width, receipt_header, receipt_footer,
        job_management_enabled, yellow_days, red_days, timezone, plan
      ) VALUES (
        $1, 'Global Xerox & Doc Services', 'Rajesh Sharma', '9876543210', 'rajesh@globalx.in',
        'Shop 4, Market Complex, MG Road, New Delhi', 'globalxerox@upi',
        'INV-', 'CONTINUOUS', 7, 'Thank you for choosing Global Xerox!',
        'Terms: Service fees non-refundable after job processing begins.',
        80, 'GLOBAL XEROX & DOC SERVICES\nFast • Reliable • Professional', 'Visit Again!',
        true, 5, 3, 'Asia/Kolkata', 'PRO'
      )
    `, [bizId]);

    // Seed Default Categories
    await client.query(`
      INSERT INTO public.expense_categories (business_id, name, system) VALUES
        ($1, 'Salary / Commission', true),
        ($1, 'Loan Interest', true),
        ($1, 'Rent', false),
        ($1, 'Electricity & Utilities', false),
        ($1, 'Paper & Consumables', false),
        ($1, 'Office Tea & Snacks', false),
        ($1, 'Machine Maintenance', false)
    `, [bizId]);

    await client.query(`
      INSERT INTO public.invoice_counters (business_id, fy_label, last_number) VALUES
        ($1, 'ALL', 100)
    `, [bizId]);

    await client.query(`
      INSERT INTO public.whatsapp_templates (business_id, type, body) VALUES
        ($1, 'INVOICE', 'Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}. Thank you!'),
        ($1, 'RECEIPT', 'Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}'),
        ($1, 'REMINDER', 'Hello {customer_name}, friendly reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}')
    `, [bizId]);

    // 2. Auth Users & Members
    console.log('Seeding Auth Users & Team Members...');
    const userRes = await client.query(`
      INSERT INTO auth.users (id, email) VALUES
        ($1, '919876543210@simplify.local'),
        ($2, '919876543211@simplify.local')
      ON CONFLICT (email) DO UPDATE SET updated_at = now()
      RETURNING id, email
    `, [ownerAuthId, staff1AuthId]);

    const actualOwnerAuthId = userRes.rows.find(r => r.email === '919876543210@simplify.local')?.id || ownerAuthId;
    const actualStaff1AuthId = userRes.rows.find(r => r.email === '919876543211@simplify.local')?.id || staff1AuthId;

    const ownerMemberId = uuid();
    const staff1MemberId = uuid();
    const staff2MemberId = uuid();

    await client.query(`
      INSERT INTO public.members (id, business_id, auth_user_id, name, mobile, role, can_login, active) VALUES
        ($1, $4, $5, 'Rajesh Sharma', '9876543210', 'OWNER', true, true),
        ($2, $4, $6, 'Amit Kumar', '9876543211', 'STAFF', true, true),
        ($3, $4, NULL, 'Suresh Verma', '9876543212', 'STAFF', false, true)
    `, [ownerMemberId, staff1MemberId, staff2MemberId, bizId, actualOwnerAuthId, actualStaff1AuthId]);


    // Set privacy PIN '1234' for owner
    await client.query(`
      INSERT INTO public.business_secrets (business_id, privacy_pin_hash)
      VALUES ($1, crypt('1234', gen_salt('bf')))
    `, [bizId]);

    // 3. Services & Job Types
    console.log('Seeding 8 Services (including Job Type: Passport Application)...');
    const serviceIds: Record<string, string> = {
      photocopy: uuid(),
      color_print: uuid(),
      lamination: uuid(),
      spiral: uuid(),
      stamp_paper: uuid(),
      notary: uuid(),
      pan_card: uuid(),
      passport: uuid(),
    };

    await client.query(`
      INSERT INTO public.services (id, business_id, name, default_rate, category, active, is_job_type, deadline_days, commission_percent) VALUES
        ($1, $9, 'Photocopy B/W', 2.00, 'Printing', true, false, NULL, NULL),
        ($2, $9, 'Color Printout', 10.00, 'Printing', true, false, NULL, NULL),
        ($3, $9, 'Lamination A4', 30.00, 'Binding', true, false, NULL, NULL),
        ($4, $9, 'Spiral Binding', 50.00, 'Binding', true, false, NULL, NULL),
        ($5, $9, 'Stamp Paper E-Stamp', 100.00, 'Documentation', true, false, NULL, NULL),
        ($6, $9, 'Notary Attestation', 80.00, 'Documentation', true, false, NULL, NULL),
        ($7, $9, 'PAN Card Application', 250.00, 'Government Services', true, false, NULL, NULL),
        ($8, $9, 'Passport Application', 1500.00, 'Government Services', true, true, 15, 20.00)
    `, [
      serviceIds.photocopy,
      serviceIds.color_print,
      serviceIds.lamination,
      serviceIds.spiral,
      serviceIds.stamp_paper,
      serviceIds.notary,
      serviceIds.pan_card,
      serviceIds.passport,
      bizId,
    ]);

    // Job Steps for Passport Application
    await client.query(`
      INSERT INTO public.job_type_steps (business_id, service_id, position, name, whatsapp_message) VALUES
        ($1, $2, 1, 'Document Verification', 'Hello {party_name}, your documents for {job_name} ({bill_no}) have been verified successfully. - {business_name}'),
        ($1, $2, 2, 'Police Verification Booked', 'Hello {party_name}, your police verification appointment is scheduled for {job_name}. - {business_name}'),
        ($1, $2, 3, 'Passport Dispatched', 'Hello {party_name}, great news! Your passport has been dispatched. - {business_name}')
    `, [bizId, serviceIds.passport]);

    // 4. Seed 30 Customers (20 Regular, 10 Walk-in)
    console.log('Seeding 30 Customers...');
    const customerNames = [
      'Rahul Sharma', 'Anjali Gupta', 'Vikram Patel', 'Neha Singh', 'Priya Verma',
      'Rohit Mehta', 'Sunita Rao', 'Deepak Joshi', 'Manoj Tiwari', 'Kavita Nair',
      'Ajay Yadav', 'Pooja Agarwal', 'Sanjay Gupta', 'Rekha Jain', 'Suresh Chandra',
      'Meena Kumari', 'Alok Nath', 'Swati Saxena', 'Harish Rawat', 'Divya Chauhan',
      'Walk-in Ramesh', 'Walk-in Dinesh', 'Walk-in Geeta', 'Walk-in Pankaj', 'Walk-in Babita',
      'Walk-in Kapil', 'Walk-in Anita', 'Walk-in Mukesh', 'Walk-in Chander', 'Walk-in Shobha'
    ];

    const customerIds: string[] = [];
    for (let i = 0; i < customerNames.length; i++) {
      const cId = uuid();
      customerIds.push(cId);
      const isWalkin = i >= 20;
      const mobile = `981100${String(1000 + i).slice(-4)}`;
      await client.query(`
        INSERT INTO public.customers (id, business_id, type, name, mobile, email, address)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        cId,
        bizId,
        isWalkin ? 'WALK_IN' : 'REGULAR',
        customerNames[i],
        mobile,
        `${customerNames[i].toLowerCase().replace(/\s+/g, '')}@gmail.com`,
        `Plot ${10 + i}, Sector ${1 + (i % 15)}, Rohini, New Delhi`,
      ]);
    }

    // 5. Seed 150 Invoices spread across the past 90 days
    console.log('Seeding 150 Invoices, Job Workflows, Receipts & Allocations...');
    let invoiceNumberCounter = 1001;

    for (let i = 1; i <= 150; i++) {
      const invId = uuid();
      const invNum = `INV-${invoiceNumberCounter++}`;
      // Spread across past 90 days
      const daysAgo = Math.floor(Math.random() * 90);
      const invDate = new Date();
      invDate.setDate(invDate.getDate() - daysAgo);
      const dateStr = invDate.toISOString().split('T')[0];

      const dueDate = new Date(invDate);
      dueDate.setDate(dueDate.getDate() + 7);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      const custIndex = i % customerNames.length;
      const customerId = customerIds[custIndex];
      const partyName = customerNames[custIndex];
      const partyMobile = `981100${String(1000 + custIndex).slice(-4)}`;

      // Compute subtotal and payments
      const isJobBill = i % 5 === 0; // 20% of bills include Passport Job
      const qty = (i % 10) + 1;
      const subtotal = isJobBill ? 1500 : qty * 10;

      // Payment scenario: 60% fully paid, 25% partial paid, 15% unpaid
      let paid = 0;
      if (i % 10 <= 6) {
        paid = subtotal; // full paid
      } else if (i % 10 <= 8) {
        paid = Math.round(subtotal * 0.4); // partial paid
      } else {
        paid = 0; // unpaid
      }

      // 1. Insert Invoice first
      await client.query(`
        INSERT INTO public.invoices (
          id, business_id, number, fy_label, invoice_date, due_date,
          customer_id, party_name, party_mobile, subtotal,
          discount_type, discount_value, discount_amount, total, paid_amount,
          status, notes
        ) VALUES (
          $1, $2, $3, '2026-27', $4, $5,
          $6, $7, $8, $9,
          'NONE', 0, 0, $9, $10,
          'ACTIVE', 'Generated invoice'
        )
      `, [invId, bizId, invNum, dateStr, dueDateStr, customerId, partyName, partyMobile, subtotal, paid]);

      // 2. Insert Invoice Items & Jobs
      if (isJobBill) {
        const itemId = uuid();
        await client.query(`
          INSERT INTO public.invoice_items (id, business_id, invoice_id, service_id, description, quantity, rate, amount, is_job, applicant_name)
          VALUES ($1, $2, $3, $4, 'Passport Application', 1, 1500.00, 1500.00, true, $5)
        `, [itemId, bizId, invId, serviceIds.passport, partyName]);

        // Create job workflow per BR-12
        const jobId = uuid();
        const deadlineDate = new Date(invDate);
        deadlineDate.setDate(deadlineDate.getDate() + 15);
        const deadlineStr = deadlineDate.toISOString().split('T')[0];
        const assignedStaff = i % 2 === 0 ? staff1MemberId : staff2MemberId;
        const isCompleted = daysAgo > 30; // older jobs are completed

        await client.query(`
          INSERT INTO public.jobs (
            id, business_id, invoice_id, invoice_item_id, service_id, job_type_name,
            party_name, party_mobile, applicant_name, amount, deadline_date,
            assigned_staff_id, commission_percent, status, completed_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'Passport Application',
            $6, $7, $6, 1500.00, $8,
            $9, 20.00, $10, $11
          )
        `, [
          jobId, bizId, invId, itemId, serviceIds.passport,
          partyName, partyMobile, deadlineStr,
          assignedStaff, isCompleted ? 'COMPLETED' : 'IN_PROGRESS',
          isCompleted ? invDate.toISOString() : null,
        ]);

        // Job steps
        const step1Id = uuid();
        const step2Id = uuid();
        const step3Id = uuid();

        await client.query(`
          INSERT INTO public.job_steps (id, business_id, job_id, position, name, whatsapp_message, ticked, ticked_at, ticked_by) VALUES
            ($1, $5, $4, 1, 'Document Verification', 'Hello {party_name}, your documents for {job_name} ({bill_no}) have been verified.', true, now(), $6),
            ($2, $5, $4, 2, 'Police Verification Booked', 'Hello {party_name}, your police verification appointment is scheduled.', $7, now(), $6),
            ($3, $5, $4, 3, 'Passport Dispatched', 'Hello {party_name}, great news! Your passport has been dispatched.', $8, now(), $6)
        `, [step1Id, step2Id, step3Id, jobId, bizId, assignedStaff, isCompleted, isCompleted]);

        // Commission entry per BR-15
        await client.query(`
          INSERT INTO public.commission_entries (id, business_id, job_id, staff_id, base_amount, percent, amount, status, earned_at)
          VALUES ($1, $2, $3, $4, 1500.00, 20.00, 300.00, $5, $6)
        `, [uuid(), bizId, jobId, assignedStaff, isCompleted ? 'EARNED' : 'UPCOMING', isCompleted ? invDate.toISOString() : null]);
      } else {
        // Standard printing bill
        await client.query(`
          INSERT INTO public.invoice_items (business_id, invoice_id, service_id, description, quantity, rate, amount, is_job)
          VALUES ($1, $2, $3, 'Color Printout', $4, $5, $6, false)
        `, [bizId, invId, serviceIds.color_print, qty, 10, subtotal]);
      }

      // 3. If paid > 0, create receipt and allocation atomically
      if (paid > 0) {
        const rcId = uuid();
        const rcNum = `RC-${invoiceNumberCounter}`;
        await client.query(`
          INSERT INTO public.receipts (
            id, business_id, number, fy_label, receipt_date, customer_id,
            amount, mode, reference, kind, unallocated_amount, notes
          ) VALUES (
            $1, $2, $3, '2026-27', $4, $5,
            $6, 'UPI', 'UPI-REF-DEMO', 'INVOICE_PAYMENT', 0, 'Customer payment'
          )
        `, [rcId, bizId, rcNum, dateStr, customerId, paid]);

        await client.query(`
          INSERT INTO public.receipt_allocations (business_id, receipt_id, invoice_id, amount)
          VALUES ($1, $2, $3, $4)
        `, [bizId, rcId, invId, paid]);
      }

    }


    // 6. Seed Vendors & Vendor Payments
    console.log('Seeding Vendors & Vendor Payments...');
    const vendor1 = uuid();
    const vendor2 = uuid();
    const vendor3 = uuid();

    await client.query(`
      INSERT INTO public.vendors (id, business_id, name, mobile) VALUES
        ($1, $4, 'Paper Wholesale Mart', '9811009901'),
        ($2, $4, 'Ink & Toner Depot', '9811009902'),
        ($3, $4, 'Stamps & Stationery Hub', '9811009903')
    `, [vendor1, vendor2, vendor3, bizId]);

    await client.query(`
      INSERT INTO public.payments (business_id, fy_label, payment_date, vendor_id, description, amount, mode, notes) VALUES
        ($4, '2026-27', now() - interval '45 days', $1, '50 Reams A4 75gsm Paper', 12500.00, 'BANK', 'Cheque #10042'),
        ($4, '2026-27', now() - interval '30 days', $2, '4x Canon Toner Cartridges', 8400.00, 'UPI', 'UPI ref 9481'),
        ($4, '2026-27', now() - interval '10 days', $3, 'Stamp Paper stock procurement', 5000.00, 'CASH', 'Cash payment')
    `, [vendor1, vendor2, vendor3, bizId]);

    // 7. Seed Operating Expenses
    console.log('Seeding Operating Expenses...');
    const rentCat = await client.query(`SELECT id FROM public.expense_categories WHERE name = 'Rent' AND business_id = $1`, [bizId]);
    const utilCat = await client.query(`SELECT id FROM public.expense_categories WHERE name = 'Electricity & Utilities' AND business_id = $1`, [bizId]);
    const teaCat = await client.query(`SELECT id FROM public.expense_categories WHERE name = 'Office Tea & Snacks' AND business_id = $1`, [bizId]);

    await client.query(`
      INSERT INTO public.expenses (business_id, fy_label, expense_date, category_id, description, amount, mode, payee) VALUES
        ($1, '2026-27', now() - interval '60 days', $2, 'Shop Monthly Rent - Sep', 25000.00, 'BANK', 'Landlord Mr. Kapoor'),
        ($1, '2026-27', now() - interval '30 days', $2, 'Shop Monthly Rent - Oct', 25000.00, 'BANK', 'Landlord Mr. Kapoor'),
        ($1, '2026-27', now() - interval '20 days', $3, 'Commercial Electricity Bill', 4850.00, 'UPI', 'BSES Delhi'),
        ($1, '2026-27', now() - interval '5 days', $4, 'Monthly Refreshment & Tea', 2200.00, 'CASH', 'Local Tea Stall')
    `, [bizId, rentCat.rows[0].id, utilCat.rows[0].id, teaCat.rows[0].id]);

    // 8. Seed Loans & Repayments (Capital Ledger)
    console.log('Seeding Loans & Loan Repayment with Automatic Interest Expense...');
    const loanId = uuid();
    await client.query(`
      INSERT INTO public.loans (id, business_id, lender_name, amount, loan_date, interest_rate, notes)
      VALUES ($1, $2, 'Sharma Finance Co.', 100000.00, now() - interval '75 days', 12.00, 'Working capital loan')
    `, [loanId, bizId]);

    // Repayment: 20,000 principal + 2,000 interest
    const interestCat = await client.query(`SELECT id FROM public.expense_categories WHERE name = 'Loan Interest' AND business_id = $1`, [bizId]);
    const expInterestId = uuid();

    await client.query(`
      INSERT INTO public.expenses (id, business_id, fy_label, expense_date, category_id, description, amount, mode, payee)
      VALUES ($1, $2, '2026-27', now() - interval '15 days', $3, 'Interest on loan from Sharma Finance Co.', 2000.00, 'BANK', 'Sharma Finance Co.')
    `, [expInterestId, bizId, interestCat.rows[0].id]);

    await client.query(`
      INSERT INTO public.loan_repayments (business_id, loan_id, repayment_date, principal, interest, mode, notes)
      VALUES ($1, $2, now() - interval '15 days', 20000.00, 2000.00, 'BANK', 'Installment #1')
    `, [bizId, loanId]);

    // 9. Staff Payout
    console.log('Seeding Staff Payout...');
    const salaryCat = await client.query(`SELECT id FROM public.expense_categories WHERE name = 'Salary / Commission' AND business_id = $1`, [bizId]);
    const expSalaryId = uuid();

    await client.query(`
      INSERT INTO public.expenses (id, business_id, fy_label, expense_date, category_id, description, amount, mode, staff_id)
      VALUES ($1, $2, '2026-27', now() - interval '7 days', $3, 'Commission Payout to Amit Kumar', 1500.00, 'UPI', $4)
    `, [expSalaryId, bizId, salaryCat.rows[0].id, staff1MemberId]);

    await client.query(`
      INSERT INTO public.staff_payouts (business_id, staff_id, amount, payout_date, mode, notes, expense_id)
      VALUES ($1, $2, 1500.00, now() - interval '7 days', 'UPI', 'Commission payout for 5 passports', $3)
    `, [bizId, staff1MemberId, expSalaryId]);

    await client.query('COMMIT');

    console.log('================================================================');
    console.log('✅ Demo dataset seeded successfully!');
    console.log('----------------------------------------------------------------');
    console.log('Business:    Global Xerox & Doc Services');
    console.log('Owner Login: 9876543210 / password123 (Privacy PIN: 1234)');
    console.log('Staff Login: 9876543211 / password123');
    console.log('Staff 2:     Suresh Verma (offline member, no auth user)');
    console.log('Customers:   30 customers (20 regular, 10 walk-in with ledger)');
    console.log('Invoices:    150 invoices spread across dates');
    console.log('Jobs:        Multi-step Passport workflows with deadlines & commission');
    console.log('Expenses:    Rent, Utilities, Vendor Payments, Staff Payouts');
    console.log('Capital:     ₹1,00,000 Loan (₹20,000 repaid, ₹2,000 interest)');
    console.log('================================================================');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding database:', err);
    throw err;
  } finally {
    await client.end();
  }
}

runSeed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));

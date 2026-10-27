export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type BusinessRole = 'OWNER' | 'ACCOUNTANT' | 'STAFF';
export type CustomerType = 'REGULAR' | 'WALK_IN';
export type DiscountType = 'NONE' | 'FLAT' | 'PERCENT';
export type InvoiceStatus = 'ACTIVE' | 'CANCELLED';
export type PaymentMode = 'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CHEQUE';
export type ReceiptKind = 'INVOICE_PAYMENT' | 'OTHER_INCOME';
export type JobStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type CommissionStatus = 'UPCOMING' | 'EARNED' | 'CANCELLED';
export type NumberingMode = 'CONTINUOUS' | 'FY_RESET';

export interface Database {
  public: {
    Tables: {
      businesses: {
        Row: {
          id: string;
          name: string;
          owner_name: string;
          mobile: string;
          whatsapp: string | null;
          email: string | null;
          address: string | null;
          logo_path: string | null;
          business_type: string | null;
          upi_id: string | null;
          invoice_prefix: string;
          invoice_start_number: number;
          numbering_mode: NumberingMode;
          default_terms_days: number;
          default_notes: string | null;
          footer_text: string | null;
          thermal_width: number;
          receipt_header: string | null;
          receipt_footer: string | null;
          job_management_enabled: boolean;
          yellow_days: number;
          red_days: number;
          commission_trigger: string;
          timezone: string;
          plan: string;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['businesses']['Row']>;
        Update: Partial<Database['public']['Tables']['businesses']['Row']>;
      };
      members: {
        Row: {
          id: string;
          business_id: string;
          auth_user_id: string | null;
          name: string;
          mobile: string;
          role: BusinessRole;
          can_login: boolean;
          active: boolean;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['members']['Row']>;
        Update: Partial<Database['public']['Tables']['members']['Row']>;
      };
      customers: {
        Row: {
          id: string;
          business_id: string;
          type: CustomerType;
          name: string;
          mobile: string | null;
          whatsapp: string | null;
          email: string | null;
          address: string | null;
          notes: string | null;
          possible_duplicate: boolean;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['customers']['Row']>;
        Update: Partial<Database['public']['Tables']['customers']['Row']>;
      };
      services: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          default_rate: number | null;
          category: string | null;
          active: boolean;
          is_job_type: boolean;
          deadline_days: number | null;
          commission_percent: number | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['services']['Row']>;
        Update: Partial<Database['public']['Tables']['services']['Row']>;
      };
      job_type_steps: {
        Row: {
          id: string;
          business_id: string;
          service_id: string;
          position: number;
          name: string;
          whatsapp_message: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['job_type_steps']['Row']>;
        Update: Partial<Database['public']['Tables']['job_type_steps']['Row']>;
      };
      invoices: {
        Row: {
          id: string;
          business_id: string;
          number: string;
          fy_label: string;
          invoice_date: string;
          due_date: string;
          customer_id: string | null;
          party_name: string;
          party_mobile: string | null;
          subtotal: number;
          discount_type: DiscountType;
          discount_value: number;
          discount_amount: number;
          total: number;
          paid_amount: number;
          status: InvoiceStatus;
          cancel_reason: string | null;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['invoices']['Row']>;
        Update: Partial<Database['public']['Tables']['invoices']['Row']>;
      };
      invoice_items: {
        Row: {
          id: string;
          business_id: string;
          invoice_id: string;
          service_id: string | null;
          description: string;
          quantity: number;
          rate: number;
          amount: number;
          is_job: boolean;
          applicant_name: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['invoice_items']['Row']>;
        Update: Partial<Database['public']['Tables']['invoice_items']['Row']>;
      };
      receipts: {
        Row: {
          id: string;
          business_id: string;
          number: string;
          fy_label: string;
          receipt_date: string;
          customer_id: string | null;
          amount: number;
          mode: PaymentMode;
          reference: string | null;
          kind: ReceiptKind;
          income_category: string | null;
          unallocated_amount: number;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['receipts']['Row']>;
        Update: Partial<Database['public']['Tables']['receipts']['Row']>;
      };
      receipt_allocations: {
        Row: {
          id: string;
          business_id: string;
          receipt_id: string;
          invoice_id: string;
          amount: number;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['receipt_allocations']['Row']>;
        Update: Partial<Database['public']['Tables']['receipt_allocations']['Row']>;
      };
      vendors: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          mobile: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['vendors']['Row']>;
        Update: Partial<Database['public']['Tables']['vendors']['Row']>;
      };
      payments: {
        Row: {
          id: string;
          business_id: string;
          fy_label: string;
          payment_date: string;
          vendor_id: string;
          description: string;
          invoice_id: string | null;
          amount: number;
          mode: PaymentMode;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['payments']['Row']>;
        Update: Partial<Database['public']['Tables']['payments']['Row']>;
      };
      expense_categories: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          system: boolean;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['expense_categories']['Row']>;
        Update: Partial<Database['public']['Tables']['expense_categories']['Row']>;
      };
      expenses: {
        Row: {
          id: string;
          business_id: string;
          fy_label: string;
          expense_date: string;
          category_id: string;
          description: string;
          amount: number;
          mode: PaymentMode;
          payee: string | null;
          staff_id: string | null;
          loan_repayment_id: string | null;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['expenses']['Row']>;
        Update: Partial<Database['public']['Tables']['expenses']['Row']>;
      };
      loans: {
        Row: {
          id: string;
          business_id: string;
          lender_name: string;
          amount: number;
          loan_date: string;
          interest_rate: number | null;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['loans']['Row']>;
        Update: Partial<Database['public']['Tables']['loans']['Row']>;
      };
      loan_repayments: {
        Row: {
          id: string;
          business_id: string;
          loan_id: string;
          repayment_date: string;
          principal: number;
          interest: number;
          mode: PaymentMode;
          notes: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['loan_repayments']['Row']>;
        Update: Partial<Database['public']['Tables']['loan_repayments']['Row']>;
      };
      jobs: {
        Row: {
          id: string;
          business_id: string;
          invoice_id: string;
          invoice_item_id: string;
          service_id: string;
          job_type_name: string;
          party_name: string;
          party_mobile: string | null;
          applicant_name: string | null;
          amount: number;
          deadline_date: string;
          assigned_staff_id: string | null;
          commission_percent: number | null;
          status: JobStatus;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['jobs']['Row']>;
        Update: Partial<Database['public']['Tables']['jobs']['Row']>;
      };
      job_steps: {
        Row: {
          id: string;
          business_id: string;
          job_id: string;
          position: number;
          name: string;
          whatsapp_message: string | null;
          ticked: boolean;
          ticked_at: string | null;
          ticked_by: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['job_steps']['Row']>;
        Update: Partial<Database['public']['Tables']['job_steps']['Row']>;
      };
      job_step_events: {
        Row: {
          id: string;
          business_id: string;
          job_step_id: string;
          action: 'TICK' | 'UNTICK';
          member_id: string;
          at: string;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['job_step_events']['Row']>;
        Update: Partial<Database['public']['Tables']['job_step_events']['Row']>;
      };
      commission_entries: {
        Row: {
          id: string;
          business_id: string;
          job_id: string;
          staff_id: string;
          base_amount: number;
          percent: number;
          amount: number;
          status: CommissionStatus;
          earned_at: string | null;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['commission_entries']['Row']>;
        Update: Partial<Database['public']['Tables']['commission_entries']['Row']>;
      };
      staff_payouts: {
        Row: {
          id: string;
          business_id: string;
          staff_id: string;
          amount: number;
          payout_date: string;
          mode: PaymentMode;
          notes: string | null;
          expense_id: string;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['staff_payouts']['Row']>;
        Update: Partial<Database['public']['Tables']['staff_payouts']['Row']>;
      };
      whatsapp_templates: {
        Row: {
          id: string;
          business_id: string;
          type: 'INVOICE' | 'RECEIPT' | 'REMINDER';
          body: string;
          created_at: string;
          created_by: string | null;
          updated_at: string;
          updated_by: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['whatsapp_templates']['Row']>;
        Update: Partial<Database['public']['Tables']['whatsapp_templates']['Row']>;
      };
    };
    Functions: {
      register_business: {
        Args: { business_name: string; owner_name: string; mobile: string };
        Returns: Json;
      };
      update_business: {
        Args: { payload: Json };
        Returns: Json;
      };
      create_invoice: {
        Args: { payload: Json };
        Returns: Json;
      };
      update_invoice: {
        Args: { id: string; payload: Json };
        Returns: Json;
      };
      cancel_invoice: {
        Args: { id: string; reason: string };
        Returns: Json;
      };
      create_receipt: {
        Args: { payload: Json };
        Returns: Json;
      };
      delete_receipt: {
        Args: { id: string };
        Returns: Json;
      };
      apply_advance: {
        Args: { invoice_id: string; receipt_id: string; amount: number };
        Returns: Json;
      };
      record_loan_repayment: {
        Args: { payload: Json };
        Returns: Json;
      };
      pay_staff: {
        Args: { payload: Json };
        Returns: Json;
      };
      tick_step: {
        Args: { step_id: string };
        Returns: Json;
      };
      untick_step: {
        Args: { step_id: string };
        Returns: Json;
      };
      update_job: {
        Args: { id: string; deadline_date?: string; assigned_staff_id?: string };
        Returns: Json;
      };
      soft_delete: {
        Args: { p_table: string; p_id: string };
        Returns: Json;
      };
      restore_record: {
        Args: { p_table: string; p_id: string };
        Returns: Json;
      };
      list_recently_deleted: {
        Args: Record<string, never>;
        Returns: Json;
      };
      dashboard: {
        Args: Record<string, never>;
        Returns: Json;
      };
      report: {
        Args: { type: string; params: Json };
        Returns: Json;
      };
      global_search: {
        Args: { q: string };
        Returns: Json;
      };
      set_privacy_pin: {
        Args: { pin: string };
        Returns: Json;
      };
      verify_privacy_pin: {
        Args: { pin: string };
        Returns: boolean;
      };
    };
  };
}

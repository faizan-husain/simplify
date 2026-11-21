import React, { useState, useEffect } from 'react';
import { Dialog } from '../ui/Dialog';
import { supabase } from '../../lib/supabase';
import { normaliseMobile, isValidIndianMobile } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { useToast } from '../ui/Toast';
import {
  User,
  Smartphone,
  MapPin,
  Mail,
  Check,
  ChevronDown,
  ChevronUp,
  UserCheck,
} from 'lucide-react';
import { Database, CustomerType } from '../../types/supabase';

type Customer = Database['public']['Tables']['customers']['Row'];

interface MatchingDuplicate {
  id: string;
  name: string;
  mobile: string;
  type: string;
  outstanding: number;
}

export interface AddNewCustomerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName?: string;
  initialMobile?: string;
  initialType?: CustomerType;
  onCustomerCreatedAndSelected: (customer: Customer) => void;
}

export const AddNewCustomerModal: React.FC<AddNewCustomerModalProps> = ({
  open,
  onOpenChange,
  initialName = '',
  initialMobile = '',
  initialType = 'REGULAR',
  onCustomerCreatedAndSelected,
}) => {
  const { showToast } = useToast();

  const [name, setName] = useState(initialName);
  const [mobile, setMobile] = useState(initialMobile);
  const [customerType, setCustomerType] = useState<CustomerType>(initialType);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [showOptionalFields, setShowOptionalFields] = useState(false);

  const [saving, setSaving] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<MatchingDuplicate[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);

  // Sync initial values when modal opens
  useEffect(() => {
    if (open) {
      setName(initialName);
      setMobile(initialMobile);
      setCustomerType(initialType);
      setEmail('');
      setAddress('');
      setWhatsapp('');
      setDuplicateMatches([]);
      setShowOptionalFields(false);

      if (initialMobile && isValidIndianMobile(initialMobile)) {
        checkMobileDuplicate(initialMobile);
      }
    }
  }, [open, initialName, initialMobile, initialType]);

  const checkMobileDuplicate = async (rawMobile: string) => {
    const clean = normaliseMobile(rawMobile);
    if (!clean || clean.length !== 10) {
      setDuplicateMatches([]);
      return;
    }

    setCheckingDuplicate(true);
    try {
      const { data, error } = await supabase.rpc('check_customer_mobile', {
        mobile: clean,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        setDuplicateMatches(data as MatchingDuplicate[]);
      } else {
        setDuplicateMatches([]);
      }
    } catch {
      setDuplicateMatches([]);
    } finally {
      setCheckingDuplicate(false);
    }
  };

  const handleMobileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setMobile(val);
    if (isValidIndianMobile(val)) {
      checkMobileDuplicate(val);
    } else {
      setDuplicateMatches([]);
    }
  };

  const handleUseExisting = async (match: MatchingDuplicate) => {
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', match.id)
        .single();

      if (error || !data) {
        throw new Error('Customer not found');
      }

      onCustomerCreatedAndSelected(data as Customer);
      onOpenChange(false);
      showToast(`Selected existing customer: ${data.name}`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to select existing customer', 'error');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('Customer Name is required', 'error');
      return;
    }

    if (!mobile.trim() || !isValidIndianMobile(mobile)) {
      showToast('Please enter a valid 10-digit Indian Mobile Number', 'error');
      return;
    }

    const cleanMobile = normaliseMobile(mobile);

    // If duplicate exists, prompt user
    if (duplicateMatches.length > 0) {
      showToast('A customer with this mobile number already exists.', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: Partial<Customer> = {
        name: name.trim(),
        mobile: cleanMobile,
        type: customerType,
        email: email.trim() || null,
        address: address.trim() || null,
        whatsapp: whatsapp.trim() ? normaliseMobile(whatsapp) : cleanMobile,
      };

      const { data, error } = await supabase
        .from('customers')
        .insert(payload)
        .select('*')
        .single();

      if (error) throw error;

      showToast(`Customer "${data.name}" created and selected!`, 'success');
      onCustomerCreatedAndSelected(data as Customer);
      onOpenChange(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to create customer', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add New Customer"
      description="Create a customer profile to track bill history, ledger & jobs."
      className="sm:max-w-[480px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* Customer Type Selector */}
        <div>
          <label className="text-[12px] font-semibold text-[#64748B] block mb-1.5">
            Customer Type
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#F1F5F9] p-1.5 rounded-2xl border-0 shadow-2xs">
            <button
              type="button"
              onClick={() => setCustomerType('REGULAR')}
              className={`py-2 px-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 ${customerType === 'REGULAR'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/50'
                }`}
            >
              <UserCheck className="w-4 h-4 text-[#0F766E]" />
              <span>Regular Customer</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomerType('WALK_IN')}
              className={`py-2 px-3 rounded-xl text-[13px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 ${customerType === 'WALK_IN'
                ? 'bg-white text-[#0F172A] shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A] hover:bg-white/50'
                }`}
            >
              <User className="w-4 h-4 text-amber-600" />
              <span>Walk-in Profile</span>
            </button>
          </div>
        </div>

        {/* Mandatory Field 1: Customer Name */}
        <div>
          <label className="text-[12.5px] font-semibold text-[#0F172A] flex items-center gap-1">
            <span>Customer Name</span>
            <span className="text-red-500">*</span>
          </label>
          <div className="relative mt-1">
            <User className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              required
              placeholder="e.g. Ramesh Kumar"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-11 pl-9 pr-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Mandatory Field 2: Mobile Number */}
        <div>
          <label className="text-[12.5px] font-semibold text-[#0F172A] flex items-center justify-between">
            <span className="flex items-center gap-1">
              <span>Mobile Number</span>
              <span className="text-red-500">*</span>
            </span>
            <span className="text-[11px] font-normal text-[#64748B]">10 digits</span>
          </label>
          <div className="relative mt-1">
            <Smartphone className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="tel"
              required
              inputMode="tel"
              placeholder="9876543210"
              value={mobile}
              onChange={handleMobileChange}
              className="w-full h-11 pl-9 pr-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-semibold tracking-wide text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none transition-all"
            />
          </div>
        </div>

        {/* Real-time Duplicate Customer Alert Banner (Smooth, Borderless) */}
        {duplicateMatches.length > 0 && (
          <div className="p-4 rounded-2xl bg-[#EAF2F1] border-0 text-xs text-[#0F766E] space-y-2.5 animate-in fade-in shadow-[0_2px_8px_rgba(15,118,110,0.06)]">
            <div className="flex items-start gap-2.5">
              <div className="w-2 h-2 rounded-full bg-[#0F766E] shrink-0 mt-1" />
              <div>
                <p className="font-semibold text-[#134E4A]">
                  Customer already exists with this mobile number
                </p>
                <p className="mt-0.5 text-[#0F766E]/90 leading-normal">
                  <strong>{duplicateMatches[0].name}</strong> ({duplicateMatches[0].type}) · {duplicateMatches[0].mobile}
                  {duplicateMatches[0].outstanding > 0
                    ? ` · Outstanding: ${formatINR(duplicateMatches[0].outstanding)}`
                    : ' · No dues'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleUseExisting(duplicateMatches[0])}
              className="w-full py-2.5 px-3 rounded-xl bg-[#0F766E] hover:bg-[#0D635C] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs border-0"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Use Existing Customer</span>
            </button>
          </div>
        )}

        {/* Optional Fields Toggle */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowOptionalFields(!showOptionalFields)}
            className="text-[12.5px] font-medium text-[#0F766E] hover:underline flex items-center gap-1 cursor-pointer select-none"
          >
            <span>{showOptionalFields ? 'Hide additional fields' : '+ Add Address, Email, WhatsApp (Optional)'}</span>
            {showOptionalFields ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {showOptionalFields && (
            <div className="mt-3 space-y-3 pt-3 border-t border-slate-100/70 animate-in fade-in duration-150">
              {/* Address */}
              <div>
                <label className="text-[12px] font-medium text-[#64748B] block mb-1">
                  Address
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-[#94A3B8] absolute left-3 top-3 pointer-events-none" />
                  <textarea
                    rows={2}
                    placeholder="Shop/House number, Street, City"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E2E8F0] text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none resize-none"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="text-[12px] font-medium text-[#64748B] block mb-1">
                  Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    placeholder="customer@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-10 pl-9 pr-3 rounded-xl border border-[#E2E8F0] text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none"
                  />
                </div>
              </div>

              {/* WhatsApp Number */}
              <div>
                <label className="text-[12px] font-medium text-[#64748B] block mb-1">
                  WhatsApp Number (if different from mobile)
                </label>
                <input
                  type="tel"
                  placeholder="Leave empty to use primary mobile"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-[#E2E8F0] text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="flex items-center gap-2.5 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex-1 h-11 rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-[13.5px] font-medium text-slate-800 transition-all cursor-pointer shadow-2xs"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || checkingDuplicate || duplicateMatches.length > 0}
            className="flex-1 h-11 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-[13.5px] font-semibold transition-all cursor-pointer shadow-xs active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? 'Creating...' : 'Create Customer & Select'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};


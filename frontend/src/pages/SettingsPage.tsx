import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePwa } from '../context/PwaContext';
import { useToast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { WhatsAppTemplatesModal } from '../components/settings/WhatsAppTemplatesModal';
import { PrivacyPinModal } from '../components/privacy/PrivacyPinModal';
import { TeamMembersSection } from '../components/settings/TeamMembersSection';
import { ChangePasswordCard } from '../components/settings/ChangePasswordCard';
import { clsx } from 'clsx';
import {
  Building2,
  Receipt,
  QrCode,
  Briefcase,
  MessageSquare,
  Lock,
  ArrowLeft,
  Save,
  Shield,
  Users,
  CheckCircle2,
  SlidersHorizontal,
  ChevronRight,
  Smartphone,
  Download,
} from 'lucide-react';

type SettingsTab = 'ALL' | 'PROFILE' | 'INVOICING' | 'WORKFLOWS' | 'TEAM' | 'SECURITY' | 'APP';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, role, refreshProfile } = useAuth();
  const { isInstalled, installStatus, promptInstall, openInstallModal } = usePwa();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<SettingsTab>('ALL');
  const [saving, setSaving] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  // Form State
  const [form, setForm] = useState({
    name: '',
    owner_name: '',
    mobile: '',
    email: '',
    address: '',
    upi_id: '',
    invoice_prefix: 'INV-',
    numbering_mode: 'CONTINUOUS',
    default_terms_days: 0,
    default_notes: '',
    footer_text: '',
    thermal_width: 80,
    receipt_header: '',
    receipt_footer: '',
    job_management_enabled: false,
    yellow_days: 5,
    red_days: 3,
  });

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name || '',
        owner_name: business.owner_name || '',
        mobile: business.mobile || '',
        email: business.email || '',
        address: business.address || '',
        upi_id: business.upi_id || '',
        invoice_prefix: business.invoice_prefix || 'INV-',
        numbering_mode: business.numbering_mode || 'CONTINUOUS',
        default_terms_days: business.default_terms_days || 0,
        default_notes: business.default_notes || '',
        footer_text: business.footer_text || '',
        thermal_width: business.thermal_width || 80,
        receipt_header: business.receipt_header || '',
        receipt_footer: business.receipt_footer || '',
        job_management_enabled: Boolean(business.job_management_enabled),
        yellow_days: business.yellow_days || 5,
        red_days: business.red_days || 3,
      });
    }
  }, [business]);

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.name.trim()) {
      showToast('Business name cannot be empty', 'error');
      return;
    }

    if (role !== 'OWNER') {
      showToast('Only the business owner can edit settings', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('update_business', {
        payload: {
          name: form.name.trim(),
          owner_name: form.owner_name.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim(),
          address: form.address.trim(),
          upi_id: form.upi_id.trim(),
          invoice_prefix: form.invoice_prefix.trim(),
          numbering_mode: form.numbering_mode,
          default_terms_days: Number(form.default_terms_days) || 0,
          default_notes: form.default_notes.trim(),
          footer_text: form.footer_text.trim(),
          thermal_width: Number(form.thermal_width) || 80,
          receipt_header: form.receipt_header.trim(),
          receipt_footer: form.receipt_footer.trim(),
          job_management_enabled: form.job_management_enabled,
          yellow_days: Number(form.yellow_days) || 5,
          red_days: Number(form.red_days) || 3,
        },
      });

      if (error) throw error;

      // Update current member's name as well to guarantee immediate sync
      if (member?.id && form.owner_name.trim()) {
        await supabase
          .from('members')
          .update({ name: form.owner_name.trim() })
          .eq('id', member.id);
      }

      await refreshProfile();
      showToast('Settings updated successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'ALL', label: 'All Settings', icon: SlidersHorizontal },
    { id: 'PROFILE', label: 'Business Profile', icon: Building2 },
    { id: 'INVOICING', label: 'Invoicing & Print', icon: Receipt },
    { id: 'WORKFLOWS', label: 'Service Workflows', icon: Briefcase },
    ...(role === 'OWNER' ? [{ id: 'TEAM' as SettingsTab, label: 'Team & Roles', icon: Users }] : []),
    { id: 'SECURITY', label: 'Security & PIN', icon: Shield },
    { id: 'APP', label: 'App Installation', icon: Smartphone },
  ];

  const showProfile = activeTab === 'ALL' || activeTab === 'PROFILE';
  const showInvoicing = activeTab === 'ALL' || activeTab === 'INVOICING';
  const showWorkflows = activeTab === 'ALL' || activeTab === 'WORKFLOWS';
  const showTeam = role === 'OWNER' && (activeTab === 'ALL' || activeTab === 'TEAM');
  const showSecurity = activeTab === 'ALL' || activeTab === 'SECURITY';
  const showApp = activeTab === 'ALL' || activeTab === 'APP';

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/more')}
            className="p-2.5 rounded-xl border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 shadow-2xs hover:shadow-xs transition-all shrink-0 cursor-pointer"
            title="Back to More menu"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A] truncate">Settings</h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border-0 shrink-0">
                {role === 'OWNER' ? 'Owner Admin' : role}
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#64748B] mt-0.5 truncate">
              Manage your business profile, print formats, service workflows, and security
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Pills Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 cursor-pointer border-0',
                isActive
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-[#EEF0F3] text-slate-700 shadow-2xs hover:bg-slate-200 hover:text-slate-900'
              )}
            >
              <Icon className={clsx('w-3.5 h-3.5', isActive ? 'text-slate-200' : 'text-slate-500')} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Card 1: Business Profile */}
        {showProfile && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <Building2 className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Business Profile</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your business identity printed on bills, receipts, and customer statements
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <Input
                  label="Business Name"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g. Modern Xerox & Services"
                  required
                />
              </div>
              <div>
                <Input
                  label="Header Tagline / Sub-Text"
                  placeholder="e.g. Fast • Reliable • Professional"
                  value={form.receipt_header}
                  onChange={(e) => handleChange('receipt_header', e.target.value)}
                />
              </div>
              <div>
                <Input
                  label="Owner / Contact Person"
                  value={form.owner_name}
                  onChange={(e) => handleChange('owner_name', e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                />
              </div>
              <div>
                <Input
                  label="Business Mobile Number"
                  value={form.mobile}
                  onChange={(e) => handleChange('mobile', e.target.value)}
                  placeholder="10-digit phone number"
                />
              </div>
              <div>
                <Input
                  label="Business Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="contact@business.com"
                />
              </div>
              <div className="md:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Shop / Office Address
                </label>
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200/90 text-xs text-slate-900 bg-white hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 resize-none transition-all shadow-2xs"
                  placeholder="Full shop or office address (e.g. Shop No. 4, Market Complex, Civil Lines)..."
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Printed in the header of thermal receipts and standard invoices.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Card 2: Payment & Dynamic UPI QR */}
        {showProfile && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <QrCode className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Payment &amp; Dynamic UPI QR Code</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enable instant cashless payments with zero gateway fees via UPI (GPay, PhonePe, Paytm)
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              <div className="lg:col-span-7 space-y-3">
                <Input
                  label="UPI ID (VPA)"
                  placeholder="e.g. 9876543210@upi or business@okaxis"
                  value={form.upi_id}
                  onChange={(e) => handleChange('upi_id', e.target.value)}
                />
                <div className="p-3.5 rounded-xl bg-[#EEF0F3] border-0 text-xs text-slate-600 space-y-1 shadow-2xs">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-[#0F766E] shrink-0" />
                    <span>Direct Zero-Fee Bank Settlement</span>
                  </div>
                  <p className="leading-relaxed text-slate-500">
                    When configured, any invoice with an unpaid balance will automatically generate a dynamic UPI QR code pre-filled with the exact balance due.
                  </p>
                </div>
              </div>

              <div className="lg:col-span-5 flex flex-col items-center justify-center p-5 rounded-xl border-0 bg-[#EEF0F3] text-center shadow-2xs">
                <div className="w-14 h-14 rounded-xl bg-white border-0 shadow-xs flex items-center justify-center text-slate-700 mb-2">
                  <QrCode className="w-8 h-8 stroke-[1.5] text-slate-700" />
                </div>
                <div className="text-xs font-bold text-slate-900 break-all max-w-full px-2">
                  {form.upi_id.trim() ? form.upi_id.trim() : 'No UPI ID Configured'}
                </div>
                <span className="text-[11px] text-slate-400 mt-0.5">
                  {form.upi_id.trim() ? 'Active on all balance bills' : 'Enter your VPA on the left to activate'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Card 3: Invoicing & Print Format */}
        {showInvoicing && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <Receipt className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Invoicing &amp; Print Format</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Configure invoice serial numbering, customer credit terms, and POS thermal printer width
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Input
                label="Invoice Prefix"
                value={form.invoice_prefix}
                onChange={(e) => handleChange('invoice_prefix', e.target.value)}
                placeholder="INV-"
              />
              <Select
                label="Numbering Mode"
                value={form.numbering_mode}
                onChange={(val) => handleChange('numbering_mode', val)}
                options={[
                  { label: 'Continuous (INV-1001)', value: 'CONTINUOUS' },
                  { label: 'Reset Every FY (INV-2026-27-0001)', value: 'FY_RESET' },
                ]}
              />
              <Input
                label="Default Credit Due Days"
                type="number"
                value={form.default_terms_days}
                onChange={(e) => handleChange('default_terms_days', e.target.value)}
              />
              <Select
                label="Thermal Printer Width"
                value={String(form.thermal_width)}
                onChange={(val) => handleChange('thermal_width', Number(val))}
                options={[
                  { label: '80mm (Standard POS)', value: '80' },
                  { label: '58mm (Compact Mobile POS)', value: '58' },
                ]}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 pt-1">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Terms &amp; Conditions / Invoice Footer
                </label>
                <textarea
                  rows={3}
                  value={form.footer_text}
                  onChange={(e) => handleChange('footer_text', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200/90 text-xs text-slate-900 bg-white hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 resize-none transition-all shadow-2xs"
                  placeholder="e.g. Terms: Service fees non-refundable after job processing begins. Subject to local jurisdiction."
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Printed at the bottom of all invoices and receipts as your legal terms.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Default Bill Notes
                </label>
                <textarea
                  rows={3}
                  value={form.default_notes}
                  onChange={(e) => handleChange('default_notes', e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200/90 text-xs text-slate-900 bg-white hover:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 resize-none transition-all shadow-2xs"
                  placeholder="e.g. Thank you for your business! For queries, contact our WhatsApp support."
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Default greeting or note automatically filled on new bills.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Card 4: Job Management (Service Workflows) */}
        {showWorkflows && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <Briefcase className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Job Management (Service Workflows)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Track multi-step service orders (e.g. Passport, PAN, Notary), staff deadlines, and commissions
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl border-0 bg-[#EEF0F3] shadow-2xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-bold text-slate-900">Enable Service Job Tracking</span>
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider border-0',
                      form.job_management_enabled
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-200/70 text-slate-600'
                    )}
                  >
                    {form.job_management_enabled ? 'Active' : 'Disabled'}
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Assign multi-step tasks to staff, track step progress, monitor deadlines, and auto-calculate commissions
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                <input
                  type="checkbox"
                  checked={form.job_management_enabled}
                  onChange={(e) => handleChange('job_management_enabled', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-12 h-6.5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5.5 after:w-5.5 after:transition-all peer-checked:bg-slate-900" />
              </label>
            </div>

            {form.job_management_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-1">
                <div className="p-4 rounded-xl border-0 bg-[#EEF0F3] space-y-3 shadow-2xs">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
                    <span>Yellow Alert Threshold</span>
                  </div>
                  <Input
                    label="Days Left Before Deadline"
                    type="number"
                    value={form.yellow_days}
                    onChange={(e) => handleChange('yellow_days', e.target.value)}
                  />
                  <p className="text-[11.5px] text-slate-500">
                    Jobs with ≤ this many days remaining turn Yellow on the Job Board for early attention.
                  </p>
                </div>

                <div className="p-4 rounded-xl border-0 bg-[#EEF0F3] space-y-3 shadow-2xs">
                  <div className="flex items-center gap-2 text-slate-800 font-semibold text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400 shrink-0" />
                    <span>Red Alert Threshold</span>
                  </div>
                  <Input
                    label="Critical Days Left Before Deadline"
                    type="number"
                    value={form.red_days}
                    onChange={(e) => handleChange('red_days', e.target.value)}
                  />
                  <p className="text-[11.5px] text-slate-500">
                    Jobs with ≤ this many days remaining turn Red on the Job Board with urgent priority.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Card 5: Communication & Privacy Security */}
        {showSecurity && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <Lock className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Communication &amp; Privacy Security</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Manage customer WhatsApp message templates and confidential privacy PIN
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* WhatsApp Templates Action Card */}
              <div
                onClick={() => setIsTemplatesOpen(true)}
                className="p-5 rounded-2xl border-0 bg-[#EEF0F3] hover:bg-[#E2E6EA] shadow-2xs hover:shadow-xs cursor-pointer transition-all group flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-xl bg-white text-slate-700 border-0 shadow-2xs flex items-center justify-center mb-3 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                    <MessageSquare className="w-4.5 h-4.5" />
                  </div>
                  <h3 className="text-[14px] font-bold text-slate-900 group-hover:text-slate-900 transition-colors">
                    WhatsApp Message Templates
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Customize pre-filled message text for sharing Invoices, Receipts, and Overdue Payment reminders.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                  <span>Configure Templates</span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>

              {/* Privacy PIN Action Card */}
              <div
                onClick={() => setIsPinModalOpen(true)}
                className="p-5 rounded-2xl border-0 bg-[#EEF0F3] hover:bg-[#E2E6EA] shadow-2xs hover:shadow-xs cursor-pointer transition-all group flex flex-col justify-between"
              >
                <div>
                  <div className="w-9 h-9 rounded-xl bg-white text-slate-700 border-0 shadow-2xs flex items-center justify-center mb-3 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                    <Lock className="w-4.5 h-4.5" />
                  </div>
                  <h3 className="text-[14px] font-bold text-slate-900 group-hover:text-slate-900 transition-colors">
                    Master Privacy PIN
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Set or update a 4-digit security PIN to mask confidential net profit, loan ledgers, and reports.
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs font-semibold text-slate-700 group-hover:text-slate-900">
                  <span>Set / Change PIN</span>
                  <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Card: App Installation */}
        {showApp && (
          <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
                  <Smartphone className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">App Installation</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Install Simplify on your device for a more convenient app experience.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-5 rounded-2xl bg-[#F6F7F9] border-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <img
                  src="/pwa-192x192.png"
                  alt="Simplify"
                  className="w-14 h-14 rounded-2xl object-contain bg-white p-1.5 shadow-2xs shrink-0"
                />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900">Simplify</h3>
                    {isInstalled ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border-0 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        App Installed
                      </span>
                    ) : installStatus === 'IN_PROGRESS' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border-0 inline-flex items-center gap-1 animate-pulse">
                        Installing...
                      </span>
                    ) : installStatus === 'AVAILABLE' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border-0 inline-flex items-center gap-1">
                        Installation Available
                      </span>
                    ) : installStatus === 'DISMISSED' ? (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700 border-0 inline-flex items-center gap-1">
                        Installation Dismissed
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border-0 inline-flex items-center gap-1">
                        Not Installed
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    {isInstalled
                      ? 'Simplify is running in verified standalone app mode on this device.'
                      : 'Made business simple'}
                  </p>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {isInstalled ? (
                  <div className="px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-1.5 shadow-2xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>App Installed</span>
                  </div>
                ) : installStatus === 'IN_PROGRESS' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    disabled
                    className="bg-slate-900 text-white font-semibold shadow-2xs border-0 rounded-xl"
                  >
                    Installing...
                  </Button>
                ) : installStatus === 'AVAILABLE' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => promptInstall()}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-2xs border-0 rounded-xl"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Install App
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={() => openInstallModal()}
                    className="bg-slate-900 hover:bg-slate-800 text-white font-semibold shadow-2xs border-0 rounded-xl"
                  >
                    <Smartphone className="w-4 h-4 mr-2" />
                    Install App
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Sticky / Bottom Save Bar */}
        {role === 'OWNER' && (
          <div className="sticky bottom-4 z-20 p-4 sm:p-4.5 rounded-2xl bg-white/95 backdrop-blur-md border-0 shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-[#64748B] text-center sm:text-left min-w-0 flex-1">
              <span className="font-semibold text-[#0F172A]">Need to apply configuration changes?</span>{' '}
              Click Save to update your profile and print formats across all devices.
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => navigate('/more')}
                className="flex-1 sm:flex-initial px-6 h-[42px] border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer"
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={saving}
                className="bg-slate-900 hover:bg-slate-800 text-white flex-1 sm:flex-initial px-7 h-[42px] font-semibold shadow-2xs border-0 rounded-xl"
              >
                <Save className="w-4 h-4 mr-2 shrink-0" />
                <span className="whitespace-nowrap">Save All Settings</span>
              </Button>
            </div>
          </div>
        )}
      </form>

      {/* Team Members Management (Owner Only) */}
      {showTeam && (
        <div className="pt-2">
          <TeamMembersSection />
        </div>
      )}

      {/* Self-Service Password Change (All Users) */}
      {showSecurity && (
        <div className="pt-2">
          <ChangePasswordCard />
        </div>
      )}

      {/* WhatsApp Templates Modal */}
      <WhatsAppTemplatesModal
        open={isTemplatesOpen}
        onOpenChange={setIsTemplatesOpen}
      />

      {/* Privacy PIN Modal (Set Mode) */}
      <PrivacyPinModal
        open={isPinModalOpen}
        onOpenChange={setIsPinModalOpen}
        mode="set"
        onSuccess={() => {
          showToast('Privacy PIN updated', 'success');
        }}
      />
    </div>
  );
};

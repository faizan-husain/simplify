import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { WhatsAppTemplatesModal } from '../components/settings/WhatsAppTemplatesModal';
import { PrivacyPinModal } from '../components/privacy/PrivacyPinModal';
import {
  Building2,
  Receipt,
  QrCode,
  Briefcase,
  MessageSquare,
  Lock,
  ArrowLeft,
  Save,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, role, refreshProfile } = useAuth();
  const { showToast } = useToast();

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/more')}
            className="p-1.5 rounded-lg border border-border bg-white hover:bg-surface text-text"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-text">Settings</h1>
            <p className="text-xs text-text-muted">Business profile, billing formats and preferences</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Business Profile */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Building2 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-text">Business Profile</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Business Name"
              value={form.name}
              onChange={(e) => handleChange('name', e.target.value)}
              required
            />
            <Input
              label="Owner Name"
              value={form.owner_name}
              onChange={(e) => handleChange('owner_name', e.target.value)}
            />
            <Input
              label="Business Mobile"
              value={form.mobile}
              onChange={(e) => handleChange('mobile', e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => handleChange('email', e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text-muted block mb-1">
              Address
            </label>
            <textarea
              rows={2}
              value={form.address}
              onChange={(e) => handleChange('address', e.target.value)}
              className="w-full p-2.5 rounded-lg border border-border text-xs text-text bg-surface focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
              placeholder="Shop/Office address..."
            />
          </div>
        </Card>

        {/* Payment & UPI QR */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <QrCode className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-text">Payment &amp; UPI QR Code</h2>
          </div>

          <div>
            <Input
              label="UPI ID (VPA)"
              placeholder="e.g. business@okaxis"
              value={form.upi_id}
              onChange={(e) => handleChange('upi_id', e.target.value)}
            />
            <p className="text-[11px] text-text-muted mt-1">
              When provided, invoices with a balance due will display a dynamic UPI QR code for fast customer payments.
            </p>
          </div>
        </Card>

        {/* Invoice & Thermal Receipt Settings */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Receipt className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-text">Invoicing &amp; Print Format</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Invoice Prefix"
              value={form.invoice_prefix}
              onChange={(e) => handleChange('invoice_prefix', e.target.value)}
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
              label="Default Due Days"
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

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">
                Default Bill Notes
              </label>
              <textarea
                rows={2}
                value={form.default_notes}
                onChange={(e) => handleChange('default_notes', e.target.value)}
                className="w-full p-2.5 rounded-lg border border-border text-xs text-text bg-surface focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none"
                placeholder="Notes visible on every new bill..."
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">
                Receipt Footer Text
              </label>
              <input
                type="text"
                value={form.footer_text}
                onChange={(e) => handleChange('footer_text', e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border text-xs text-text bg-surface focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                placeholder="Thank you for your business!"
              />
            </div>
          </div>
        </Card>

        {/* Job Management Settings */}
        <Card className="p-4 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Briefcase className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-text">Job Management (Service Workflows)</h2>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-text">Enable Job Management</div>
              <div className="text-[11px] text-text-muted">
                Track multi-step service orders, deadlines, and staff commission
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={form.job_management_enabled}
                onChange={(e) => handleChange('job_management_enabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
            </label>
          </div>

          {form.job_management_enabled && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <Input
                label="Yellow Alert (Days Left)"
                type="number"
                value={form.yellow_days}
                onChange={(e) => handleChange('yellow_days', e.target.value)}
              />
              <Input
                label="Red Alert (Days Left)"
                type="number"
                value={form.red_days}
                onChange={(e) => handleChange('red_days', e.target.value)}
              />
            </div>
          )}
        </Card>

        {/* Templates & Security Controls */}
        <Card className="p-4 space-y-3">
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-1">
            Communication &amp; Security
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              type="button"
              variant="outline"
              size="md"
              className="flex-1 justify-center"
              onClick={() => setIsTemplatesOpen(true)}
            >
              <MessageSquare className="w-4 h-4 mr-2 text-primary" />
              <span>WhatsApp Templates</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              className="flex-1 justify-center"
              onClick={() => setIsPinModalOpen(true)}
            >
              <Lock className="w-4 h-4 mr-2 text-primary" />
              <span>Set / Change Privacy PIN</span>
            </Button>
          </div>
        </Card>

        {/* Save Bar */}
        <div className="flex justify-end pt-2">
          <Button
            type="submit"
            size="lg"
            loading={saving}
            className="w-full sm:w-auto px-8"
          >
            <Save className="w-4 h-4 mr-2" />
            <span>Save Settings</span>
          </Button>
        </div>
      </form>

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

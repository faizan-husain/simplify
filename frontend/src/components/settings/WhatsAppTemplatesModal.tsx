import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { Tag } from 'lucide-react';

export interface WhatsAppTemplatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const WhatsAppTemplatesModal: React.FC<WhatsAppTemplatesModalProps> = ({
  open,
  onOpenChange,
}) => {
  const { showToast } = useToast();

  const [templateType, setTemplateType] = useState<'INVOICE' | 'RECEIPT' | 'REMINDER'>('INVOICE');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const variableChips = [
    '{customer_name}',
    '{invoice_no}',
    '{amount}',
    '{balance}',
    '{due_date}',
    '{business_name}',
  ];

  const loadTemplate = async (type: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_templates')
        .select('body')
        .eq('type', type)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setBody(data.body);
      } else {
        // Fallback default text
        if (type === 'INVOICE') {
          setBody('Hello {customer_name}, here is your bill #{invoice_no} of {amount} from {business_name}. Balance due: {balance}.');
        } else if (type === 'RECEIPT') {
          setBody('Hello {customer_name}, received payment of {amount} for bill #{invoice_no}. Thank you! - {business_name}');
        } else {
          setBody('Hello {customer_name}, reminder for bill #{invoice_no} of {amount}. Balance {balance} is due on {due_date}. - {business_name}');
        }
      }
    } catch (err: any) {
      showToast('Failed to load template', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      loadTemplate(templateType);
    }
  }, [open, templateType]);

  const handleInsertVariable = (variable: string) => {
    setBody((prev) => prev + ' ' + variable);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) {
      showToast('Template body cannot be empty', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('whatsapp_templates')
        .upsert(
          {
            type: templateType,
            body: body.trim(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'business_id,type' }
        );

      if (error) throw error;
      showToast('WhatsApp template saved successfully', 'success');
      onOpenChange(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="WhatsApp Message Templates"
      description="Customise the message text sent to customers via WhatsApp deep-links."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Select
          label="Template Type"
          value={templateType}
          onChange={(val) => setTemplateType(val as any)}
          options={[
            { label: 'Invoice / Bill Share', value: 'INVOICE' },
            { label: 'Payment Receipt', value: 'RECEIPT' },
            { label: 'Payment Due Reminder', value: 'REMINDER' },
          ]}
        />

        <div>
          <label className="text-xs font-medium text-text-muted block mb-1.5">
            Template Text
          </label>
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={loading}
            className="w-full p-3 rounded-control border border-hair text-xs text-text bg-surface-2 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent resize-none transition-colors"
            placeholder="Type your WhatsApp message..."
            required
          />
        </div>

        {/* Variable chips */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-text-muted flex items-center gap-1">
            <Tag className="w-3 h-3" />
            <span>Click to insert variable:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {variableChips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleInsertVariable(chip)}
                className="px-2 py-0.5 rounded-full bg-surface-2 hover:bg-surface hover:text-text text-[11px] font-mono text-text-muted border border-hair transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="w-full sm:w-auto border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl shadow-2xs"
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-2xs border-0">
            Save Template
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Database } from '../../types/supabase';

type ExpenseCategory = Database['public']['Tables']['expense_categories']['Row'];

export interface NewExpenseModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenseToEdit?: any | null;
  onSuccess?: () => void;
}

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

export const NewExpenseModal: React.FC<NewExpenseModalProps> = ({
  open,
  onOpenChange,
  expenseToEdit,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<typeof PAYMENT_MODES[number]>('CASH');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // New category inline
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategory, setSavingCategory] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fetchCategories = async () => {
      const { data } = await supabase
        .from('expense_categories')
        .select('*')
        .is('deleted_at', null)
        .eq('system', false) // Exclude system categories like Salary / Commission and Loan Interest
        .order('name', { ascending: true });

      const list = (data as ExpenseCategory[]) || [];
      setCategories(list);
      if (expenseToEdit?.category_id) {
        setSelectedCategoryId(expenseToEdit.category_id);
      } else if (list.length > 0 && !selectedCategoryId) {
        setSelectedCategoryId(list[0].id);
      }
    };
    fetchCategories();

    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name, account_number')
      .is('deleted_at', null)
      .order('bank_name')
      .then(({ data }) => {
        const bList = data || [];
        setBankAccounts(bList);
        if (expenseToEdit?.bank_account_id) {
          setSelectedBankId(expenseToEdit.bank_account_id);
        } else if (bList.length > 0 && !selectedBankId) {
          setSelectedBankId(bList[0].id);
        }
      });
  }, [open, expenseToEdit]);

  // Pre-fill state when editing expense
  useEffect(() => {
    if (open && expenseToEdit) {
      setSelectedCategoryId(expenseToEdit.category_id || '');
      setAmount(String(expenseToEdit.amount || ''));
      setMode(expenseToEdit.mode || 'CASH');
      setSelectedBankId(expenseToEdit.bank_account_id || '');
      setDescription(expenseToEdit.description || '');
      setPayee(expenseToEdit.payee || '');
      setExpenseDate(expenseToEdit.expense_date || new Date().toISOString().split('T')[0]);
      setNotes(expenseToEdit.notes || '');
    } else if (open && !expenseToEdit) {
      setAmount('');
      setDescription('');
      setPayee('');
      setNotes('');
      setExpenseDate(new Date().toISOString().split('T')[0]);
    }
  }, [open, expenseToEdit]);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    try {
      const { data, error } = await supabase
        .from('expense_categories')
        .insert({
          name: newCategoryName.trim(),
          system: false,
        })
        .select()
        .single();

      if (error) throw error;
      const newCat = data as ExpenseCategory;
      setCategories((prev) => [...prev, newCat]);
      setSelectedCategoryId(newCat.id);
      setNewCategoryName('');
      setIsAddingCategory(false);
      showToast(`Category '${newCat.name}' created`, 'success');
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    let catId = selectedCategoryId;
    if (!catId) {
      if (newCategoryName.trim()) {
        const { data: newCat, error: cErr } = await supabase
          .from('expense_categories')
          .insert({ name: newCategoryName.trim(), system: false })
          .select()
          .single();
        if (cErr) throw cErr;
        catId = (newCat as ExpenseCategory).id;
      } else if (categories.length > 0) {
        catId = categories[0].id;
      } else {
        const { data: newCat, error: cErr } = await supabase
          .from('expense_categories')
          .insert({ name: 'General Expense', system: false })
          .select()
          .single();
        if (cErr) throw cErr;
        catId = (newCat as ExpenseCategory).id;
      }
    }

    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    if (!description.trim()) {
      showToast('Please enter a description', 'error');
      return;
    }

    if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} expense`, 'error');
      return;
    }

    setSaving(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);

      if (expenseToEdit) {
        const { error } = await supabase
          .from('expenses')
          .update({
            category_id: catId,
            amount: amtNum,
            mode,
            bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
            bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
            expense_date: expenseDate,
            description: description.trim(),
            payee: payee.trim() || null,
            notes: notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', expenseToEdit.id);

        if (error) throw error;
        showToast('Expense updated successfully', 'success');
      } else {
        const { error } = await supabase.from('expenses').insert({
          category_id: catId,
          amount: amtNum,
          mode,
          bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
          bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
          expense_date: expenseDate,
          description: description.trim(),
          payee: payee.trim() || null,
          notes: notes.trim() || null,
          fy_label: '', // trigger sets it
        });

        if (error) throw error;
        showToast('Expense recorded successfully', 'success');
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={expenseToEdit ? 'Edit Expense' : t('expenses.add_expense')}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Category Picker with inline add */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <label className="text-xs font-semibold text-text">{t('expenses.category')}</label>
            <button
              type="button"
              className="text-[10px] text-primary font-semibold hover:underline"
              onClick={() => setIsAddingCategory((prev) => !prev)}
            >
              {isAddingCategory ? 'Select existing' : '+ Custom Category'}
            </button>
          </div>

          {isAddingCategory ? (
            <div className="flex gap-2">
              <Input
                placeholder="New category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
              />
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleCreateCategory}
                loading={savingCategory}
              >
                Add
              </Button>
            </div>
          ) : (
            <Select
              value={selectedCategoryId}
              onChange={setSelectedCategoryId}
              options={categories.map((c) => ({
                value: c.id,
                label: c.name,
              }))}
              searchable={categories.length > 5}
              placeholder="Select category..."
            />
          )}
        </div>

        {/* Amount & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-text block mb-1">Amount (₹)</label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              autoFocus={!isAddingCategory}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text block mb-1">Date</label>
            <Input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
            />
          </div>
        </div>

        {/* Payment Mode */}
        <div>
          <label className="text-xs font-medium text-text-muted block mb-1.5">Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-control text-xs font-medium transition-all border ${
                  mode === m
                    ? 'bg-surface-2 text-text border-accent ring-1 ring-accent'
                    : 'bg-surface text-text-muted border-hair hover:bg-surface-2 hover:text-text'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Bank Account Selection for Online / Bank Modes */}
        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3.5 bg-surface-2 rounded-control border border-hair space-y-2">
            <Select
              label="Paid from Bank Account"
              required
              value={selectedBankId}
              onChange={setSelectedBankId}
              options={[
                { value: '', label: '-- Select Bank Account * --' },
                ...bankAccounts.map((b) => ({
                  value: b.id,
                  label: `${b.bank_name} (${b.account_name} - ${b.account_number || 'General'})`,
                })),
              ]}
              size="sm"
              searchable={bankAccounts.length > 5}
            />
          </div>
        )}

        <Input
          label="Description / Purpose"
          placeholder="e.g. Electricity bill for Oct"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Payee (Optional)"
            placeholder="e.g. BESCOM / Landlord"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
          />

          <Input
            label="Notes (Optional)"
            placeholder="Remarks"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-3 border-t border-hair">
          <Button
            type="button"
            variant="outline"
            size="md"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="flex-1"
            loading={saving}
          >
            {saving ? (expenseToEdit ? 'Updating...' : 'Saving...') : (expenseToEdit ? 'Save Changes' : 'Save Expense')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

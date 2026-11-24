import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Skeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { formatDate } from '../lib/dates';
import { ArrowLeft, RotateCcw, Clock } from 'lucide-react';

interface DeletedRecord {
  id: string;
  table_name: string;
  type_label: string;
  label: string;
  deleted_at: string;
}

export const RecentlyDeletedPage: React.FC = () => {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { showToast } = useToast();

  const [records, setRecords] = useState<DeletedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const fetchDeleted = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_recently_deleted');
      if (error) throw error;
      setRecords((data as DeletedRecord[]) || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load recently deleted records', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'OWNER') {
      fetchDeleted();
    }
  }, [role]);

  const handleRestore = async (table: string, id: string) => {
    setRestoringId(id);
    try {
      const { error } = await supabase.rpc('restore_record', {
        p_table: table,
        p_id: id,
      });

      if (error) throw error;

      showToast('Record restored successfully', 'success');
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err: any) {
      showToast(err.message || 'Failed to restore record', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  if (role !== 'OWNER') {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-900">Access Restricted</h2>
        <p className="text-xs text-slate-500">
          Only the business owner can view and restore deleted records.
        </p>
        <button
          type="button"
          onClick={() => navigate('/more')}
          className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs hover:shadow-xs transition-all cursor-pointer"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between pb-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/more')}
            className="p-2.5 rounded-xl border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 shadow-2xs hover:shadow-xs transition-all shrink-0 cursor-pointer"
            title="Back to More"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A]">Recently Deleted</h1>
            <p className="text-xs sm:text-[13px] text-[#64748B] mt-0.5">
              Recover soft-deleted items before the 30-day permanent cleanup
            </p>
          </div>
        </div>
      </div>

      {/* Retention Notice */}
      <div className="bg-[#EEF0F3] border-0 rounded-2xl p-4 text-xs text-slate-700 shadow-2xs flex items-start gap-3">
        <Clock className="w-4.5 h-4.5 shrink-0 mt-0.5 text-slate-500" />
        <div className="text-xs text-slate-600 leading-relaxed">
          <span className="font-bold text-slate-900">30-Day Recovery Window:</span> Deleted customers,
          services, vendors, payments, expenses, and loans are held safely here. A nightly automated
          job permanently purges records older than 30 days.
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white p-8 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] text-center">
          <EmptyState
            message="No items have been deleted recently. Deleted records remain here for 30 days before permanent cleanup."
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {records.map((item) => (
            <div
              key={`${item.table_name}-${item.id}`}
              className="bg-white p-4 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-all"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border-0">
                    {item.type_label}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    Deleted {formatDate(item.deleted_at)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900 truncate">{item.label}</div>
              </div>

              <button
                type="button"
                disabled={restoringId === item.id}
                onClick={() => handleRestore(item.table_name, item.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs hover:shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
              >
                {restoringId === item.id ? (
                  <span className="w-3.5 h-3.5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                )}
                <span>Restore</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

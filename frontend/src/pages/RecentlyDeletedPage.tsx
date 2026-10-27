import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { formatDate } from '../lib/dates';
import { ArrowLeft, RotateCcw, Clock } from 'lucide-react';

interface DeletedRecord {
  table_name: string;
  id: string;
  label: string;
  type_label: string;
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
      setRecords((data as any[]) || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load recently deleted items', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role === 'OWNER') {
      fetchDeleted();
    } else {
      setLoading(false);
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
        <h2 className="text-lg font-bold text-text">Access Restricted</h2>
        <p className="text-xs text-text-muted">
          Only the business owner can view and restore deleted records.
        </p>
        <Button variant="outline" onClick={() => navigate('/more')}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      {/* Header */}
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
            <h1 className="text-xl font-bold text-text">Recently Deleted</h1>
            <p className="text-xs text-text-muted">
              Recover soft-deleted items before the 30-day permanent cleanup
            </p>
          </div>
        </div>
      </div>

      {/* Retention Notice */}
      <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-primary flex items-start gap-2.5">
        <Clock className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">30-Day Recovery Window:</span> Deleted customers,
          services, vendors, payments, expenses, and loans are held safely here. A nightly automated
          job permanently purges records older than 30 days.
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
          <Skeleton className="h-16 w-full rounded-card" />
        </div>
      ) : records.length === 0 ? (
        <Card className="p-8 text-center">
          <EmptyState
            message="No items have been deleted recently. Deleted records remain here for 30 days before permanent cleanup."
          />
        </Card>
      ) : (

        <div className="space-y-2">
          {records.map((item) => (
            <Card
              key={`${item.table_name}-${item.id}`}
              className="p-3.5 flex items-center justify-between gap-3 hover:border-text-muted/40 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-surface border border-border text-text-muted">
                    {item.type_label}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    Deleted {formatDate(item.deleted_at)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-text truncate">{item.label}</div>
              </div>

              <Button
                variant="outline"
                size="sm"
                loading={restoringId === item.id}
                onClick={() => handleRestore(item.table_name, item.id)}
                className="shrink-0 text-primary border-primary/30 hover:bg-primary/5"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>Restore</span>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

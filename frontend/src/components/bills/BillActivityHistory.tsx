import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatDate } from '../../lib/dates';
import { formatINR } from '../../lib/money';
import { History, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';

export interface ActivityRecord {
  id: string;
  action: 'CREATED' | 'CANCELLED' | 'RESTORED';
  reason?: string;
  actor_name: string;
  actor_role: string;
  details?: Record<string, any>;
  created_at: string;
}

export interface BillActivityHistoryProps {
  invoiceId: string;
  refreshTrigger?: number;
}

export const BillActivityHistory: React.FC<BillActivityHistoryProps> = ({
  invoiceId,
  refreshTrigger,
}) => {
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchActivities = async () => {
      if (!invoiceId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_invoice_activities', {
          p_invoice_id: invoiceId,
        });
        if (error) throw error;
        if (isMounted && data) {
          setActivities(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.warn('Failed to load bill activities:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchActivities();
    return () => {
      isMounted = false;
    };
  }, [invoiceId, refreshTrigger]);

  if (activities.length === 0 && !loading) return null;

  return (
    <div className="border-t border-slate-200/80 pt-4 mt-4 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
        <History className="w-3.5 h-3.5 text-[#0F766E]" />
        <span>Activity & Audit History</span>
      </div>

      <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {activities.map((act) => {
          const isCreated = act.action === 'CREATED';
          const isCancelled = act.action === 'CANCELLED';

          const icon = isCreated ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          ) : isCancelled ? (
            <XCircle className="w-3.5 h-3.5 text-rose-600" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5 text-teal-600" />
          );

          const badgeBg = isCreated
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
            : isCancelled
            ? 'bg-rose-50 text-rose-700 border-rose-200/60'
            : 'bg-teal-50 text-teal-700 border-teal-200/60';

          return (
            <div key={act.id} className="relative text-xs">
              {/* Dot */}
              <div className="absolute -left-[19px] top-1 bg-white rounded-full">
                {icon}
              </div>

              <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeBg}`}>
                      {act.action}
                    </span>
                    <span className="font-semibold text-slate-800 text-[12px]">
                      by {act.actor_name} ({act.actor_role})
                    </span>
                  </div>
                  <span className="text-[10.5px] text-slate-400 tabular-nums">
                    {formatDate(act.created_at)}
                  </span>
                </div>

                {act.reason && (
                  <div className="text-[11.5px] text-slate-600">
                    <span className="font-medium text-slate-500">Reason: </span>
                    <span className="italic">"{act.reason}"</span>
                  </div>
                )}

                {act.details && (
                  <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 pt-0.5">
                    {act.details.total !== undefined && (
                      <span>Total: {formatINR(act.details.total)}</span>
                    )}
                    {act.details.previous_paid !== undefined && (
                      <span>Prev Paid: {formatINR(act.details.previous_paid)}</span>
                    )}
                    {act.details.released_advance !== undefined && Number(act.details.released_advance) > 0 && (
                      <span className="text-[#0F766E] font-medium">Moved to Advance: {formatINR(act.details.released_advance)}</span>
                    )}
                    {act.details.voided_amount !== undefined && Number(act.details.voided_amount) > 0 && (
                      <span className="text-rose-600 font-medium">Voided: {formatINR(act.details.voided_amount)}</span>
                    )}
                    {act.details.conflict_info && (
                      <span className="text-amber-700 font-medium">{act.details.conflict_info}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

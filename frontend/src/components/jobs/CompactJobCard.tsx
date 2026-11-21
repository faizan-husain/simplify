import React from 'react';
import { clsx } from 'clsx';
import {
  MessageCircle,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { formatINR } from '../../lib/money';
import { getWhatsAppUrl } from '../../lib/auth';

export interface CompactJobCardProps {
  job: any;
  rankIndex?: number;
  onClick: () => void;
  onTickSteps?: () => void;
  className?: string;
  isWide?: boolean;
}

function formatMobile(m?: string): string {
  if (!m) return '';
  const digits = m.replace(/\D/g, '').slice(-10);
  if (digits.length === 10) {
    return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return m;
}

function getInitials(name?: string): string {
  if (!name) return 'O';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const CompactJobCard: React.FC<CompactJobCardProps> = ({
  job,
  rankIndex,
  onClick,
  onTickSteps,
  className,
  isWide = false,
}) => {
  const isCompleted = job.status === 'COMPLETED';
  const days = parseInt(String(job.days_left), 10);
  const isLate = !isCompleted && days < 0;
  const isToday = !isCompleted && days === 0;
  const isRed =
    !isCompleted &&
    !isLate &&
    (isToday || job.deadline_bucket === 'RED' || days <= 3);
  const isYellow =
    !isCompleted &&
    !isLate &&
    !isToday &&
    !isRed &&
    (job.deadline_bucket === 'YELLOW' || days <= 5);

  // Soft #F5F8FB Background for Staff Dashboard Job Cards inside White Card containers
  const cardBgBorderClass =
    'bg-[#F5F8FB] border-0 hover:bg-[#EBF1F7] shadow-2xs hover:shadow-xs transition-all';

  const count = Number(job.total_steps || (job.steps ? job.steps.length : 1));
  const hasMultiSteps = count >= 2;
  const ticked = Number(
    job.ticked_steps !== undefined
      ? job.ticked_steps
      : job.steps
        ? job.steps.filter((s: any) => s.ticked).length
        : 0
  );
  const percent = isCompleted
    ? 100
    : hasMultiSteps
      ? Math.round((ticked / count) * 100)
      : count === 1 && ticked === 1
        ? 100
        : 0;

  const rankStr =
    rankIndex !== undefined ? `#${String(rankIndex + 1).padStart(2, '0')}` : null;

  const nextStepName =
    job.next_step_name ||
    (job.steps
      ? job.steps.find((s: any) => !s.ticked)?.name
      : null) ||
    (isCompleted ? 'All steps completed' : 'Processing next step');

  // Discrete Step Segment Bar matching JobsPage
  const renderDiscreteStepBar = () => {
    const total = Math.max(count || 1, 1);
    const active = isCompleted ? total : Math.min(ticked || 0, total);

    const activeSegmentColor = isCompleted
      ? 'bg-[#059669]'
      : isLate
        ? 'bg-[#E11D48]'
        : isRed
          ? 'bg-[#DC2626]'
          : isYellow
            ? 'bg-[#D97706]'
            : 'bg-[#0F766E]';

    return (
      <div className="flex items-center gap-1 w-full py-0.5">
        {Array.from({ length: total }).map((_, i) => {
          const isDone = i < active;
          return (
            <div
              key={i}
              className={clsx(
                'flex-1 h-1.5 rounded-full transition-all duration-300',
                isDone ? activeSegmentColor : 'bg-slate-200/80'
              )}
            />
          );
        })}
      </div>
    );
  };

  // Deadline Badge matching JobsPage (Borderless)
  const renderDeadlineBadge = () => {
    if (isCompleted) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-50 text-emerald-800 border-0 shadow-2xs">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Completed</span>
        </span>
      );
    }
    if (isLate) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-600 text-white border-0 shadow-2xs">
          <AlertTriangle className="w-3 h-3 text-white" />
          <span>{Math.abs(days)}d late</span>
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-red-50 text-red-700 border-0 shadow-2xs">
          <Clock className="w-3 h-3 text-red-600" />
          <span>Due today</span>
        </span>
      );
    }
    if (isRed) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-red-50 text-red-700 border-0 shadow-2xs">
          <Clock className="w-3 h-3 text-red-600" />
          <span>{days}d left</span>
        </span>
      );
    }
    if (isYellow) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-amber-50 text-amber-800 border-0 shadow-2xs">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>{days}d left</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-slate-100 text-slate-700 shadow-2xs border-0">
        <Clock className="w-3 h-3 text-slate-500" />
        <span>{days}d left</span>
      </span>
    );
  };

  return (
    <div
      onClick={onClick}
      className={clsx(
        'group rounded-2xl transition-all duration-200 cursor-pointer p-3 sm:p-3.5 hover:-translate-y-0.5 select-none',
        cardBgBorderClass,
        className
      )}
    >
      <div
        className={clsx(
          isWide
            ? 'flex flex-col md:flex-row md:items-stretch justify-between gap-4 md:gap-0'
            : 'space-y-2.5'
        )}
      >
        {/* Left Section: Customer Info, Particular & WhatsApp */}
        <div
          className={clsx(
            'min-w-0 space-y-1',
            isWide ? 'w-full md:w-1/2 md:pr-4 flex flex-col justify-center' : ''
          )}
        >
          {/* Row 1: Party Name + WhatsApp Pill (Borderless) */}
          <div className="flex items-center gap-2 flex-wrap justify-between sm:justify-start">
            <h3 className="font-bold text-slate-900 text-[13.5px] sm:text-[14.5px] tracking-tight group-hover:text-[#0F766E] transition-colors truncate">
              {job.party_name || 'Customer'}
            </h3>

            {job.party_mobile && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const waUrl = getWhatsAppUrl(
                    job.party_mobile,
                    `Hello ${job.party_name}, this is regarding your ${job.job_type_name} (Bill #${job.invoice_number}).`
                  );
                  window.open(waUrl, '_blank');
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 text-[11px] font-medium border-0 transition-all shadow-2xs cursor-pointer"
                title="Chat on WhatsApp"
              >
                <MessageCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="tabular-nums tracking-wide">
                  {formatMobile(job.party_mobile)}
                </span>
              </button>
            )}
          </div>

          {/* Row 2: #Rank · Job Type · Invoice Number */}
          <div className="flex items-center gap-1.5 text-[11.5px] text-slate-500 font-medium flex-wrap">
            {rankStr && (
              <>
                <span className="font-semibold text-slate-700">{rankStr}</span>
                <span className="text-slate-300">·</span>
              </>
            )}
            <span className="text-slate-700 font-semibold truncate max-w-[150px]">
              {job.job_type_name}
            </span>
            {job.invoice_number && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-slate-500 font-mono text-[11px]">
                  #{job.invoice_number}
                </span>
              </>
            )}
          </div>

          {/* Row 3: Particular [applicant_name || party_name] */}
          {(job.applicant_name || job.party_name) && (
            <div className="flex items-center text-[11.5px] text-slate-600 gap-1.5 min-w-0 pt-0.5">
              <span className="text-slate-400 font-normal shrink-0">Particular</span>
              <span
                className="font-medium text-slate-700 truncate"
                title={job.applicant_name || job.party_name}
              >
                {job.applicant_name || job.party_name}
              </span>
            </div>
          )}

          {/* Row 4: Created by */}
          <div className="flex items-center text-[11px] text-slate-500 gap-1 min-w-0 pt-0.5">
            <span className="text-slate-400 font-normal shrink-0">Created by:</span>
            <span className="font-semibold text-slate-700 truncate">
              {job.created_by_name || 'Owner'}
            </span>
          </div>
        </div>

        {/* Right Section: Progress & Stepper + Action */}
        <div
          className={clsx(
            'min-w-0 flex flex-col justify-between gap-2',
            isWide
              ? 'w-full md:w-1/2 pt-3 md:pt-0 md:pl-4'
              : 'pt-1.5'
          )}
        >
          {/* Step Ratio & Percent */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11.5px] font-semibold text-slate-800">
              <span>
                {hasMultiSteps
                  ? `${ticked} of ${count} steps`
                  : count === 1
                    ? isCompleted
                      ? '1 of 1 step'
                      : '0 of 1 step'
                    : 'Direct Job'}
              </span>
              <span className="font-bold tabular-nums text-slate-700">
                {percent}%
              </span>
            </div>

            {/* Discrete Step Segment Bar */}
            {renderDiscreteStepBar()}

            {/* Next Step */}
            <div className="text-[11.5px] text-slate-500 font-normal truncate">
              {isCompleted ? (
                <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>All steps completed</span>
                </span>
              ) : (
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-slate-400 shrink-0">Next</span>
                  <span className="text-slate-300 shrink-0">·</span>
                  <span className="text-slate-600 font-medium truncate">
                    {nextStepName}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Badges + Amount + Tick steps button */}
          <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {renderDeadlineBadge()}

              {/* Staff Avatar + Name */}
              {(job.assigned_staff_name || job.assigned_staff_id) && (
                <div className="inline-flex items-center gap-1 shrink-0" title={`Assigned to ${job.assigned_staff_name || 'Staff'}`}>
                  <span className="text-[10px] text-slate-400 font-normal">Assigned:</span>
                  <div className="w-4 h-4 rounded-full bg-slate-100 text-slate-600 border-0 shadow-2xs flex items-center justify-center text-[9px] font-bold">
                    {getInitials(job.assigned_staff_name)}
                  </div>
                  <span className="text-[11px] text-slate-600 font-medium truncate max-w-[80px]">
                    {job.assigned_staff_name || 'Staff'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0 ml-auto">
              {job.amount !== undefined && (
                <div className="text-right">
                  <div className="text-[14px] font-bold text-slate-900 tabular-nums">
                    {formatINR(job.amount)}
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onTickSteps) onTickSteps();
                  else onClick();
                }}
                className={clsx(
                  'inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl text-[11.5px] font-semibold transition-all shrink-0 cursor-pointer shadow-sm active:scale-[0.98] border-0',
                  isCompleted
                    ? 'bg-emerald-50 text-emerald-800 border-0 hover:bg-emerald-100 shadow-2xs'
                    : 'bg-slate-900 hover:bg-black text-white hover:shadow border-0'
                )}
              >
                <Check className="w-3 h-3 stroke-[2.5]" />
                <span>{isCompleted ? 'Completed' : 'Tick steps'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


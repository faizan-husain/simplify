import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Card } from './Card';

export interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  delta?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  sparklineData?: number[];
  secondaryLine?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  delta,
  sparklineData,
  secondaryLine,
  className,
  onClick,
}) => {
  // Generate lightweight 84x26 smooth bezier SVG sparkline
  const renderSparkline = () => {
    if (!sparklineData || sparklineData.length < 2) return null;
    const min = Math.min(...sparklineData);
    const max = Math.max(...sparklineData);
    const range = max - min || 1;
    const width = 84;
    const height = 26;
    const padding = 2;

    const points = sparklineData.map((val, idx) => {
      const x = padding + (idx / (sparklineData.length - 1)) * (width - padding * 2);
      const y = height - padding - ((val - min) / range) * (height - padding * 2);
      return { x, y };
    });

    let pathD = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2] || p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    const isUp = delta?.isPositive ?? (sparklineData[sparklineData.length - 1] >= sparklineData[0]);

    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible shrink-0 ml-auto"
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke={isUp ? '#0F766E' : '#94A3B8'}
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <Card
      className={twMerge('flex flex-col justify-between p-5 transition-all duration-200 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)]', onClick && 'cursor-pointer', className)}
      onClick={onClick}
    >
      {/* Top Row: Label + Circular Icon */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[#6B7280]">{label}</span>
        {icon && (
          <div className="shrink-0">
            {icon}
          </div>
        )}
      </div>

      {/* Middle Row: Big Number */}
      <div className="text-[28px] font-semibold tracking-tight text-[#111827] tabular-nums leading-tight mt-2.5">
        {value}
      </div>

      {/* Bottom Row: Delta + Sparkline */}
      {(delta || sparklineData || secondaryLine) && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[12.5px] w-full">
          {delta ? (
            <div className="flex items-center gap-1.5 tabular-nums">
              <span
                className={clsx(
                  delta.isPositive ? 'text-[#16A34A] font-medium' : 'text-[#6B7280] font-normal'
                )}
              >
                {delta.value}
              </span>
              {delta.label && <span className="text-[#6B7280] text-[12px]">{delta.label}</span>}
            </div>
          ) : secondaryLine ? (
            <div className="text-[12px] text-[#6B7280] font-normal tabular-nums w-full flex-1">
              {secondaryLine}
            </div>
          ) : (
            <div />
          )}

          {renderSparkline()}
        </div>
      )}
    </Card>
  );
};

import { useState, useId, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';
import { formatINR } from '../../lib/money';

export interface ChartDataPoint {
  label: string;
  income: number;
  outgoing: number;
  fullDate?: string;
}

export interface QuietChartProps {
  data: ChartDataPoint[];
  height?: number;
  className?: string;
  showLegend?: boolean;
  period?: 'TODAY' | 'THIS_MONTH' | 'THIS_YEAR';
}

// Generate smooth cubic bezier SVG path from points, clamped to baseline to avoid dipping below 0
function createSmoothPath(points: { x: number; y: number }[], maxY?: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;

    let cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    let cp2x = p2.x - (p3.x - p1.x) / 6;
    let cp2y = p2.y - (p3.y - p1.y) / 6;

    if (maxY !== undefined) {
      if (p1.y >= maxY && p2.y >= maxY) {
        cp1y = maxY;
        cp2y = maxY;
      } else {
        cp1y = Math.min(maxY, cp1y);
        cp2y = Math.min(maxY, cp2y);
      }
    }

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

export const QuietChart: React.FC<QuietChartProps> = ({
  data,
  height = 250,
  className,
  showLegend = true,
  period: _period = 'THIS_MONTH',
}) => {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[13px] text-text-muted">
        No chart data available
      </div>
    );
  }

  // Taller aspect ratio (480x250) ensures curves and bars are prominently visible and legible on mobile screens
  const svgWidth = 480;
  const svgHeight = height;
  const padding = { top: 16, right: 16, bottom: 32, left: 36 };
  const chartWidth = svgWidth - padding.left - padding.right;
  const chartHeight = svgHeight - padding.top - padding.bottom;
  const baselineY = padding.top + chartHeight;

  const rawMax = Math.max(
    ...data.map((d) => Math.max(d.income, d.outgoing, 100)),
    100
  );
  // Round maxVal to a clean readable number
  const maxVal = Math.max(1000, Math.ceil((rawMax * 1.15) / 1000) * 1000);

  const getX = (index: number) => {
    if (data.length <= 1) return padding.left + chartWidth / 2;
    return padding.left + (index / (data.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return padding.top + chartHeight - (val / maxVal) * chartHeight;
  };

  const incomePoints = data.map((d, i) => ({
    x: getX(i),
    y: Math.min(baselineY, Math.max(padding.top, getY(d.income))),
  }));
  const outgoingPoints = data.map((d, i) => ({
    x: getX(i),
    y: Math.min(baselineY, Math.max(padding.top, getY(d.outgoing))),
  }));

  const incomeLinePath = createSmoothPath(incomePoints, baselineY);
  const outgoingLinePath = createSmoothPath(outgoingPoints, baselineY);

  // Area fill under income curve
  const firstPoint = incomePoints[0];
  const lastPoint = incomePoints[incomePoints.length - 1];
  const areaPath = incomeLinePath
    ? `${incomeLinePath} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`
    : '';

  const hoveredData = hoverIndex !== null ? data[hoverIndex] : null;

  const formatYLabel = (val: number) => {
    if (val >= 10000000) return `${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
    if (val >= 1000) return `${Math.round(val / 1000)}k`;
    return `${val}`;
  };

  const yTicks = [0, 0.33, 0.66, 1].map((pct) => Math.round(maxVal * pct));

  // Determine timeline milestone ticks and labels (smart distribution based on data length)
  const timelineTicks = useMemo(() => {
    const total = data.length;
    if (total === 0) return [];

    // If 12 or fewer points (e.g. 12 months for Year, or 7 days for Today): every point is major
    if (total <= 12) {
      return data.map((d, i) => ({
        index: i,
        x: getX(i),
        label: d.label,
        isMajor: true,
      }));
    }

    // Between 13 and 31 points (e.g. Month view with 28-31 days):
    // Show key milestones (Day 1, 5, 10, 15, 20, 25, 31)
    const step = total > 22 ? Math.round(total / 6) : Math.round(total / 5);
    const majorSet = new Set<number>();
    majorSet.add(0); // First point always

    for (let i = step; i < total - 1; i += step) {
      majorSet.add(i);
    }

    // Always include last day, ensuring it doesn't collide with previous major tick
    const lastIndex = total - 1;
    const prevMajor = Array.from(majorSet).pop() || 0;
    if (lastIndex - prevMajor < Math.max(2, Math.floor(step * 0.6))) {
      majorSet.delete(prevMajor);
    }
    majorSet.add(lastIndex);

    return data.map((d, i) => ({
      index: i,
      x: getX(i),
      label: d.label,
      isMajor: majorSet.has(i),
    }));
  }, [data, chartWidth, padding.left]);

  return (
    <div className={twMerge('relative flex flex-col w-full select-none', className)}>
      {showLegend && (
        <div className="flex items-center justify-end gap-5 mb-2 text-[12px] font-medium text-text-muted">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#0F766E]" />
            <span className="text-[#374151]">Income</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#94A3B8]" />
            <span className="text-[#6B7280]">Outgoing</span>
          </div>
        </div>
      )}

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto overflow-visible"
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0F766E" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#0F766E" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines and Y-axis labels */}
          {[0, 0.33, 0.66, 1].map((pct, i) => {
            const y = padding.top + chartHeight * (1 - pct);
            const val = yTicks[i];
            return (
              <g key={i}>
                <text
                  x={padding.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="fill-[#9CA3AF] text-[10.5px] font-medium tabular-nums"
                >
                  {formatYLabel(val)}
                </text>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#EEF0F3"
                  strokeWidth="1"
                  strokeDasharray={i > 0 && i < 3 ? '2 2' : undefined}
                />
              </g>
            );
          })}

          {/* Income area gradient */}
          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

          {/* Outgoing line (dashed slate #94A3B8) */}
          {outgoingLinePath && (
            <path
              d={outgoingLinePath}
              fill="none"
              stroke="#94A3B8"
              strokeWidth="1.8"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
          )}

          {/* Income line (solid teal 2.2px) */}
          {incomeLinePath && (
            <path
              d={incomeLinePath}
              fill="none"
              stroke="#0F766E"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          )}

          {/* ============================================================== */}
          {/* TIMELINE BAR & DATE LABELS (BOTTOM AXIS)                       */}
          {/* ============================================================== */}
          {/* Solid Timeline Baseline Track */}
          <line
            x1={padding.left}
            y1={baselineY}
            x2={svgWidth - padding.right}
            y2={baselineY}
            stroke="#CBD5E1"
            strokeWidth="1.5"
          />

          {/* Timeline Tick Marks & Date Labels */}
          {timelineTicks.map((tick) => {
            const isHovered = hoverIndex === tick.index;

            return (
              <g key={`tick-${tick.index}`}>
                {/* Tick mark line */}
                <line
                  x1={tick.x}
                  y1={baselineY}
                  x2={tick.x}
                  y2={baselineY + (tick.isMajor ? 6 : 3)}
                  stroke={tick.isMajor ? '#94A3B8' : '#E2E8F0'}
                  strokeWidth={tick.isMajor ? 1.4 : 1}
                />

                {/* Date label */}
                {tick.isMajor && (
                  <text
                    x={tick.x}
                    y={baselineY + 18}
                    textAnchor="middle"
                    className={`text-[11px] transition-colors ${
                      isHovered
                        ? 'fill-[#0F766E] font-bold text-[12px]'
                        : 'fill-[#64748B] font-medium'
                    }`}
                  >
                    {tick.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Hover Crosshair & Indicators */}
          {hoverIndex !== null && (
            <g>
              {/* Vertical guide line from top down to baseline */}
              <line
                x1={getX(hoverIndex)}
                y1={padding.top}
                x2={getX(hoverIndex)}
                y2={baselineY}
                stroke="#0F766E"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                opacity="0.45"
              />

              {/* Income point dot */}
              <circle
                cx={getX(hoverIndex)}
                cy={incomePoints[hoverIndex].y}
                r="4.5"
                fill="#0F766E"
                stroke="#ffffff"
                strokeWidth="2"
              />

              {/* Outgoing point dot */}
              <circle
                cx={getX(hoverIndex)}
                cy={outgoingPoints[hoverIndex].y}
                r="4"
                fill="#94A3B8"
                stroke="#ffffff"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Transparent interactive columns for hover */}
          {data.map((_, i) => {
            const colWidth = chartWidth / data.length;
            const x = getX(i) - colWidth / 2;
            return (
              <rect
                key={i}
                x={Math.max(0, x)}
                y={padding.top}
                width={colWidth}
                height={chartHeight + 40}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
              />
            );
          })}
        </svg>

        {/* Floating Ink Tooltip */}
        {hoverIndex !== null && hoveredData && (() => {
          const xPct = (getX(hoverIndex) / svgWidth) * 100;
          const minY = Math.min(getY(hoveredData.income), getY(hoveredData.outgoing));
          const maxY = Math.max(getY(hoveredData.income), getY(hoveredData.outgoing));

          // Clamped & flip-positioned
          const isNearTop = minY < 65;
          const topPosition = isNearTop ? maxY + 14 : minY - 10;
          const translateYClass = isNearTop ? 'translate-y-0' : '-translate-y-full';

          let translateXClass = '-translate-x-1/2';
          let leftPercent = xPct;
          if (xPct < 18) {
            translateXClass = 'translate-x-0';
            leftPercent = Math.max(2, xPct - 2);
          } else if (xPct > 82) {
            translateXClass = '-translate-x-full';
            leftPercent = Math.min(98, xPct + 2);
          }

          const net = hoveredData.income - hoveredData.outgoing;

          return (
            <div
              className={`absolute pointer-events-none z-30 bg-[#0F172A] text-white rounded-xl px-3.5 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)] text-[12px] min-w-[140px] border border-white/10 transform ${translateXClass} ${translateYClass} transition-all duration-75`}
              style={{
                left: `${leftPercent}%`,
                top: `${(topPosition / svgHeight) * 100}%`,
              }}
            >
              <div className="text-[11.5px] font-semibold text-[#94A3B8] mb-1.5 pb-1 border-b border-white/10">
                {hoveredData.label}
              </div>
              <div className="font-bold text-white tabular-nums text-[12.5px] flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 font-normal text-slate-300 text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-[#0F766E]" />
                  Income
                </span>
                <span className="text-emerald-400">{formatINR(hoveredData.income)}</span>
              </div>
              <div className="text-[12.5px] font-bold text-white tabular-nums mt-1 flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 font-normal text-slate-300 text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-[#94A3B8]" />
                  Outgoing
                </span>
                <span className="text-slate-300">{formatINR(hoveredData.outgoing)}</span>
              </div>
              <div className="text-[11.5px] font-semibold tabular-nums mt-1.5 pt-1 border-t border-white/10 flex items-center justify-between gap-4">
                <span className="text-slate-400 font-normal text-[10.5px]">Net</span>
                <span className={net >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {net >= 0 ? '+' : ''}{formatINR(net)}
                </span>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

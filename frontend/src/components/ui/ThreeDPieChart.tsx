import React from 'react';
import { clsx } from 'clsx';

export interface ThreeDPieSlice {
  name: string;
  count: number;
  color: string;
  percentage: number;
}

export interface ThreeDPieChartProps {
  data: ThreeDPieSlice[];
  totalBills: number;
  hoveredIdx: number | null;
  onHover: (idx: number | null) => void;
  className?: string;
}

function shadeColor(color: string, percent: number): string {
  try {
    let hex = color.replace('#', '');
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('');
    }
    const num = parseInt(hex, 16);
    let R = (num >> 16) + Math.round((255 * percent) / 100);
    let G = ((num >> 8) & 0x00ff) + Math.round((255 * percent) / 100);
    let B = (num & 0x0000ff) + Math.round((255 * percent) / 100);

    R = Math.min(255, Math.max(0, R));
    G = Math.min(255, Math.max(0, G));
    B = Math.min(255, Math.max(0, B));

    return `#${((1 << 24) + (R << 16) + (G << 8) + B).toString(16).slice(1)}`;
  } catch {
    return color;
  }
}

function getVisibleFrontArcs(startAngle: number, endAngle: number): [number, number][] {
  const twoPi = 2 * Math.PI;
  let a1 = startAngle % twoPi;
  if (a1 < 0) a1 += twoPi;
  const len = endAngle - startAngle;
  const a2 = a1 + len;

  const result: [number, number][] = [];

  // Check overlap with [0, PI]
  const s0 = Math.max(a1, 0);
  const e0 = Math.min(a2, Math.PI);
  if (e0 > s0 + 0.0001) {
    result.push([s0, e0]);
  }

  // Check overlap with [2*PI, 3*PI] (wrapped)
  const s1 = Math.max(a1, twoPi);
  const e1 = Math.min(a2, 3 * Math.PI);
  if (e1 > s1 + 0.0001) {
    result.push([s1 - twoPi, e1 - twoPi]);
  }

  return result;
}

export const ThreeDPieChart: React.FC<ThreeDPieChartProps> = ({
  data,
  totalBills,
  hoveredIdx,
  onHover,
  className,
}) => {
  const cx = 100;
  const cy = 52;
  const rx = 76;
  const ry = 43;
  const h = 18;

  // Zero Data / Empty Resting Disc
  if (!data || data.length === 0 || totalBills === 0) {
    return (
      <div className={clsx('relative flex items-center justify-center select-none', className)}>
        <svg viewBox="0 0 200 135" className="w-full h-full overflow-visible">
          {/* Ground Soft Shadow */}
          <ellipse cx={cx} cy={cy + h + 6} rx={rx + 2} ry={ry * 0.9} fill="rgba(15,23,42,0.07)" />

          {/* Front Wall */}
          <path
            d={`M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy} L ${cx + rx} ${cy + h} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy + h} Z`}
            fill="#CBD5E1"
          />

          {/* Top Face */}
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#E2E8F0" />

          {/* Center Zero Notice */}
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill="#94A3B8"
            fontSize="11"
            fontWeight="600"
          >
            No bills yet
          </text>
        </svg>
      </div>
    );
  }

  // Single Slice (100% of bills)
  if (data.length === 1) {
    const item = data[0];
    const isHovered = hoveredIdx === 0;

    return (
      <div
        className={clsx('relative flex items-center justify-center select-none', className)}
        onMouseLeave={() => onHover(null)}
      >
        <svg viewBox="0 0 200 135" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="single-side-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shadeColor(item.color, -12)} />
              <stop offset="100%" stopColor={shadeColor(item.color, -30)} />
            </linearGradient>
          </defs>

          {/* Ground Soft Shadow */}
          <ellipse cx={cx} cy={cy + h + 6} rx={rx + 2} ry={ry * 0.9} fill="rgba(15,23,42,0.12)" />

          <g
            className="cursor-pointer transition-all duration-400 ease-out"
            style={{
              transform: isHovered ? 'translateY(-3px)' : 'none',
              filter: isHovered ? 'drop-shadow(0 6px 14px rgba(0,0,0,0.25)) brightness(1.08)' : 'none',
            }}
            onMouseEnter={() => onHover(0)}
            onMouseLeave={() => onHover(null)}
          >
            {/* Front Wall (0 to PI) */}
            <path
              d={`M ${cx + rx} ${cy} A ${rx} ${ry} 0 0 1 ${cx - rx} ${cy} L ${cx - rx} ${cy + h} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy + h} Z`}
              fill="url(#single-side-grad)"
              stroke={shadeColor(item.color, -32)}
              strokeWidth="0.5"
            />

            {/* Top Face */}
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill={item.color}
            />

            {/* Centered 100% Label */}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#FFFFFF"
              fontSize="13"
              fontWeight="800"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}
            >
              100%
            </text>
          </g>
        </svg>
      </div>
    );
  }

  // Multi-Slice Dynamic 3D Pie
  const startAngle = -0.5 * Math.PI; // Start at 12 o'clock
  let accumulatedAngle = startAngle;

  const slices = data.map((item, idx) => {
    const angleDelta = (item.percentage / 100) * 2 * Math.PI;
    const s = accumulatedAngle;
    const e = accumulatedAngle + angleDelta;
    const mid = s + angleDelta / 2;
    accumulatedAngle = e;

    // Top Face Sector Path
    const x1 = cx + rx * Math.cos(s);
    const y1 = cy + ry * Math.sin(s);
    const x2 = cx + rx * Math.cos(e);
    const y2 = cy + ry * Math.sin(e);
    const largeArc = angleDelta > Math.PI ? 1 : 0;
    const topPath = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rx} ${ry} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;

    // Visible Front-Rim Wall Arcs (within [0, PI])
    const frontArcs = getVisibleFrontArcs(s, e);
    const wallPaths = frontArcs.map(([arcS, arcE]) => {
      const sx = cx + rx * Math.cos(arcS);
      const sy = cy + ry * Math.sin(arcS);
      const ex = cx + rx * Math.cos(arcE);
      const ey = cy + ry * Math.sin(arcE);
      return (
        `M ${sx.toFixed(2)} ${sy.toFixed(2)} ` +
        `A ${rx} ${ry} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)} ` +
        `L ${ex.toFixed(2)} ${(ey + h).toFixed(2)} ` +
        `A ${rx} ${ry} 0 0 0 ${sx.toFixed(2)} ${(sy + h).toFixed(2)} Z`
      );
    });

    // Label Placement
    const tx = cx + rx * 0.62 * Math.cos(mid);
    const ty = cy + ry * 0.62 * Math.sin(mid);

    // Hover Pop-Out Direction Vector
    const dx = Math.cos(mid) * 5.5;
    const dy = Math.sin(mid) * 3.5 - 2;

    return {
      id: idx,
      item,
      s,
      e,
      mid,
      sinMid: Math.sin(mid),
      topPath,
      wallPaths,
      tx,
      ty,
      dx,
      dy,
    };
  });

  // Sort slices back-to-front (Painter's algorithm: sin(mid) < 0 in back rendered first)
  const sortedSlices = [...slices].sort((a, b) => a.sinMid - b.sinMid);
  const isAnyHovered = hoveredIdx !== null;

  return (
    <div
      className={clsx('relative flex items-center justify-center select-none', className)}
      onMouseLeave={() => onHover(null)}
    >
      <svg viewBox="0 0 200 135" className="w-full h-full overflow-visible">
        <defs>
          {data.map((item, idx) => (
            <linearGradient key={idx} id={`pie-side-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={shadeColor(item.color, -10)} />
              <stop offset="100%" stopColor={shadeColor(item.color, -30)} />
            </linearGradient>
          ))}
        </defs>

        {/* Soft Elliptical Ground Shadow under the 3D cylinder */}
        <ellipse cx={cx} cy={cy + h + 6} rx={rx + 2} ry={ry * 0.9} fill="rgba(15,23,42,0.11)" />

        {/* 3D Slices Rendered in Depth Order */}
        {sortedSlices.map((slice) => {
          const isHovered = hoveredIdx === slice.id;

          return (
            <g
              key={slice.id}
              className="cursor-pointer outline-none"
              style={{
                transform: isHovered ? `translate(${slice.dx.toFixed(2)}px, ${slice.dy.toFixed(2)}px)` : 'none',
                opacity: !isAnyHovered || isHovered ? 1 : 0.45,
                filter: isHovered ? 'drop-shadow(0 6px 14px rgba(0,0,0,0.25)) brightness(1.08)' : 'none',
                transition:
                  'transform 400ms cubic-bezier(0.4, 0, 0.2, 1), opacity 400ms ease-out, filter 400ms ease-out',
              }}
              onMouseEnter={() => onHover(slice.id)}
              onMouseLeave={() => onHover(null)}
            >
              {/* 1. Cylindrical Front Side Walls for this slice */}
              {slice.wallPaths.map((wPath, wIdx) => (
                <path
                  key={wIdx}
                  d={wPath}
                  fill={`url(#pie-side-grad-${slice.id})`}
                  stroke={shadeColor(slice.item.color, -32)}
                  strokeWidth="0.5"
                  strokeLinejoin="round"
                />
              ))}

              {/* 2. Top Face Sector (Seamless borderless sector) */}
              <path
                d={slice.topPath}
                fill={slice.item.color}
              />

              {/* 3. Bold White Percentage Text on Top of Slice */}
              {slice.item.percentage >= 6 && (
                <text
                  x={slice.tx.toFixed(1)}
                  y={slice.ty.toFixed(1)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#FFFFFF"
                  fontSize={slice.item.percentage >= 15 ? '11.5' : '9.5'}
                  fontWeight="800"
                  style={{
                    textShadow: '0 1px 3px rgba(0,0,0,0.7)',
                    pointerEvents: 'none',
                  }}
                >
                  {slice.item.percentage}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};


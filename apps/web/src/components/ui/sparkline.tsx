import { cn } from "@/lib/cn";

/**
 * Compact inline trend line — pure SVG, no charting library. Renders an
 * array of numbers as a polyline plus a soft area fill, suitable for
 * inline use in StatTiles or dashboard cards.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  tone = "accent",
  className,
  strokeWidth = 1.5,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: "accent" | "success" | "warning" | "critical" | "neutral";
  className?: string;
  strokeWidth?: number;
}) {
  const color = {
    accent: "var(--accent)",
    success: "var(--success)",
    warning: "var(--warning)",
    critical: "var(--critical)",
    neutral: "var(--text-tertiary)",
  }[tone];

  if (data.length === 0) {
    return <div className={cn("text-[11px] text-tertiary", className)} style={{ width, height }} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = strokeWidth;

  const points = data.map((v, i) => {
    const x = data.length === 1 ? width / 2 : (i / (data.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });

  const linePath = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1][0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      role="img"
      aria-label={`Trend from ${data[0]} to ${data[data.length - 1]}`}
    >
      <path d={areaPath} fill={color} opacity={0.12} stroke="none" />
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={strokeWidth + 0.5} fill={color} />
    </svg>
  );
}

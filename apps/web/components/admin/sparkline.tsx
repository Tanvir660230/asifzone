/** Minimal trend line, no axes/tooltip — for a small preview inside a KPI card. Uses `currentColor`
 * so the line/fill inherit whatever text color the parent sets, letting it sit on light or dark
 * card backgrounds without a color prop. For an interactive, labeled chart see RevenueChart. */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const width = 300;
  const height = 64;

  if (data.length < 2) return null;

  const max = Math.max(...data, 0);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: height - ((v - min) / range) * height,
  }));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${points[points.length - 1]!.x.toFixed(1)} ${height} L ${points[0]!.x.toFixed(1)} ${height} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={className}>
      <path d={area} fill="currentColor" opacity={0.14} stroke="none" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

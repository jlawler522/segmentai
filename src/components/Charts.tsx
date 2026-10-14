import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';
import type { ClusterResult, Diagnostics } from '../types';

export const SEGMENT_COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24',
  '#a78bfa', '#fb7185', '#22d3ee', '#a3e635',
];

export function colorFor(id: number): string {
  return SEGMENT_COLORS[id % SEGMENT_COLORS.length];
}

const axis = { stroke: '#64748b', fontSize: 12 };
const tooltipStyle = {
  backgroundColor: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 6,
  fontSize: 12,
};

/** Recharts passes ValueType (string | number | array), so narrow it here. */
function fmt(digits: number) {
  return (v: unknown) => (typeof v === 'number' ? v.toFixed(digits) : String(v ?? ''));
}

export function ElbowChart({ diag }: { diag: Diagnostics }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={diag.sweep} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#1e293b" />
        <XAxis dataKey="k" {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={tooltipStyle} formatter={fmt(1)} />
        <Line type="monotone" dataKey="wcss" stroke="#60a5fa" strokeWidth={2} dot={{ r: 3 }} name="WCSS" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SilhouetteChart({ diag }: { diag: Diagnostics }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={diag.sweep} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#1e293b" />
        <XAxis dataKey="k" {...axis} />
        <YAxis {...axis} domain={['auto', 'auto']} />
        <Tooltip contentStyle={tooltipStyle} formatter={fmt(4)} />
        <Line type="monotone" dataKey="silhouette" stroke="#34d399" strokeWidth={2} dot={{ r: 3 }} name="Silhouette" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PcaScatter({ result }: { result: ClusterResult }) {
  const byCluster = result.profiles.map((p) => ({
    id: p.id,
    points: result.pcaPoints.filter((pt) => pt.cluster === p.id),
  }));

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
        <CartesianGrid stroke="#1e293b" />
        <XAxis type="number" dataKey="pc1" name="PC1" {...axis} />
        <YAxis type="number" dataKey="pc2" name="PC2" {...axis} />
        <ZAxis range={[28, 28]} />
        <Tooltip contentStyle={tooltipStyle} formatter={fmt(2)} cursor={{ strokeDasharray: '3 3' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {byCluster.map((c) => (
          <Scatter key={c.id} name={`Segment ${c.id}`} data={c.points} fill={colorFor(c.id)} fillOpacity={0.75} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function ShareChart({ result }: { result: ClusterResult }) {
  const data = [...result.profiles]
    .sort((a, b) => b.size - a.size)
    .map((p) => ({ name: `#${p.id}`, size: p.size, id: p.id }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke="#1e293b" vertical={false} />
        <XAxis dataKey="name" {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="size" name="Customers">
          {data.map((d) => (
            <Cell key={d.id} fill={colorFor(d.id)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Radar uses z-scored means so every axis shares a scale.
 * 0 is the dataset average; +1 is one standard deviation above it.
 */
/**
 * Small multiples instead of one overlaid chart. Six polygons on three axes
 * are indistinguishable; one panel per segment stays readable at any k.
 *
 * Values are z-scored means, so the shared radius domain makes panels directly
 * comparable: the ring at 0 is the dataset average, and distance from it is
 * standard deviations.
 */
export function SegmentRadar({
  result,
  featureNames,
}: {
  result: ClusterResult;
  featureNames: string[];
}) {
  // One shared scale across panels, or the comparison is meaningless.
  const extent = Math.max(
    1,
    ...result.profiles.flatMap((p) => featureNames.map((n) => Math.abs(p.zMeans[n] ?? 0))),
  );
  const domain: [number, number] = [-Math.ceil(extent * 10) / 10, Math.ceil(extent * 10) / 10];

    // Panels are small; strip parenthetical units and keep it to one or two words.
  const shortLabel = (name: string) => {
    const base = name.replace(/\s*\(.*?\)\s*/g, '').trim();
    return base.length > 9 ? `${base.slice(0, 8)}…` : base;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
      {result.profiles.map((p) => {
        const data = featureNames.map((name) => ({
          feature: shortLabel(name),
          fullName: name,
          value: Number((p.zMeans[name] ?? 0).toFixed(2)),
        }));

        return (
          <div key={p.id} className="rounded border border-slate-800/60 p-2">
            <div className="flex items-center gap-1.5 px-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: colorFor(p.id) }}
              />
              <span className="text-xs text-slate-300">#{p.id}</span>
              <span className="text-xs text-slate-500">({p.size})</span>
            </div>
            <ResponsiveContainer width="100%" height={150}>
                <RadarChart data={data} outerRadius="55%" margin={{ top: 4, right: 28, bottom: 4, left: 28 }}>
                <PolarGrid stroke="#1e293b" />
                <PolarAngleAxis dataKey="feature" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <PolarRadiusAxis domain={domain} tick={false} axisLine={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={fmt(2)}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                />
                <Radar
                  name={`#${p.id}`}
                  dataKey="value"
                  stroke={colorFor(p.id)}
                  fill={colorFor(p.id)}
                  fillOpacity={0.3}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        );
      })}
    </div>
  );
}
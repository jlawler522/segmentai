import { PCA } from 'ml-pca';
import { clusterAt } from './MLDiagnosticsAgent';
import type { ClusterProfile, ClusterResult, PcaPoint, PreparedData } from '../types';

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Projects the normalized matrix onto its first two principal components.
 * This is purely for visualization — clustering happens in full feature space,
 * so two points can look close in the scatter while sitting in different
 * clusters. The explained-variance figure tells you how much to trust the plot.
 */
function project(matrix: number[][]): { points: [number, number][]; explained: [number, number] } {
  const width = matrix[0]?.length ?? 0;

  if (width < 2) {
    // Nothing to project; lay points out on a single axis.
    return {
      points: matrix.map((r) => [r[0] ?? 0, 0] as [number, number]),
      explained: [1, 0],
    };
  }

  const pca = new PCA(matrix);
  const scores = pca.predict(matrix).to2DArray();
  const variance = pca.getExplainedVariance();

  return {
    points: scores.map((r) => [r[0] ?? 0, r[1] ?? 0] as [number, number]),
    explained: [variance[0] ?? 0, variance[1] ?? 0],
  };
}

/** Per-segment summary in the units a marketer actually reads. */
function buildProfiles(
  data: PreparedData,
  assignments: number[],
  k: number,
): ClusterProfile[] {
  const profiles: ClusterProfile[] = [];

  for (let c = 0; c < k; c++) {
    const idx: number[] = [];
    for (let i = 0; i < assignments.length; i++) {
      if (assignments[i] === c) idx.push(i);
    }

    const means: Record<string, number> = {};
    const zMeans: Record<string, number> = {};
    const categoricalBreakdown: Record<string, Record<string, number>> = {};

    // Original-unit means for every continuous column still in play.
    for (const col of data.columns) {
      if (col.kind !== 'continuous' || col.excluded) continue;
      let sum = 0;
      let n = 0;
      for (const i of idx) {
        const v = toNum(data.rows[i][col.name]);
        if (v !== null) {
          sum += v;
          n++;
        }
      }
      means[col.name] = n > 0 ? sum / n : 0;
    }

    // Level mix for categorical columns — included or not. An excluded column
    // still describes a segment, it just didn't help build it.
    for (const col of data.columns) {
      if (col.kind !== 'categorical') continue;
      const counts: Record<string, number> = {};
      for (const i of idx) {
        const key = String(data.rows[i][col.name] ?? 'UNKNOWN');
        counts[key] = (counts[key] ?? 0) + 1;
      }
      const pct: Record<string, number> = {};
      for (const [level, n] of Object.entries(counts)) {
        pct[level] = idx.length > 0 ? (n / idx.length) * 100 : 0;
      }
      categoricalBreakdown[col.name] = pct;
    }

    // Z-score means drive the radar chart: every axis on a comparable scale.
    data.featureNames.forEach((name, j) => {
      let sum = 0;
      for (const i of idx) sum += data.matrix[i][j];
      zMeans[name] = idx.length > 0 ? sum / idx.length : 0;
    });

    profiles.push({
      id: c,
      size: idx.length,
      share: assignments.length > 0 ? idx.length / assignments.length : 0,
      means,
      zMeans,
      categoricalBreakdown,
    });
  }

  return profiles;
}

/**
 * Runs clustering at a chosen k and assembles everything the UI and the
 * persona step need. k comes from the diagnostics recommendation or from the
 * user's manual override — the agent does not pick it on its own.
 */
export function runClustering(data: PreparedData, k: number): ClusterResult {
  const run = clusterAt(data.matrix, k);
  const { points, explained } = project(data.matrix);

  const pcaPoints: PcaPoint[] = points.map(([pc1, pc2], i) => ({
    pc1,
    pc2,
    cluster: run.assignments[i],
    rowIndex: i,
  }));

  return {
    k,
    assignments: run.assignments,
    profiles: buildProfiles(data, run.assignments, k),
    pcaPoints,
    explainedVariance: explained,
    silhouette: run.silhouette,
  };
}

/**
 * Stability check: re-cluster an 80% sample and measure how often pairs of
 * points that shared a cluster in the full run still share one. High agreement
 * means the segments are a real structure rather than an artifact of this
 * particular sample.
 */
export function stabilityScore(data: PreparedData, k: number, fraction = 0.8): number {
  const n = data.matrix.length;
  const sampleSize = Math.floor(n * fraction);
  if (sampleSize < k + 1) return 0;

  // Deterministic stride sample — same result every run, no RNG needed.
  const stride = n / sampleSize;
  const idx: number[] = [];
  for (let i = 0; i < sampleSize; i++) idx.push(Math.floor(i * stride));

  const full = clusterAt(data.matrix, k);
  const sub = clusterAt(
    idx.map((i) => data.matrix[i]),
    k,
  );

  let agree = 0;
  let total = 0;
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const togetherFull = full.assignments[idx[a]] === full.assignments[idx[b]];
      const togetherSub = sub.assignments[a] === sub.assignments[b];
      if (togetherFull === togetherSub) agree++;
      total++;
    }
  }

  return total > 0 ? agree / total : 0;
}
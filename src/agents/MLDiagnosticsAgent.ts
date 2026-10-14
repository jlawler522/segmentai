import { kmeans } from 'ml-kmeans';
import type { Diagnostics, DiagnosticPoint } from '../types';

export interface ClusterRun {
  k: number;
  assignments: number[];
  centroids: number[][];
  wcss: number;
  silhouette: number;
}

/** Squared Euclidean distance — avoids a sqrt when only comparing. */
function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return sum;
}

function distance(a: number[], b: number[]): number {
  return Math.sqrt(squaredDistance(a, b));
}

/**
 * Full pairwise distance matrix. O(n^2) in memory, which is fine up to a few
 * thousand rows and lets every k in the sweep reuse the same distances.
 */
export function buildDistanceMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const dist: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distance(matrix[i], matrix[j]);
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

/**
 * Mean silhouette coefficient across all points.
 * For each point: a = mean distance to its own cluster, b = mean distance to
 * the nearest other cluster, score = (b - a) / max(a, b).
 * Singleton clusters score 0 by convention.
 */
export function silhouetteScore(
  assignments: number[],
  k: number,
  dist: number[][],
): number {
  const n = assignments.length;
  if (k < 2 || n <= k) return 0;

  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) members[assignments[i]].push(i);

  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = assignments[i];
    if (members[own].length <= 1) continue; // silhouette 0 for singletons

    let a = 0;
    for (const j of members[own]) {
      if (j !== i) a += dist[i][j];
    }
    a /= members[own].length - 1;

    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === own || members[c].length === 0) continue;
      let mean = 0;
      for (const j of members[c]) mean += dist[i][j];
      mean /= members[c].length;
      if (mean < b) b = mean;
    }

    if (b === Infinity) continue;
    total += (b - a) / Math.max(a, b);
  }

  return total / n;
}

/** Within-cluster sum of squares (inertia) — the elbow plot's y-axis. */
export function computeWcss(
  matrix: number[][],
  assignments: number[],
  centroids: number[][],
): number {
  let sum = 0;
  for (let i = 0; i < matrix.length; i++) {
    sum += squaredDistance(matrix[i], centroids[assignments[i]]);
  }
  return sum;
}

/** ml-kmeans has returned centroids in two shapes across versions. */
function normalizeCentroids(raw: unknown): number[][] {
  if (!Array.isArray(raw)) throw new Error('kmeans returned no centroids.');
  return raw.map((c) => {
    if (Array.isArray(c)) return c as number[];
    if (c && typeof c === 'object' && 'centroid' in c) {
      return (c as { centroid: number[] }).centroid;
    }
    throw new Error('Unrecognized centroid shape from ml-kmeans.');
  });
}

const RESTARTS = 10;

/**
 * K-Means++ at a fixed k, with multiple seeded restarts. Keeps the run with
 * the lowest WCSS, which is how scikit-learn's n_init behaves. Seeding makes
 * results reproducible across page loads — necessary for the stability check.
 */
export function clusterAt(matrix: number[][], k: number, dist?: number[][]): ClusterRun {
  if (k < 2) throw new Error('k must be at least 2.');
  if (k > matrix.length) throw new Error(`k=${k} exceeds row count ${matrix.length}.`);

  let best: { assignments: number[]; centroids: number[][]; wcss: number } | null = null;

  for (let seed = 0; seed < RESTARTS; seed++) {
    const res = kmeans(matrix, k, {
      initialization: 'kmeans++',
      maxIterations: 300,
      seed,
    });
    const centroids = normalizeCentroids(res.centroids);
    const assignments = res.clusters;
    const wcss = computeWcss(matrix, assignments, centroids);
    if (!best || wcss < best.wcss) best = { assignments, centroids, wcss };
  }

  if (!best) throw new Error('Clustering failed to produce a result.');

  const distances = dist ?? buildDistanceMatrix(matrix);
  return {
    k,
    assignments: best.assignments,
    centroids: best.centroids,
    wcss: best.wcss,
    silhouette: silhouetteScore(best.assignments, k, distances),
  };
}

/**
 * Sweeps k across a range, returning the elbow and silhouette curves plus the
 * recommended k (peak silhouette).
 *
 * Caveat the UI should surface: if silhouette rises monotonically to kMax,
 * there is no real peak and the "recommendation" is just the ceiling. That
 * usually means a binary feature is dominating the split.
 */
export function runDiagnostics(matrix: number[][], kMin = 2, kMax = 8): Diagnostics {
  if (matrix.length < 3) throw new Error('Need at least 3 rows to cluster.');

  const upper = Math.min(kMax, matrix.length - 1);
  const dist = buildDistanceMatrix(matrix);
  const sweep: DiagnosticPoint[] = [];

  for (let k = kMin; k <= upper; k++) {
    const run = clusterAt(matrix, k, dist);
    sweep.push({ k: run.k, wcss: run.wcss, silhouette: run.silhouette });
  }

  const recommendedK = sweep.reduce((a, b) => (b.silhouette > a.silhouette ? b : a)).k;

  return { sweep, recommendedK };
}
// ---- Raw ingestion ----

export type RawValue = string | number | boolean | null;
export type RawRow = Record<string, RawValue>;

export type FeatureKind = 'continuous' | 'categorical' | 'identifier';

export interface ColumnMeta {
  name: string;
  kind: FeatureKind;
  /** Excluded from the feature matrix (identifiers, user opt-outs). */
  excluded: boolean;
  /** Populated for continuous columns, used for z-score normalization. */
  mean?: number;
  std?: number;
  /** Populated for categorical columns: ordered level list for encoding. */
  levels?: string[];
  missingCount: number;
}

// ---- Prepared data ----

export interface PreparedData {
  /** Original rows, post-dedup, with missing values imputed. */
  rows: RawRow[];
  columns: ColumnMeta[];
  /** Column names in matrix order (encoded categoricals included). */
  featureNames: string[];
  /** Z-scored matrix: rows.length x featureNames.length */
  matrix: number[][];
  duplicatesRemoved: number;
}

// ---- Diagnostics ----

export interface DiagnosticPoint {
  k: number;
  /** Within-cluster sum of squares (inertia), for the elbow plot. */
  wcss: number;
  /** Mean silhouette coefficient, -1 to 1. */
  silhouette: number;
}

export interface Diagnostics {
  sweep: DiagnosticPoint[];
  /** k at peak silhouette score. */
  recommendedK: number;
}

// ---- Clustering ----

export interface ClusterProfile {
  id: number;
  size: number;
  share: number;
  /** Mean of each feature, in original units (not z-scored). */
  means: Record<string, number>;
  /** Mean of each feature in z-score units, for radar comparison. */
  zMeans: Record<string, number>;
  /**
   * Level distribution for categorical columns, as percentages. Includes
   * columns excluded from clustering, so they can still profile a segment
   * without influencing how it was formed.
   */
  categoricalBreakdown: Record<string, Record<string, number>>;
}

export interface PcaPoint {
  pc1: number;
  pc2: number;
  cluster: number;
  rowIndex: number;
}

export interface ClusterResult {
  k: number;
  /** Cluster index per row, aligned to PreparedData.rows. */
  assignments: number[];
  profiles: ClusterProfile[];
  pcaPoints: PcaPoint[];
  explainedVariance: [number, number];
  silhouette: number;
}

// ---- Personas ----

/** A campaign idea and the specific finding it rests on. */
export interface CampaignIdea {
  idea: string;
  /** Which observed number motivates this. Forces a traceable rationale. */
  basedOn: string;
}

export interface Persona {
  clusterId: number;
  label: string;
  narrative: string;
  /**
   * Claims the model can support with a number from the payload. Each should
   * cite the figure it rests on.
   */
  observedFacts: string[];
  /**
   * Plausible but untested explanations — motivations, attitudes, lifestyle.
   * The payload contains no evidence for any of these, so the UI renders them
   * as lower-confidence. Keeping them is useful; presenting them as findings
   * is not.
   */
  hypotheses: string[];
  /** The segment most similar to this one, by id. */
  closestSegment: number | null;
  /** What separates this segment from its closest neighbour. */
  keyContrast: string;
  campaignIdeas: CampaignIdea[];
}

// ---- Pipeline state ----

export type PipelineStage = 'IDLE' | 'PARSED' | 'DIAGNOSED' | 'CLUSTERED';

export interface PipelineError {
  stage: PipelineStage;
  message: string;
}
// ---- LLM provider ----

export type Provider = 'claude' | 'gemini';

export interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
}

/** Exactly what gets sent to the LLM — aggregates only, never rows. */
export interface PersonaPayload {
  featureNames: string[];
  totalCustomers: number;
  segments: {
    id: number;
    size: number;
    sharePct: number;
    averages: Record<string, number>;
    mix: Record<string, Record<string, number>>;
  }[];
}

export type ApprovalState = 'pending' | 'approved' | 'rejected';
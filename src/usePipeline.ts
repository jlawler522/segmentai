import { useCallback, useMemo, useState } from 'react';
import { parseFile, prepare } from './agents/DataPrepAgent';
import { runDiagnostics } from './agents/MLDiagnosticsAgent';
import { runClustering, stabilityScore } from './agents/ClusterAgent';
import { DEFAULT_MODELS, generatePersonas } from './agents/PersonaAgent';
import type {
  ApprovalState,
  LlmConfig,
  Persona,
  PipelineStage,
  Provider,
  RawRow,
} from './types';

/**
 * Orchestrates the agent handoffs as an explicit state machine:
 * IDLE -> PARSED -> DIAGNOSED -> CLUSTERED.
 *
 * Each stage validates the previous stage's output before proceeding, and the
 * persona step is gated on a human decision rather than running automatically.
 */
export function usePipeline() {
  const [rawRows, setRawRows] = useState<RawRow[] | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [overrideK, setOverrideK] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [provider, setProvider] = useState<Provider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [personaError, setPersonaError] = useState<string | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [approval, setApproval] = useState<ApprovalState>('pending');

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    setRawRows(null);
    setExcluded([]);
    setOverrideK(null);
    setPersonas(null);
    setPersonaError(null);
    setApproval('pending');
    try {
      const rows = await parseFile(file);
      setRawRows(rows);
      setFileName(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Stage: PARSED -> DIAGNOSED
  const prepped = useMemo(() => {
    if (!rawRows) return null;
    try {
      const data = prepare(rawRows, excluded);
      return { data, diag: runDiagnostics(data.matrix) };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [rawRows, excluded]);

  const k = overrideK ?? prepped?.diag.recommendedK ?? 3;

  // Stage: DIAGNOSED -> CLUSTERED
  const clustered = useMemo(() => {
    if (!prepped) return null;
    try {
      return {
        result: runClustering(prepped.data, k),
        stability: stabilityScore(prepped.data, k),
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }, [prepped, k]);

  const stage: PipelineStage = !rawRows
    ? 'IDLE'
    : !prepped
      ? 'PARSED'
      : !clustered
        ? 'DIAGNOSED'
        : 'CLUSTERED';

  /**
   * Validation gate. The persona step should not run on a segmentation that
   * fails these checks, so the UI can surface them before any LLM call.
   */
  const validation = useMemo(() => {
    if (!clustered || !prepped) return null;
    const { result, stability } = clustered;
    const smallest = Math.min(...result.profiles.map((p) => p.size));
    const monotonic = prepped.diag.sweep.every(
      (p, i, arr) => i === 0 || p.silhouette > arr[i - 1].silhouette,
    );
    return {
      silhouette: result.silhouette,
      silhouettePass: result.silhouette >= 0.25,
      smallest,
      sizePass: smallest >= 10,
      stability,
      stabilityPass: stability >= 0.8,
      explained: result.explainedVariance[0] + result.explainedVariance[1],
      noPeak: monotonic,
    };
  }, [clustered, prepped]);

  const runPersonas = useCallback(async () => {
    if (!prepped || !clustered) return;
    setPersonaLoading(true);
    setPersonaError(null);
    try {
      const config: LlmConfig = {
        provider,
        apiKey,
        model: DEFAULT_MODELS[provider],
      };
      setPersonas(await generatePersonas(prepped.data, clustered.result, config));
      setApproval('pending');
    } catch (err) {
      setPersonaError(err instanceof Error ? err.message : String(err));
    } finally {
      setPersonaLoading(false);
    }
  }, [prepped, clustered, provider, apiKey]);

  const toggleFeature = useCallback((name: string) => {
    setExcluded((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    setOverrideK(null);
    setPersonas(null);
    setApproval('pending');
  }, []);

  const chooseK = useCallback((next: number) => {
    setOverrideK(next);
    setPersonas(null);
    setApproval('pending');
  }, []);

  return {
    stage,
    fileName,
    error,
    loadFile,
    data: prepped?.data ?? null,
    diag: prepped?.diag ?? null,
    result: clustered?.result ?? null,
    validation,
    k,
    overrideK,
    excluded,
    toggleFeature,
    chooseK,
    provider,
    setProvider,
    apiKey,
    setApiKey,
    personas,
    personaError,
    personaLoading,
    runPersonas,
    approval,
    setApproval,
  };
}
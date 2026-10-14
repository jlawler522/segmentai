import { useState } from 'react';
import { usePipeline } from './usePipeline';
import { buildPayload } from './agents/PersonaAgent';
import { ElbowChart, PcaScatter, SegmentRadar, ShareChart, SilhouetteChart, colorFor } from './components/Charts';
import type { Provider } from './types';

const STEPS = ['Upload', 'Diagnostics', 'Segments', 'Personas'] as const;

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'text-slate-300' : 'text-amber-400'}>
      <span className="mr-2">{ok ? '\u2713' : '!'}</span>
      {children}
    </li>
  );
}

export default function App() {
  const p = usePipeline();
  const [step, setStep] = useState(0);
  const [showPayload, setShowPayload] = useState(false);

  const ready = Boolean(p.data && p.diag && p.result && p.validation);
  const maxStep = ready ? 3 : 0;

  const continuous = p.data?.columns.filter((c) => c.kind === 'continuous' && !c.excluded) ?? [];
  const categorical = p.data?.columns.filter((c) => c.kind === 'categorical') ?? [];

  return (
    <div className="min-h-full p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">SegmentAI</h1>
          <p className="mt-1 text-sm text-slate-400">
            Customer segmentation that runs entirely in your browser
          </p>
        </div>
        {p.fileName && <span className="text-xs text-slate-500">{p.fileName}</span>}
      </header>

      <nav className="mt-6 flex gap-1 text-sm border-b border-slate-800">
        {STEPS.map((label, i) => (
          <button
            key={label}
            disabled={i > maxStep}
            onClick={() => setStep(i)}
            className={
              step === i
                ? 'px-4 py-2 border-b-2 -mb-px border-slate-200 text-slate-100'
                : i > maxStep
                  ? 'px-4 py-2 border-b-2 -mb-px border-transparent text-slate-700 cursor-not-allowed'
                  : 'px-4 py-2 border-b-2 -mb-px border-transparent text-slate-400 hover:text-slate-200'
            }
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>

      {p.error && (
        <div className="mt-4 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {p.error}
        </div>
      )}

      {step === 0 && (
        <section className="mt-6 space-y-4 text-sm">
          <label className="block border border-dashed border-slate-700 rounded-lg p-10 text-center cursor-pointer hover:border-slate-500">
            <input
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  p.loadFile(f);
                  setStep(1);
                }
              }}
            />
            <span className="text-slate-300">Click to select a CSV, Excel, or JSON file</span>
            <span className="mt-2 block text-xs text-slate-500">
              Your file is read in the browser. It is never uploaded anywhere.
            </span>
          </label>

          {p.data && (
            <div className="rounded border border-slate-800 p-4">
              <h2 className="font-medium text-slate-200">Data prepared</h2>
              <p className="mt-2 text-slate-400">
                {p.data.rows.length} rows · {p.data.duplicatesRemoved} duplicates removed ·{' '}
                {p.data.featureNames.length} encoded features
              </p>
              <table className="mt-3 w-full text-left text-slate-400">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-4">Column</th>
                    <th className="py-1 pr-4">Type</th>
                    <th className="py-1 pr-4">Missing</th>
                    <th className="py-1">Role</th>
                  </tr>
                </thead>
                <tbody>
                  {p.data.columns.map((c) => (
                    <tr key={c.name} className="border-t border-slate-800">
                      <td className="py-1 pr-4 text-slate-300">{c.name}</td>
                      <td className="py-1 pr-4">{c.kind}</td>
                      <td className="py-1 pr-4">{c.missingCount}</td>
                      <td className="py-1">
                        {c.kind === 'identifier' ? 'excluded (identifier)' : c.excluded ? 'profile only' : 'clustering'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {step === 1 && p.diag && p.data && (
        <section className="mt-6 space-y-6 text-sm">
          <div className="rounded border border-slate-800 p-4">
            <h2 className="font-medium text-slate-200">Features used for clustering</h2>
            <p className="mt-1 text-slate-500">
              Unchecked columns still describe segments, but no longer shape them.
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              {p.data.columns
                .filter((c) => c.kind !== 'identifier')
                .map((c) => (
                  <label key={c.name} className="flex items-center gap-2 text-slate-300">
                    <input
                      type="checkbox"
                      checked={!p.excluded.includes(c.name)}
                      onChange={() => p.toggleFeature(c.name)}
                    />
                    {c.name}
                  </label>
                ))}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded border border-slate-800 p-4">
              <h3 className="font-medium text-slate-200">Elbow (WCSS)</h3>
              <p className="mb-2 text-xs text-slate-500">Lower is tighter; look for the bend.</p>
              <ElbowChart diag={p.diag} />
            </div>
            <div className="rounded border border-slate-800 p-4">
              <h3 className="font-medium text-slate-200">Silhouette</h3>
              <p className="mb-2 text-xs text-slate-500">Higher is better separated; look for a peak.</p>
              <SilhouetteChart diag={p.diag} />
            </div>
          </div>

          <div className="rounded border border-slate-800 p-4">
            <h3 className="font-medium text-slate-200">Choose segment count</h3>
            <div className="mt-3 flex items-center gap-3 text-slate-300">
              <span>k =</span>
              <select
                value={p.k}
                onChange={(e) => p.chooseK(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1"
              >
                {p.diag.sweep.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.k}
                    {s.k === p.diag?.recommendedK ? ' (recommended)' : ''}
                  </option>
                ))}
              </select>
              {p.overrideK !== null && p.overrideK !== p.diag.recommendedK && (
                <span className="text-amber-400 text-xs">manual override</span>
              )}
            </div>
            {p.validation?.noPeak && (
              <div className="mt-3 rounded border border-amber-900 bg-amber-950/30 p-3 text-amber-300">
                Silhouette never peaks within the range tested, so the recommendation is just the
                highest k allowed. A binary feature is probably dominating the split — try
                unchecking it above.
              </div>
            )}
          </div>

          <button
            onClick={() => setStep(2)}
            className="rounded bg-slate-200 px-4 py-2 font-medium text-slate-900 hover:bg-white"
          >
            Continue to segments
          </button>
        </section>
      )}

      {step === 2 && p.result && p.data && p.validation && (
        <section className="mt-6 space-y-6 text-sm">
          <div className="rounded border border-slate-800 p-4">
            <h2 className="font-medium text-slate-200">Validation</h2>
            <ul className="mt-3 space-y-1">
              <Check ok={p.validation.silhouettePass}>
                Silhouette {p.validation.silhouette.toFixed(4)} at k={p.k}
                {p.validation.silhouettePass ? '' : ' — weak separation'}
              </Check>
              <Check ok={p.validation.sizePass}>
                Smallest segment {p.validation.smallest} customers
                {p.validation.sizePass ? '' : ' — too small to target'}
              </Check>
              <Check ok={p.validation.stabilityPass}>
                Stability {(p.validation.stability * 100).toFixed(1)}% pair agreement on an 80% resample
              </Check>
              <Check ok={p.validation.explained >= 0.6}>
                PCA plot shows {(p.validation.explained * 100).toFixed(1)}% of total variance
              </Check>
            </ul>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="rounded border border-slate-800 p-4">
              <h3 className="font-medium text-slate-200">Segment map (PCA)</h3>
              <p className="mb-2 text-xs text-slate-500">
                A 2D shadow of the full feature space — nearby points may still differ.
              </p>
              <PcaScatter result={p.result} />
            </div>
            <div className="rounded border border-slate-800 p-4">
              <h3 className="font-medium text-slate-200">Segment fingerprints</h3>
              <p className="mb-2 text-xs text-slate-500">
                Each panel is one segment against the dataset average. Shared scale, so
                panels are directly comparable.
              </p>
              <SegmentRadar result={p.result} featureNames={p.data.featureNames} />
            </div>
          </div>

          <div className="rounded border border-slate-800 p-4">
            <h3 className="font-medium text-slate-200">Segment sizes</h3>
            <ShareChart result={p.result} />
          </div>

          <div className="rounded border border-slate-800 p-4 overflow-x-auto">
            <h3 className="font-medium text-slate-200">Profiles</h3>
            <table className="mt-3 w-full text-left text-slate-400 whitespace-nowrap">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-4">Segment</th>
                  <th className="py-1 pr-4">Size</th>
                  <th className="py-1 pr-4">Share</th>
                  {continuous.map((c) => (
                    <th key={c.name} className="py-1 pr-4">{c.name}</th>
                  ))}
                  {categorical.map((c) => (
                    <th key={c.name} className="py-1 pr-4">
                      {c.name}{c.excluded ? ' (profile only)' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...p.result.profiles]
                  .sort((a, b) => b.size - a.size)
                  .map((prof) => (
                    <tr key={prof.id} className="border-t border-slate-800">
                      <td className="py-1 pr-4">
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: colorFor(prof.id) }} />
                        <span className="text-slate-300">#{prof.id}</span>
                      </td>
                      <td className="py-1 pr-4">{prof.size}</td>
                      <td className="py-1 pr-4">{(prof.share * 100).toFixed(1)}%</td>
                      {continuous.map((c) => (
                        <td key={c.name} className="py-1 pr-4">{prof.means[c.name]?.toFixed(1) ?? '—'}</td>
                      ))}
                      {categorical.map((c) => {
                        const mix = prof.categoricalBreakdown[c.name] ?? {};
                        const top = Object.entries(mix).sort((a, b) => b[1] - a[1])[0];
                        return (
                          <td key={c.name} className="py-1 pr-4">
                            {top ? `${top[0]} ${top[1].toFixed(0)}%` : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={() => setStep(3)}
            className="rounded bg-slate-200 px-4 py-2 font-medium text-slate-900 hover:bg-white"
          >
            Continue to personas
          </button>
        </section>
      )}

      {step === 3 && p.result && p.data && (
        <section className="mt-6 space-y-6 text-sm">
          <div className="rounded border border-slate-800 p-4">
            <h2 className="font-medium text-slate-200">AI persona generation</h2>
            <p className="mt-1 text-slate-500">
              Your key is held in memory for this page only — never stored, never sent anywhere
              except directly to the provider you choose.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <select
                value={p.provider}
                onChange={(e) => p.setProvider(e.target.value as Provider)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300"
              >
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
              </select>
              <input
                type="password"
                value={p.apiKey}
                onChange={(e) => p.setApiKey(e.target.value)}
                placeholder="Paste API key"
                className="flex-1 min-w-60 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-300"
              />
              <button
                onClick={p.runPersonas}
                disabled={p.personaLoading || !p.apiKey.trim()}
                className="rounded bg-slate-200 px-4 py-1.5 font-medium text-slate-900 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {p.personaLoading ? 'Generating…' : 'Generate personas'}
              </button>
            </div>

            <button
              onClick={() => setShowPayload((s) => !s)}
              className="mt-3 text-xs text-slate-400 underline hover:text-slate-200"
            >
              {showPayload ? 'Hide' : 'Show'} exactly what gets sent
            </button>
            {showPayload && (
              <pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-900/60 p-3 text-xs text-slate-400">
                {JSON.stringify(buildPayload(p.data, p.result), null, 2)}
              </pre>
            )}
          </div>

          {p.personaError && (
            <div className="rounded border border-red-900 bg-red-950/40 p-3 text-red-300">
              {p.personaError}
            </div>
          )}

          {p.personas && (
            <>
                            <div className="grid md:grid-cols-2 gap-4">
                {p.personas.map((persona) => {
                  const prof = p.result?.profiles.find((x) => x.id === persona.clusterId);
                  return (
                    <div key={persona.clusterId} className="rounded border border-slate-800 p-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full"
                          style={{ backgroundColor: colorFor(persona.clusterId) }}
                        />
                        <h3 className="font-medium text-slate-100">{persona.label}</h3>
                        <span className="text-xs text-slate-500">
                          #{persona.clusterId} · {prof?.size ?? 0} customers
                        </span>
                      </div>

                      <p className="mt-2 text-slate-400">{persona.narrative}</p>

                      {persona.keyContrast && (
                        <p className="mt-3 rounded border-l-2 border-slate-600 bg-slate-900/40 py-2 pl-3 text-slate-300">
                          {persona.closestSegment !== null && (
                            <span className="mr-2 text-xs text-slate-500">
                              vs #{persona.closestSegment}
                            </span>
                          )}
                          {persona.keyContrast}
                        </p>
                      )}

                      {persona.observedFacts.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-xs uppercase tracking-wide text-slate-400">
                            Observed in the data
                          </h4>
                          <ul className="mt-1 list-disc list-inside text-slate-300">
                            {persona.observedFacts.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {persona.hypotheses.length > 0 && (
                        <div className="mt-4 rounded border border-dashed border-slate-800 p-3">
                          <h4 className="text-xs uppercase tracking-wide text-amber-600/80">
                            Hypotheses · not supported by this data
                          </h4>
                          <ul className="mt-1 list-disc list-inside italic text-slate-500">
                            {persona.hypotheses.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {persona.campaignIdeas.length > 0 && (
                        <div className="mt-4">
                          <h4 className="text-xs uppercase tracking-wide text-slate-400">
                            Campaign ideas
                          </h4>
                          <ul className="mt-1 space-y-2 text-slate-300">
                            {persona.campaignIdeas.map((c, i) => (
                              <li key={i}>
                                {c.idea}
                                {c.basedOn && (
                                  <span className="mt-0.5 block text-xs text-slate-500">
                                    based on: {c.basedOn}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded border border-slate-800 p-4">
                <h3 className="font-medium text-slate-200">Marketer review</h3>
                <p className="mt-1 text-slate-500">
                  Nothing here is approved until a human signs off. These are recommendations, not
                  decisions.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <button
                    onClick={() => p.setApproval('approved')}
                    className="rounded border border-emerald-700 bg-emerald-950/40 px-4 py-1.5 text-emerald-300 hover:bg-emerald-900/40"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => p.setApproval('rejected')}
                    className="rounded border border-red-800 bg-red-950/30 px-4 py-1.5 text-red-300 hover:bg-red-900/30"
                  >
                    Reject
                  </button>
                  <button
                    onClick={p.runPersonas}
                    disabled={p.personaLoading}
                    className="rounded border border-slate-700 px-4 py-1.5 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Regenerate
                  </button>
                  <span className="text-slate-500">
                    Status:{' '}
                    <span
                      className={
                        p.approval === 'approved'
                          ? 'text-emerald-400'
                          : p.approval === 'rejected'
                            ? 'text-red-400'
                            : 'text-slate-400'
                      }
                    >
                      {p.approval}
                    </span>
                  </span>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
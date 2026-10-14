# SegmentAI

Customer segmentation that runs entirely in the browser. Upload a customer file, get K-Means segments with clustering diagnostics, then optionally generate AI personas from segment-level aggregates.

Built for MKTG 2201 (Northeastern, Fall 2026) from the class example prompt for a multi-agent segmentation tool.

**Raw customer data never leaves the browser.** Parsing, clustering, and PCA all run client-side. Only aggregated segment statistics are sent to an LLM, and the app shows you that exact payload before sending it.

---

## Running it

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and load `sample-data/Mall_Customers.csv`.

Steps 1–3 (data prep, diagnostics, clustering) need no API key. Step 4 is optional and requires your own Gemini or Anthropic key, entered in the UI and held in memory only.

---

## Architecture

Five modules, each owning one stage, with an explicit state machine between them (`IDLE → PARSED → DIAGNOSED → CLUSTERED`).

| Module | Responsibility |
|---|---|
| `DataPrepAgent.ts` | Parse CSV/XLSX/JSON, classify columns, dedupe, impute, encode, z-score |
| `MLDiagnosticsAgent.ts` | Sweep k=2–8, compute WCSS and silhouette, recommend k |
| `ClusterAgent.ts` | Cluster at chosen k, build profiles, PCA projection, stability check |
| `PersonaAgent.ts` | Build the aggregate payload, call Claude or Gemini, parse the response |
| `usePipeline.ts` | Orchestrate handoffs, gate the persona step on validation |

Segmentation and validation are deliberately separate. The component that produces the clusters is not the one that grades them.

### Data preparation

Identifier columns are detected and excluded from the feature matrix — clustering on a sequential customer ID partly sorts segments by row order. Categorical columns are encoded (binary for two levels, one-hot beyond that). All features are z-scored, so a 40-point swing in income and a 40-point swing in spending score carry equal weight. Zero-variance features are dropped rather than dividing by zero.

### Validation

Four checks, surfaced before any LLM call:

- **Silhouette** — cluster separation at the chosen k
- **Segment size** — flags any segment too small to target
- **Stability** — re-clusters an 80% sample and measures pair agreement against the full run
- **PCA variance explained** — how much of the data the 2D scatter actually represents

Stability is worth a caveat: it measures whether the algorithm is consistent, not whether the segmentation is useful. See the finding below.

---

## Finding: silhouette recommended a segmentation worth discarding

The sample dataset has a binary Gender column. With it included:

| k | Silhouette (with Gender) | Silhouette (without) |
|---|---|---|
| 2 | 0.2518 | 0.3355 |
| 4 | 0.2995 | 0.4040 |
| 6 | 0.3255 | **0.4274** |
| 8 | **0.3874** | 0.4087 |

With Gender, silhouette rises monotonically and never peaks, so "pick the best score" just picks the largest k allowed. At k=8 every cluster came out 100% single-gender — K-Means spent its first split on the perfectly separable binary feature, then mirrored four real segments across both genders. Segments #3 and #7 were the same customer profile twice.

Stability at that k was 99.4%. The split was highly reproducible and analytically useless.

Removing Gender from the feature set gives a real peak at k=6 with six behaviorally distinct segments. Gender is retained as a profiling variable — it describes segments without shaping them.

The UI detects the monotonic case and warns rather than silently recommending the ceiling.

### The segments (k=6, Gender excluded)

| # | Size | Age | Income (k$) | Spending |
|---|---|---|---|---|
| 2 | 45 | 56.3 | 54.3 | 49.1 |
| 0 | 39 | 32.7 | 86.5 | 82.1 |
| 3 | 38 | 26.7 | 57.6 | 47.8 |
| 1 | 33 | 41.9 | 88.9 | 17.0 |
| 4 | 24 | 25.3 | 25.8 | 76.9 |
| 5 | 21 | 45.5 | 26.3 | 19.4 |

Segments #0 and #1 are the useful pair: near-identical income, opposite spending behavior. No demographic variable predicts that difference.

---

## Finding: schema design changed what the LLM would assert

The persona step originally asked for a `behavioralDrivers` field. Across three runs on identical data, every item in that field was fabricated — the model received three averages and a gender mix per segment and returned "desire for status," "brand loyalty," "impulse purchases," "risk aversion." It also produced false rankings between values differing by under 2%.

Replacing that single field with two — `observedFacts` (must cite a figure from the payload) and `hypotheses` (explicitly labeled unverified) — moved every motivational claim to the hypotheses side. Adding required `closestSegment` and `keyContrast` fields made the #0/#1 contrast appear reliably, where previously it surfaced in one run out of three.

The constraint improves compliance without guaranteeing it. The near-tie rule is followed in most runs and missed occasionally, which is the reason the approval gate exists.

Hypotheses are rendered dimmed and labeled "not supported by this data," so the distinction survives into the UI rather than living only in the prompt.

---

## Privacy boundary

The LLM receives per-segment size, share, feature averages, and category mixes. No customer rows, no identifiers, nothing reversible. The payload is identical in shape whether the file holds 200 customers or 200,000.

"Show exactly what gets sent" in step 4 renders the actual request body. The claim is inspectable rather than asserted.

API keys are entered in the UI, held in React state, and never written to disk or committed.

---

## Known limitations

- Model IDs are hardcoded in `DEFAULT_MODELS`. Providers retire models, and this breaks when they do — a model selector querying the provider's model list would be more robust.
- The near-tie rule in the persona prompt is followed inconsistently.
- Full pairwise distance matrix is O(n²) in memory; fine to a few thousand rows, not beyond.
- K-Means assumes roughly spherical clusters and is sensitive to outliers.
- The sample dataset has only three usable numeric features, which limits how much PCA and the radar charts can show.

---

## Stack

React 19 · TypeScript · Vite · Tailwind · ml-kmeans · ml-pca · Recharts · PapaParse · SheetJS

Sample data: [Mall Customer Segmentation](https://www.kaggle.com/datasets/vjchoudhary7/customer-segmentation-tutorial-in-python) (Kaggle, public). No proprietary data in this repository.
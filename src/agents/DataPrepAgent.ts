import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type {
  ColumnMeta,
  FeatureKind,
  PreparedData,
  RawRow,
  RawValue,
} from '../types';

/** Values we treat as missing regardless of column type. */
function isMissing(v: RawValue): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

function toNumber(v: RawValue): number | null {
  if (isMissing(v)) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---- Stage 1: file parsing ----

export async function parseFile(file: File): Promise<RawRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    return parseDelimited(file);
  }
  if (ext === 'xlsx' || ext === 'xls') {
    return parseExcel(file);
  }
  if (ext === 'json') {
    return parseJson(file);
  }
  throw new Error(`Unsupported file type ".${ext}". Use CSV, XLSX, XLS, or JSON.`);
}

function parseDelimited(file: File): Promise<RawRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const rows = res.data.filter((r) => r && Object.keys(r).length > 0);
        if (rows.length === 0) reject(new Error('File parsed but contained no data rows.'));
        else resolve(rows);
      },
      error: (err) => reject(new Error(`CSV parse failed: ${err.message}`)),
    });
  });
}

async function parseExcel(file: File): Promise<RawRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('Workbook contains no sheets.');
  const rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheetName], { defval: null });
  if (rows.length === 0) throw new Error(`Sheet "${sheetName}" contained no data rows.`);
  return rows;
}

async function parseJson(file: File): Promise<RawRow[]> {
  const text = await file.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!Array.isArray(data)) throw new Error('JSON must be an array of objects.');
  if (data.length === 0) throw new Error('JSON array is empty.');
  if (typeof data[0] !== 'object' || data[0] === null) {
    throw new Error('JSON must be an array of flat objects.');
  }
  return data as RawRow[];
}

// ---- Stage 2: column classification ----

const ID_PATTERN = /(^|[_\s])id$|^id$|id$/i;

function classifyColumns(rows: RawRow[]): ColumnMeta[] {
  const names = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));

  return names.map((name) => {
    const values = rows.map((r) => r[name] ?? null);
    const present = values.filter((v) => !isMissing(v));
    const missingCount = values.length - present.length;
    const distinct = new Set(present.map((v) => String(v))).size;

    const allNumeric = present.length > 0 && present.every((v) => toNumber(v) !== null);
    const looksLikeId = ID_PATTERN.test(name);
    const allUnique = distinct === present.length && present.length === rows.length;

    let kind: FeatureKind;
    if (allUnique && (looksLikeId || !allNumeric)) {
      kind = 'identifier';
    } else if (allNumeric) {
      kind = 'continuous';
    } else {
      kind = 'categorical';
    }

    const meta: ColumnMeta = {
      name,
      kind,
      excluded: kind === 'identifier',
      missingCount,
    };

    if (kind === 'categorical') {
      meta.levels = Array.from(new Set(present.map((v) => String(v)))).sort();
    }
    return meta;
  });
}

// ---- Stage 3: deduplication ----

/** Row signature over non-identifier columns, used for string-hash matching. */
function rowSignature(row: RawRow, columns: ColumnMeta[]): string {
  return columns
    .filter((c) => c.kind !== 'identifier')
    .map((c) => String(row[c.name] ?? ''))
    .join('\u0001');
}

function dedupe(rows: RawRow[], columns: ColumnMeta[]): { rows: RawRow[]; removed: number } {
  const seen = new Set<string>();
  const out: RawRow[] = [];
  for (const row of rows) {
    const sig = rowSignature(row, columns);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(row);
  }
  return { rows: out, removed: rows.length - out.length };
}

// ---- Stage 4: imputation ----

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function mode(vals: string[]): string {
  const counts = new Map<string, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = vals[0];
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function impute(rows: RawRow[], columns: ColumnMeta[]): RawRow[] {
  const fills = new Map<string, RawValue>();

  for (const col of columns) {
    if (col.kind === 'identifier') continue;
    const present = rows.map((r) => r[col.name] ?? null).filter((v) => !isMissing(v));
    if (present.length === 0) {
      fills.set(col.name, col.kind === 'continuous' ? 0 : 'UNKNOWN');
      continue;
    }
    if (col.kind === 'continuous') {
      fills.set(col.name, median(present.map((v) => toNumber(v) as number)));
    } else {
      fills.set(col.name, mode(present.map((v) => String(v))));
    }
  }

  return rows.map((row) => {
    const out: RawRow = { ...row };
    for (const col of columns) {
      if (isMissing(out[col.name] ?? null) && fills.has(col.name)) {
        out[col.name] = fills.get(col.name) as RawValue;
      }
    }
    return out;
  });
}

// ---- Stage 5: encoding + z-score normalization ----

interface EncodedFeature {
  name: string;
  values: number[];
  sourceColumn: string;
}

function encode(rows: RawRow[], columns: ColumnMeta[]): EncodedFeature[] {
  const features: EncodedFeature[] = [];

  for (const col of columns) {
    if (col.excluded || col.kind === 'identifier') continue;

    if (col.kind === 'continuous') {
      features.push({
        name: col.name,
        sourceColumn: col.name,
        values: rows.map((r) => toNumber(r[col.name] ?? null) ?? 0),
      });
      continue;
    }

    const levels = col.levels ?? [];
    if (levels.length < 2) continue; // constant categorical carries no information

    if (levels.length === 2) {
      // Binary: one column, 1 = second level alphabetically.
      const positive = levels[1];
      features.push({
        name: `${col.name}=${positive}`,
        sourceColumn: col.name,
        values: rows.map((r) => (String(r[col.name]) === positive ? 1 : 0)),
      });
    } else {
      // One-hot: one column per level.
      for (const level of levels) {
        features.push({
          name: `${col.name}=${level}`,
          sourceColumn: col.name,
          values: rows.map((r) => (String(r[col.name]) === level ? 1 : 0)),
        });
      }
    }
  }

  return features;
}

function meanOf(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Population standard deviation (ddof = 0). */
function stdOf(nums: number[], mu: number): number {
  const variance = nums.reduce((acc, n) => acc + (n - mu) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

// ---- Public entry point ----

export function prepare(rawRows: RawRow[], excludeColumns: string[] = []): PreparedData {
  if (rawRows.length === 0) throw new Error('No rows to prepare.');

    const columns = classifyColumns(rawRows);
  for (const col of columns) {
    if (excludeColumns.includes(col.name)) col.excluded = true;
  }
  const { rows: deduped, removed } = dedupe(rawRows, columns);
  const rows = impute(deduped, columns);

  const encoded = encode(rows, columns);
  if (encoded.length === 0) {
    throw new Error('No usable features found. Need at least one numeric or categorical column.');
  }

  // Drop zero-variance features — they contribute nothing to distance and
  // would divide by zero during normalization.
  const kept: EncodedFeature[] = [];
  const dropped: string[] = [];
  const stats = new Map<string, { mean: number; std: number }>();

  for (const f of encoded) {
    const mu = meanOf(f.values);
    const sd = stdOf(f.values, mu);
    if (sd === 0) {
      dropped.push(f.name);
      continue;
    }
    stats.set(f.name, { mean: mu, std: sd });
    kept.push(f);
  }

  if (kept.length === 0) {
    throw new Error('All features have zero variance — every row is identical.');
  }
  if (dropped.length > 0) {
    console.warn(`DataPrepAgent: dropped zero-variance features: ${dropped.join(', ')}`);
  }

  // Record stats on the source column metadata for continuous features.
  for (const col of columns) {
    if (col.kind === 'continuous' && stats.has(col.name)) {
      const s = stats.get(col.name)!;
      col.mean = s.mean;
      col.std = s.std;
    }
  }

  const featureNames = kept.map((f) => f.name);
  const matrix = rows.map((_, i) =>
    kept.map((f) => {
      const s = stats.get(f.name)!;
            return (f.values[i] - s.mean) / s.std;
    }),
  );

  return {
    rows,
    columns,
    featureNames,
    matrix,
    duplicatesRemoved: removed,
  };
}
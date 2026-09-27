import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const tableDirectoryPath = path.join(__dirname, '..', 'analysis', 'tableDirectory.json');
const schemaRunsPath = path.join(__dirname, '..', 'analysis', 'schemaDescriptorRuns.json');
const outputDir = path.join(__dirname, '..', 'analysis', 'alignmentCandidates');

interface TableDirectoryEntry {
  name: string;
  pointer: number;
  rangeEnd: number | null;
}

interface RawField {
  fieldName: string;
  typeFlag: number;
  bitOffset: number;
}

interface SchemaRun {
  startOffsetHex: string;
  fields: RawField[];
}

export interface TableAlignmentConfig {
  tableName: string;
  /** startOffsetHex of the schema run in schemaDescriptorRuns.json to use as the field layout */
  schemaStartOffsetHex: string;
  /** field used as the record's unique identifier — should be near-unique across records if alignment is correct */
  idField: string;
  /** fields expected to hold bounded rating-like values (0-99 or field's max bit value, whichever is smaller) */
  ratingFields: string[];
  /** center of the dataStart search window */
  dataStartWindowCenter: number;
  /** +/- bytes to search around the center */
  dataStartWindowRadius: number;
  /** inclusive range of candidate record byte sizes to try */
  recordBytesRange: [number, number];
  sampleSize: number;
}

// Only PLAY is configured so far; add more tables here once their schema run + a
// plausible id/rating field set is known.
export const CONFIGS: TableAlignmentConfig[] = [
  {
    tableName: 'PLAY',
    schemaStartOffsetHex: '0x0EEBA0',
    // NOTE: 'PGID' in run61's file-order layout is only 1 bit wide (next field PHPD
    // starts immediately after it), so it can only take values 0/1 and is useless as
    // a per-record unique-id check. 'RCHD' is the widest field (16 bits, bitOffset 0)
    // in this schema and is a more plausible candidate for showing real cardinality.
    idField: 'RCHD',
    ratingFields: ['POVR', 'PSTR', 'PAWR'],
    dataStartWindowCenter: 0x0ef1b0,
    dataStartWindowRadius: 512,
    recordBytesRange: [48, 72],
    sampleSize: 200
  }
];

export function readBits(buffer: Buffer, startBit: number, width: number): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    const bitIndex = startBit + i;
    const byteIndex = bitIndex >> 3;
    if (byteIndex >= buffer.length) return NaN;
    const bitInByte = bitIndex & 7;
    const bit = (buffer[byteIndex] >> (7 - bitInByte)) & 1;
    value = (value << 1) | bit;
  }
  return value >>> 0;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

interface CandidateResult {
  dataStart: number;
  dataStartHex: string;
  recordBytes: number;
  score: number;
  idUniqueRatio: number;
  ratingFieldStats: Record<string, { min: number; max: number; stddev: number; inRangeFraction: number }>;
}

function scoreCandidate(
  buffer: Buffer,
  fieldsWithWidth: Array<RawField & { bitWidth: number }>,
  dataStart: number,
  recordBytes: number,
  idField: string,
  ratingFields: string[],
  sampleSize: number
): CandidateResult | null {
  const totalBits = recordBytes * 8;
  const maxEnd = dataStart + sampleSize * recordBytes;
  if (maxEnd > buffer.length) return null;

  const idFieldDef = fieldsWithWidth.find(f => f.fieldName === idField);
  if (!idFieldDef) return null;

  const idValues: number[] = [];
  const ratingValues: Record<string, number[]> = {};
  for (const rf of ratingFields) ratingValues[rf] = [];

  for (let rec = 0; rec < sampleSize; rec++) {
    const recordStartBit = (dataStart + rec * recordBytes) * 8;
    const idVal = readBits(buffer, recordStartBit + idFieldDef.bitOffset, idFieldDef.bitWidth);
    if (Number.isNaN(idVal)) return null;
    idValues.push(idVal);

    for (const rf of ratingFields) {
      const def = fieldsWithWidth.find(f => f.fieldName === rf);
      if (!def) continue;
      const val = readBits(buffer, recordStartBit + def.bitOffset, def.bitWidth);
      if (!Number.isNaN(val)) ratingValues[rf].push(val);
    }
  }

  const idUniqueRatio = new Set(idValues).size / idValues.length;

  const ratingFieldStats: CandidateResult['ratingFieldStats'] = {};
  let ratingBonus = 0;
  for (const rf of ratingFields) {
    const def = fieldsWithWidth.find(f => f.fieldName === rf);
    const vals = ratingValues[rf];
    if (!def || vals.length === 0) continue;
    const maxPossible = Math.min(99, 2 ** def.bitWidth - 1);
    const inRangeFraction = vals.filter(v => v >= 0 && v <= maxPossible).length / vals.length;
    const sd = stddev(vals);
    ratingFieldStats[rf] = { min: Math.min(...vals), max: Math.max(...vals), stddev: sd, inRangeFraction };
    if (inRangeFraction > 0.9 && sd > 2) ratingBonus += 3;
  }

  const score = idUniqueRatio * 10 + ratingBonus - (idUniqueRatio < 0.05 ? 20 : 0);

  return {
    dataStart,
    dataStartHex: `0x${dataStart.toString(16).toUpperCase().padStart(6, '0')}`,
    recordBytes,
    score,
    idUniqueRatio,
    ratingFieldStats
  };
}

function runConfig(buffer: Buffer, runs: SchemaRun[], config: TableAlignmentConfig) {
  const run = runs.find(r => r.startOffsetHex === config.schemaStartOffsetHex);
  if (!run) {
    console.log(`No schema run found at ${config.schemaStartOffsetHex} for ${config.tableName}`);
    return;
  }

  const results: CandidateResult[] = [];
  const [minBytes, maxBytes] = config.recordBytesRange;

  for (let recordBytes = minBytes; recordBytes <= maxBytes; recordBytes++) {
    const totalBits = recordBytes * 8;
    const sorted = run.fields.slice().sort((a, b) => a.bitOffset - b.bitOffset);
    const fieldsWithWidth = sorted.map((f, i) => {
      const next = sorted[i + 1];
      const bitWidth = next ? next.bitOffset - f.bitOffset : totalBits - f.bitOffset;
      return { ...f, bitWidth };
    });
    if (fieldsWithWidth.some(f => f.bitWidth <= 0 || f.bitWidth > 32)) continue;

    for (
      let dataStart = config.dataStartWindowCenter - config.dataStartWindowRadius;
      dataStart <= config.dataStartWindowCenter + config.dataStartWindowRadius;
      dataStart++
    ) {
      const result = scoreCandidate(buffer, fieldsWithWidth, dataStart, recordBytes, config.idField, config.ratingFields, config.sampleSize);
      if (result) results.push(result);
    }
  }

  results.sort((a, b) => b.score - a.score);

  console.log(`\n=== ${config.tableName}: top 20 alignment candidates (of ${results.length} scored) ===`);
  console.table(results.slice(0, 20).map(r => ({
    dataStart: r.dataStartHex,
    recordBytes: r.recordBytes,
    score: r.score.toFixed(2),
    idUniqueRatio: r.idUniqueRatio.toFixed(3)
  })));

  fs.mkdirSync(outputDir, { recursive: true });
  const outPath = path.join(outputDir, `${config.tableName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(results.slice(0, 200), null, 2));
  console.log(`Saved top 200 candidates to: ${outPath}`);
}

function main() {
  if (!fs.existsSync(filePath)) throw new Error(`Save file not found at ${filePath}`);
  if (!fs.existsSync(schemaRunsPath)) throw new Error(`Missing ${schemaRunsPath} — run scanSchemaDescriptors.ts first`);

  const buffer = fs.readFileSync(filePath);
  const runs: SchemaRun[] = JSON.parse(fs.readFileSync(schemaRunsPath, 'utf8'));

  for (const config of CONFIGS) {
    runConfig(buffer, runs, config);
  }
}

if (require.main === module) {
  main();
}

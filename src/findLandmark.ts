import * as fs from 'fs';
import * as path from 'path';
import { CONFIGS, readBits } from './scoreRecordAlignment';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const tableDirectoryPath = path.join(__dirname, '..', 'analysis', 'tableDirectory.json');
const schemaRunsPath = path.join(__dirname, '..', 'analysis', 'schemaDescriptorRuns.json');
const alignmentCandidatesDir = path.join(__dirname, '..', 'analysis', 'alignmentCandidates');

interface TableDirectoryEntry {
  name: string;
  pointer: number;
  pointerHex: string;
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

interface AlignmentCandidate {
  dataStart: number;
  dataStartHex: string;
  recordBytes: number;
  score: number;
}

function hex(n: number, w = 6): string {
  return `0x${n.toString(16).toUpperCase().padStart(w, '0')}`;
}

function findNearestTable(offset: number, toc: TableDirectoryEntry[]): TableDirectoryEntry | null {
  const before = toc.filter(t => t.pointer <= offset).sort((a, b) => b.pointer - a.pointer);
  return before[0] ?? null;
}

function searchString(buffer: Buffer, toc: TableDirectoryEntry[], needle: string) {
  console.log(`\n=== Searching for string "${needle}" ===`);
  const variants = [needle, needle.toUpperCase(), needle.toLowerCase()];
  const seen = new Set<number>();

  for (const variant of variants) {
    let idx = buffer.indexOf(variant, 0, 'ascii');
    while (idx !== -1) {
      if (!seen.has(idx)) {
        seen.add(idx);
        const nearest = findNearestTable(idx, toc);
        const contextStart = Math.max(0, idx - 16);
        const context = buffer.subarray(contextStart, idx + variant.length + 16);
        console.log(
          hex(idx),
          `variant="${variant}"`,
          `nearestTable=${nearest ? `${nearest.name}@${nearest.pointerHex}` : 'none'}`,
          `distanceFromTable=${nearest ? idx - nearest.pointer : 'n/a'}`
        );
        console.log('  context:', context.toString('ascii').replace(/[^\x20-\x7e]/g, '.'));
      }
      idx = buffer.indexOf(variant, idx + 1, 'ascii');
    }
  }

  if (seen.size === 0) {
    console.log('No occurrences found.');
  } else {
    console.log(`\nTotal unique occurrences: ${seen.size}`);
  }
}

function searchId(buffer: Buffer, runs: SchemaRun[], tableName: string, targetId: number) {
  console.log(`\n=== Searching for id=${targetId} in ${tableName}'s top alignment candidates ===`);
  const config = CONFIGS.find(c => c.tableName === tableName);
  if (!config) {
    console.log(`No alignment config found for table "${tableName}"`);
    return;
  }

  const candidatesPath = path.join(alignmentCandidatesDir, `${tableName}.json`);
  if (!fs.existsSync(candidatesPath)) {
    console.log(`Missing ${candidatesPath} — run scoreRecordAlignment.ts first`);
    return;
  }
  const candidates: AlignmentCandidate[] = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

  const run = runs.find(r => r.startOffsetHex === config.schemaStartOffsetHex);
  if (!run) {
    console.log(`No schema run found at ${config.schemaStartOffsetHex}`);
    return;
  }
  const idFieldRaw = run.fields.find(f => f.fieldName === config.idField);
  if (!idFieldRaw) {
    console.log(`Field ${config.idField} not found in schema run`);
    return;
  }

  let anyMatch = false;
  for (const candidate of candidates.slice(0, 20)) {
    const totalBits = candidate.recordBytes * 8;
    const sorted = run.fields.slice().sort((a, b) => a.bitOffset - b.bitOffset);
    const idx = sorted.findIndex(f => f.fieldName === config.idField);
    const next = sorted[idx + 1];
    const idBitWidth = next ? next.bitOffset - idFieldRaw.bitOffset : totalBits - idFieldRaw.bitOffset;

    const maxRecords = Math.floor((buffer.length - candidate.dataStart) / candidate.recordBytes);
    for (let rec = 0; rec < maxRecords; rec++) {
      const recordStartBit = (candidate.dataStart + rec * candidate.recordBytes) * 8;
      const val = readBits(buffer, recordStartBit + idFieldRaw.bitOffset, idBitWidth);
      if (val === targetId) {
        anyMatch = true;
        const recordOffset = candidate.dataStart + rec * candidate.recordBytes;
        console.log(
          `MATCH: candidate dataStart=${candidate.dataStartHex} recordBytes=${candidate.recordBytes} ` +
          `record#=${rec} recordOffset=${hex(recordOffset)} score=${candidate.score}`
        );
      }
    }
  }

  if (!anyMatch) {
    console.log('No matches found in the top 20 candidates.');
  }
}

function main() {
  if (!fs.existsSync(filePath)) throw new Error(`Save file not found at ${filePath}`);

  const [mode, value, tableName] = process.argv.slice(2);
  if (!mode || !value) {
    console.log('Usage:');
    console.log('  npx ts-node src/findLandmark.ts string "<text to search for>"');
    console.log('  npx ts-node src/findLandmark.ts id <numericId> [tableName=PLAY]');
    return;
  }

  const buffer = fs.readFileSync(filePath);

  if (mode === 'string') {
    if (!fs.existsSync(tableDirectoryPath)) throw new Error(`Missing ${tableDirectoryPath} — run buildTableDirectory.ts first`);
    const toc: TableDirectoryEntry[] = JSON.parse(fs.readFileSync(tableDirectoryPath, 'utf8'));
    searchString(buffer, toc, value);
  } else if (mode === 'id') {
    if (!fs.existsSync(schemaRunsPath)) throw new Error(`Missing ${schemaRunsPath} — run scanSchemaDescriptors.ts first`);
    const runs: SchemaRun[] = JSON.parse(fs.readFileSync(schemaRunsPath, 'utf8'));
    searchId(buffer, runs, tableName ?? 'PLAY', Number(value));
  } else {
    console.log(`Unknown mode "${mode}". Use "string" or "id".`);
  }
}

main();

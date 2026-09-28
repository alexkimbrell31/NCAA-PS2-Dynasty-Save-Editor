/**
 * How much of the save file do we actually understand?
 * Measure it several ways -- the answer depends heavily on the denominator.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);

// Tables with a validator + doc, i.e. genuinely decoded
const SOLVED = new Set([
  'PLAY', 'TEAM', 'COCH', 'SCHD', 'STAD', 'BOWL', 'PLGA', 'CONF', 'DIVI',
  'WQTS', 'AAPL', 'PSOF', 'PSDE', 'PLAC', 'TSSE', 'PSKI', 'PSKP', 'MCOV', 'MOIN',
]);
// Partially decoded
const PARTIAL = new Set(['HEIS', 'DCHT', 'STTM']);

interface Row {
  name: string; bytes: number; recs: number; maxRecs: number;
  fields: number; dataBytes: number; state: string;
}
const rows: Row[] = [];

const sorted = [...toc].sort((a, b) => a.realOffset - b.realOffset);
for (let i = 0; i < sorted.length; i++) {
  const t = sorted[i];
  const next = i + 1 < sorted.length ? sorted[i + 1].realOffset : header.dbSize + 0x2B0;
  const bytes = next - t.realOffset;
  let recs = 0, maxRecs = 0, fields = 0, dataBytes = 0;
  try {
    const h = parseTableHeader(buf, t.realOffset);
    const f = parseFieldDescriptors(buf, h);
    recs = h.currentRecords; maxRecs = h.maxRecords; fields = f.length;
    dataBytes = h.recordLenBytes * h.currentRecords;
  } catch { /* ignore */ }
  const state = SOLVED.has(t.name) ? 'solved'
    : PARTIAL.has(t.name) ? 'partial'
    : recs === 0 ? 'empty' : 'unknown';
  rows.push({ name: t.name, bytes, recs, maxRecs, fields, dataBytes, state });
}

const sum = (f: (r: Row) => number, pred: (r: Row) => boolean) =>
  rows.filter(pred).reduce((s, r) => s + f(r), 0);

const fileLen = buf.length;
const dbSize = header.dbSize;
const allocBytes = sum(r => r.bytes, () => true);
const liveBytes = sum(r => r.dataBytes, () => true);

const by = (state: string) => rows.filter(r => r.state === state);
const line = (label: string, num: number, den: number) =>
  console.log(`  ${label.padEnd(44)} ${String(num).padStart(10)} / ${String(den).padStart(10)}  ${(100 * num / den).toFixed(1)}%`);

console.log(`file ${fileLen.toLocaleString()} bytes; dbSize ${dbSize.toLocaleString()}; ` +
  `trailing zero pad ${(fileLen - allocBytes - 0x2B0).toLocaleString()}\n`);

console.log('=== TABLE COUNT ===');
for (const s of ['solved', 'partial', 'unknown', 'empty']) {
  console.log(`  ${s.padEnd(10)} ${String(by(s).length).padStart(3)} tables`);
}

console.log('\n=== BYTES: allocated table space (incl. unused record slots) ===');
line('solved', sum(r => r.bytes, r => r.state === 'solved'), allocBytes);
line('partial', sum(r => r.bytes, r => r.state === 'partial'), allocBytes);
line('unknown (populated, undecoded)', sum(r => r.bytes, r => r.state === 'unknown'), allocBytes);
line('empty (0 rows -- undecodable from this save)', sum(r => r.bytes, r => r.state === 'empty'), allocBytes);

console.log('\n=== BYTES: LIVE data only (recLen * currentRecords) ===');
console.log(`  live data total: ${liveBytes.toLocaleString()} bytes ` +
  `(${(100 * liveBytes / fileLen).toFixed(1)}% of the file)`);
line('solved', sum(r => r.dataBytes, r => r.state === 'solved'), liveBytes);
line('partial', sum(r => r.dataBytes, r => r.state === 'partial'), liveBytes);
line('unknown', sum(r => r.dataBytes, r => r.state === 'unknown'), liveBytes);

console.log('\n=== FIELDS (schema surface) ===');
const allFields = sum(r => r.fields, () => true);
line('solved tables', sum(r => r.fields, r => r.state === 'solved'), allFields);
line('partial', sum(r => r.fields, r => r.state === 'partial'), allFields);
line('unknown populated', sum(r => r.fields, r => r.state === 'unknown'), allFields);
line('empty', sum(r => r.fields, r => r.state === 'empty'), allFields);

console.log('\n=== RECORDS ===');
const allRecs = sum(r => r.recs, () => true);
line('solved', sum(r => r.recs, r => r.state === 'solved'), allRecs);
line('partial', sum(r => r.recs, r => r.state === 'partial'), allRecs);
line('unknown', sum(r => r.recs, r => r.state === 'unknown'), allRecs);

console.log('\n=== biggest UNDECODED populated tables (by live bytes) ===');
by('unknown').sort((a, b) => b.dataBytes - a.dataBytes).slice(0, 12)
  .forEach(r => console.log(`  ${r.name}  ${String(r.dataBytes).padStart(7)} B  ` +
    `${String(r.recs).padStart(5)} recs x ${r.fields} fields`));

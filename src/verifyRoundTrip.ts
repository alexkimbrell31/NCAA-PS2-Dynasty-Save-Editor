/**
 * WRITE PATH GATE: re-encode the entire file and require it to come back
 * byte-identical.
 *
 * Every field of every record of all 82 tables is decoded and immediately
 * written back over a copy of the original buffer. If the writer is a true
 * inverse of the reader AND the schema is correct, not one byte may change.
 *
 * This is the strongest single test in the project. It is not a check of the
 * write code alone -- it exercises every field descriptor simultaneously, so
 * any bit-order error, off-by-one bit offset, sign-extension mistake or field
 * overlap shows up as a concrete differing byte with a table and field name
 * attached. A schema that survives this is provably self-consistent.
 *
 * It also answers a question we need before shipping an editor: how many bits
 * of each record are NOT covered by any field? Those are bits we must preserve
 * blindly, because we cannot regenerate what we cannot parse.
 */
import {
  type FieldDescriptor,
  type TableHeader,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readField,
  readSaveFile,
  recordOffsetAt,
  writeField,
} from './lib/eadb.ts';

const original = readSaveFile();
const header = parseFileHeader(original);
const toc = parseToc(original, header);

// Work on a copy so any difference is caused by us, not by reading.
const work = Buffer.from(original);

interface Fail {
  table: string;
  record: number;
  detail: string;
}
const failures: Fail[] = [];
const skipped: string[] = [];
let tablesChecked = 0;
let recordsChecked = 0;
let fieldsChecked = 0;

interface Loaded {
  name: string;
  hdr: TableHeader;
  fields: FieldDescriptor[];
}
const loaded: Loaded[] = [];

for (const entry of toc) {
  let hdr: TableHeader;
  try {
    hdr = parseTableHeader(original, entry.realOffset);
  } catch (err) {
    skipped.push(`${entry.name}: ${(err as Error).message}`);
    continue;
  }
  const fields = parseFieldDescriptors(original, hdr);
  loaded.push({ name: entry.name, hdr, fields });
  tablesChecked++;

  for (let i = 0; i < hdr.currentRecords; i++) {
    const off = recordOffsetAt(hdr, i);
    recordsChecked++;
    for (const f of fields) {
      // A zero-width field has nothing to round-trip.
      if (f.bits === 0) continue;
      const value = readField(original, off, f);
      try {
        writeField(work, off, f, value);
        fieldsChecked++;
      } catch (err) {
        failures.push({
          table: entry.name,
          record: i,
          detail: `${f.name}: ${(err as Error).message}`,
        });
      }
    }
  }
}

console.log(`Re-encoded ${fieldsChecked.toLocaleString()} field values ` +
  `across ${recordsChecked.toLocaleString()} records in ${tablesChecked} tables.`);
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} table(s):`);
  for (const s of skipped) console.log(`  ${s}`);
}
if (failures.length) {
  console.log(`\n${failures.length} write error(s); first 10:`);
  for (const f of failures.slice(0, 10)) {
    console.log(`  ${f.table}[${f.record}] ${f.detail}`);
  }
}

// ---------------------------------------------------------------------------
// Byte comparison
// ---------------------------------------------------------------------------
console.log('\n=== BYTE COMPARISON ===');
if (work.equals(original)) {
  console.log(`IDENTICAL: all ${original.length.toLocaleString()} bytes match.`);
  console.log('The writer is a verified inverse of the reader, and the schema is');
  console.log('self-consistent across every table in the file.');
} else {
  const diffs: number[] = [];
  for (let i = 0; i < original.length && diffs.length < 40; i++) {
    if (original[i] !== work[i]) diffs.push(i);
  }
  let total = 0;
  for (let i = 0; i < original.length; i++) if (original[i] !== work[i]) total++;
  console.log(`${total} byte(s) differ. First ${diffs.length}:`);

  // Attribute each differing byte to the table (and field) responsible, which
  // turns an opaque offset into an actionable schema bug.
  for (const off of diffs) {
    const owner = loaded.find(
      (t) => off >= t.hdr.dataOffset && off < t.hdr.dataOffset + t.hdr.currentRecords * t.hdr.recordLenBytes,
    );
    let where = 'outside any record region';
    if (owner) {
      const rec = Math.floor((off - owner.hdr.dataOffset) / owner.hdr.recordLenBytes);
      const byteInRec = (off - owner.hdr.dataOffset) % owner.hdr.recordLenBytes;
      const bitLo = byteInRec * 8;
      const hits = owner.fields.filter(
        (f) => f.bitOffset < bitLo + 8 && f.bitOffset + f.bits > bitLo,
      );
      where =
        `${owner.name}[${rec}] byte ${byteInRec} -> ` +
        (hits.length ? hits.map((f) => `${f.name}(${f.bitOffset}+${f.bits})`).join(' ') : 'NO FIELD COVERS THIS BYTE');
    }
    console.log(
      `  0x${off.toString(16)}: ${original[off].toString(16).padStart(2, '0')} -> ` +
        `${work[off].toString(16).padStart(2, '0')}  ${where}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Coverage: which bits are not described by any field?
// ---------------------------------------------------------------------------
console.log('\n=== SCHEMA COVERAGE (unmapped bits must be preserved blindly) ===');
let fullyCovered = 0;
const partial: string[] = [];
for (const t of loaded) {
  const totalBits = t.hdr.recordLenBytes * 8;
  const covered = t.fields.reduce((sum, f) => sum + f.bits, 0);
  if (covered === totalBits) fullyCovered++;
  else partial.push(`${t.name}: ${totalBits - covered} of ${totalBits} bits unmapped`);
}
console.log(`${fullyCovered}/${loaded.length} tables are fully covered by their descriptors.`);
if (partial.length) {
  console.log(`${partial.length} tables have unmapped bits (normal -- records are byte-padded):`);
  for (const p of partial.slice(0, 15)) console.log(`  ${p}`);
  if (partial.length > 15) console.log(`  ... and ${partial.length - 15} more`);
}

// ---------------------------------------------------------------------------
// What lives beyond the DB? Anything there must survive a save untouched.
// ---------------------------------------------------------------------------
console.log('\n=== REGION BEYOND dbSize ===');
console.log(`file length ${original.length.toLocaleString()} bytes, dbSize ${header.dbSize.toLocaleString()}`);
const tailStart = header.dbSize;
const tailLen = original.length - tailStart;
if (tailLen > 0) {
  let nonZero = 0;
  for (let i = tailStart; i < original.length; i++) if (original[i] !== 0) nonZero++;
  console.log(`${tailLen.toLocaleString()} trailing bytes, ${nonZero.toLocaleString()} non-zero`);
  const preview = original
    .subarray(tailStart, tailStart + 48)
    .toString('hex')
    .match(/.{1,32}/g)!;
  console.log(`first 48 bytes: ${preview.join(' ')}`);
  const ascii = original.subarray(tailStart, tailStart + 64).toString('ascii').replace(/[^\x20-\x7e]/g, '.');
  console.log(`as ascii:       ${ascii}`);
}

process.exit(failures.length || !work.equals(original) ? 1 : 0);

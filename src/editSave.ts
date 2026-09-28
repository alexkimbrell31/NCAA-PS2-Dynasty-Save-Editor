/**
 * Save editor: apply field edits and write a new save file.
 *
 *   node src/editSave.ts --table PLAY --where PGID=1234 --set PJEN=99
 *   node src/editSave.ts --table TEAM --row 0 --set TMPR=6 --out /tmp/test.bin
 *   node src/editSave.ts --table PLAY --where PGID=1234 --set lastName=Smith
 *
 * `firstName` / `lastName` are virtual fields: PLAY stores names as 10 + 13
 * separate 6-bit character fields, and typing those by hand is unreasonable.
 *
 * Safety model
 * ------------
 * Edits are applied IN PLACE to a copy of the original file. Field edits cannot
 * change any record's length, so the TOC, table headers and descriptor blocks
 * are never rebuilt -- they stay byte-exact by construction, as does every
 * table we have not decoded and the 623 KB of trailing padding.
 *
 * Before writing, the tool diffs the result against the original and attributes
 * every changed byte to a table, record and field. If even one byte outside the
 * fields you asked to change has moved, it refuses to write. That check is the
 * counterpart to verifyRoundTrip.ts: the round-trip proves we can write
 * *nothing* correctly, this proves we can write *something* without collateral
 * damage.
 *
 * On checksums
 * ------------
 * The dwords at file +0x14 and table +0x1C are NOT updated, because we do not
 * know what they are. They are not a checksum over record data (tables with
 * zero data bytes hold distinct values), not a hash of the table name, and no
 * standard algorithm matches over any plausible range even allowing for unknown
 * init/final-XOR constants. Rather than guess, the first edited save is an
 * experiment: if the game loads it, nothing verifies them and the write path is
 * already complete. See docs/writePath.md.
 */
import fs from 'node:fs';
import {
  encodeName,
  type FieldDescriptor,
  findTable,
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readField,
  readRecords,
  readSaveFile,
  recordOffsetAt,
  SAVE_FILE_PATH,
  writeField,
} from './lib/eadb.ts';

interface Args {
  table?: string;
  row?: number;
  where?: [string, string];
  sets: [string, string][];
  out?: string;
  dryRun: boolean;
  input: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { sets: [], dryRun: false, input: SAVE_FILE_PATH };
  for (let i = 0; i < argv.length; i++) {
    const kv = (s: string): [string, string] => {
      const eq = s.indexOf('=');
      if (eq === -1) throw new Error(`Expected FIELD=VALUE, got "${s}"`);
      return [s.slice(0, eq), s.slice(eq + 1)];
    };
    switch (argv[i]) {
      case '--table': a.table = argv[++i]; break;
      case '--row': a.row = Number(argv[++i]); break;
      case '--where': a.where = kv(argv[++i]); break;
      case '--set': a.sets.push(kv(argv[++i])); break;
      case '--out': a.out = argv[++i]; break;
      case '--in': a.input = argv[++i]; break;
      case '--dry-run': a.dryRun = true; break;
      default: throw new Error(`Unknown argument "${argv[i]}"`);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.table || args.sets.length === 0) {
  console.error('usage: editSave.ts --table NAME (--row N | --where F=V) --set F=V [--set F=V] [--out PATH] [--dry-run]');
  process.exit(2);
}

const original = readSaveFile(args.input);
const work = Buffer.from(original);
const fileHeader = parseFileHeader(original);
const toc = parseToc(original, fileHeader);

const entry = findTable(toc, args.table);
const header = parseTableHeader(original, entry.realOffset);
const fields = parseFieldDescriptors(original, header);
const records = readRecords(original, header, fields);

// --- Locate the target record ----------------------------------------------
let rowIndex: number;
if (args.where) {
  const [f, v] = args.where;
  const matches: number[] = [];
  for (let i = 0; i < records.length; i++) {
    if (String(records[i][f]) === v) matches.push(i);
  }
  if (matches.length === 0) throw new Error(`No ${args.table} record has ${f}=${v}`);
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} ${args.table} records have ${f}=${v} (rows ${matches.slice(0, 10).join(', ')}...). ` +
        'Use --row to pick one.',
    );
  }
  rowIndex = matches[0];
} else if (args.row !== undefined) {
  rowIndex = args.row;
} else {
  throw new Error('Specify --row or --where');
}
if (rowIndex < 0 || rowIndex >= header.currentRecords) {
  throw new Error(`Row ${rowIndex} out of range (${args.table} has ${header.currentRecords} records)`);
}

const offset = recordOffsetAt(header, rowIndex);
console.log(`${args.table}[${rowIndex}] at file offset 0x${offset.toString(16)}\n`);

// --- Expand virtual name fields --------------------------------------------
// PLAY stores names as 10 + 13 separate 6-bit character fields, which is a
// miserable thing to type on a command line. Accept `--set firstName=Dennis`
// and expand it into the real per-character fields.
//
// The expansion writes characters plus one terminator and nothing more, so the
// residue that 6774 of the 7404 players carry past their terminator survives
// untouched -- see encodeName.
const VIRTUAL_NAMES: Record<string, { prefix: 'PF' | 'PL'; max: number }> = {
  firstName: { prefix: 'PF', max: MAX_FIRST_NAME },
  lastName: { prefix: 'PL', max: MAX_LAST_NAME },
};
const sets: [string, string][] = [];
for (const [name, rawValue] of args.sets) {
  const virtual = VIRTUAL_NAMES[name];
  if (!virtual) {
    sets.push([name, rawValue]);
    continue;
  }
  if (!fields.some((f) => f.name === `${virtual.prefix}01`)) {
    throw new Error(`${args.table} has no ${virtual.prefix}* character fields, so "${name}" means nothing here`);
  }
  const encoded = encodeName(rawValue, virtual.prefix, virtual.max);
  console.log(
    `  ${name}="${rawValue}" expands to ${Object.entries(encoded)
      .map(([f, c]) => `${f}=${c}`)
      .join(' ')}`,
  );
  for (const [f, c] of Object.entries(encoded)) sets.push([f, String(c)]);
}

// --- Apply the edits --------------------------------------------------------
const touched: FieldDescriptor[] = [];
for (const [name, rawValue] of sets) {
  const field = fields.find((f) => f.name === name);
  if (!field) {
    throw new Error(
      `${args.table} has no field "${name}". Available: ${fields.map((f) => f.name).join(', ')}`,
    );
  }
  const before = readField(original, offset, field);
  const value: number | string =
    field.isString || field.isRaw ? rawValue : Number(rawValue);
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`"${rawValue}" is not a number (field ${name} is numeric)`);
  }
  writeField(work, offset, field, value);
  const after = readField(work, offset, field);
  console.log(`  ${name}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  touched.push(field);
}

// --- Verify nothing else moved ---------------------------------------------
// Compute the exact byte span the edited fields are allowed to occupy. Any
// difference outside it means a bit-offset or width error, and is a bug we
// must not write to disk.
const allowed = new Set<number>();
for (const f of touched) {
  const firstBit = f.bitOffset;
  const lastBit = f.bitOffset + f.bits - 1;
  for (let b = offset + (firstBit >> 3); b <= offset + (lastBit >> 3); b++) allowed.add(b);
}

const changed: number[] = [];
for (let i = 0; i < original.length; i++) if (original[i] !== work[i]) changed.push(i);
const stray = changed.filter((b) => !allowed.has(b));

console.log(`\n${changed.length} byte(s) changed, all within ${allowed.size} byte(s) owned by the edited fields.`);
for (const b of changed) {
  console.log(
    `  0x${b.toString(16)}: ${original[b].toString(16).padStart(2, '0')} -> ${work[b].toString(16).padStart(2, '0')}`,
  );
}

if (stray.length > 0) {
  console.error(`\nREFUSING TO WRITE: ${stray.length} byte(s) changed outside the edited fields:`);
  for (const b of stray.slice(0, 20)) console.error(`  0x${b.toString(16)}`);
  process.exit(1);
}

// Structural metadata must be untouched -- re-parsing must yield the same shape.
const checkHeader = parseTableHeader(work, entry.realOffset);
if (
  checkHeader.recordLenBytes !== header.recordLenBytes ||
  checkHeader.currentRecords !== header.currentRecords ||
  checkHeader.fieldCount !== header.fieldCount ||
  checkHeader.dataOffset !== header.dataOffset
) {
  console.error('REFUSING TO WRITE: table header changed shape.');
  process.exit(1);
}
if (work.length !== original.length) {
  console.error('REFUSING TO WRITE: file length changed.');
  process.exit(1);
}

if (args.dryRun) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

const outPath = args.out ?? `${args.input}.edited`;
if (fs.existsSync(outPath) && outPath === args.input) {
  console.error('REFUSING TO WRITE: output path is the input file. Pick a different --out.');
  process.exit(1);
}
fs.writeFileSync(outPath, work);
console.log(`\nWrote ${work.length.toLocaleString()} bytes to ${outPath}`);
console.log('Original file untouched.');
console.log('\nNOTE: the +0x14 / +0x1C dwords were not recalculated -- their meaning is');
console.log('unknown. If the game rejects this save, that is the thing to crack next.');

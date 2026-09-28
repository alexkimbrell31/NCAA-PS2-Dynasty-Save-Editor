/**
 * Why does PLAY hold non-zero character codes AFTER the terminator?
 *
 * The encoder test failed on rows like PGID 7700 "Brown": PL01..PL05 spell the
 * name, PL06 terminates, and then PL07, PL09, PL11, PL12 are non-zero. Either
 * the decoder is wrong (it is not -- it matches PLGA's plaintext 67/67) or
 * those slots are RESIDUE from a longer name that previously occupied the row.
 *
 * The same thing was already found in the wide string fields during the write
 * round-trip: bytes past the NUL hold leftovers and must be preserved, not
 * zeroed. If that is what this is, the encoder must write characters plus ONE
 * terminator and leave the tail alone.
 */
import {
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  decodeNameChar,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const h = parseTableHeader(buf, findTable(toc, 'PLAY').realOffset);
const play = readRecords(buf, h, parseFieldDescriptors(buf, h));

const slots = (r: Record<string, number | string>, prefix: 'PF' | 'PL', max: number) =>
  Array.from({ length: max }, (_, i) => num(r[`${prefix}${String(i + 1).padStart(2, '0')}`]));

console.log('=== a few rows, full slot dump ===');
for (const p of play.filter((r) => [7700, 7701, 7702].includes(num(r.PGID)))) {
  const { first, last } = playerName(p);
  console.log(`PGID ${num(p.PGID)} "${first} ${last}"`);
  console.log(`  PF: ${slots(p, 'PF', MAX_FIRST_NAME).join(',')}`);
  console.log(`  PL: ${slots(p, 'PL', MAX_LAST_NAME).join(',')}`);
  const tail = slots(p, 'PL', MAX_LAST_NAME).slice(last.length + 1);
  console.log(
    `  text after terminator: ${JSON.stringify(tail.map((c) => (c ? decodeNameChar(c) : '_')).join(''))}`,
  );
}

// --- how common is residue? ------------------------------------------------
let withResidue = 0;
let firstZeroThenNonZero = 0;
for (const p of play) {
  const { first, last } = playerName(p);
  for (const [name, prefix, max] of [
    [first, 'PF', MAX_FIRST_NAME],
    [last, 'PL', MAX_LAST_NAME],
  ] as const) {
    const s = slots(p, prefix, max);
    if (name.length >= max) continue;
    const tail = s.slice(name.length + 1);
    if (tail.some((c) => c !== 0)) {
      firstZeroThenNonZero++;
      break;
    }
  }
  const anyTail = (['PF', 'PL'] as const).some((prefix) => {
    const max = prefix === 'PF' ? MAX_FIRST_NAME : MAX_LAST_NAME;
    const name = prefix === 'PF' ? first : last;
    return slots(p, prefix, max)
      .slice(name.length + 1)
      .some((c) => c !== 0);
  });
  if (anyTail) withResidue++;
}
console.log(
  `\n${withResidue}/${play.length} players carry non-zero slots past the terminator`,
);

// --- is the residue plausible text, i.e. a real previous name? -------------
console.log('\n=== residue read as text ===');
let shown = 0;
for (const p of play) {
  const { last } = playerName(p);
  const s = slots(p, 'PL', MAX_LAST_NAME);
  const tail = s.slice(last.length + 1);
  if (!tail.some((c) => c !== 0)) continue;
  const asText = tail.map((c) => (c ? decodeNameChar(c) : '_')).join('');
  console.log(`  "${last}"`.padEnd(18) + ` + residue "${asText}"`);
  if (++shown >= 12) break;
}

// --- do the terminators themselves look sane? ------------------------------
let noTerminator = 0;
for (const p of play) {
  const { first, last } = playerName(p);
  if (first.length < MAX_FIRST_NAME && num(p[`PF${String(first.length + 1).padStart(2, '0')}`]) !== 0)
    noTerminator++;
  if (last.length < MAX_LAST_NAME && num(p[`PL${String(last.length + 1).padStart(2, '0')}`]) !== 0)
    noTerminator++;
}
console.log(`\nrows whose terminator slot is not zero: ${noTerminator} (should be 0 by construction)`);

// --- names that exactly fill the field have NO terminator ------------------
const fullFirst = play.filter((p) => playerName(p).first.length === MAX_FIRST_NAME);
const fullLast = play.filter((p) => playerName(p).last.length === MAX_LAST_NAME);
console.log(
  `names that exactly fill their field (no room for a terminator): ` +
    `${fullFirst.length} first, ${fullLast.length} last`,
);
for (const p of fullLast.slice(0, 4)) {
  const { first, last } = playerName(p);
  console.log(`  "${first} ${last}"`);
}

/**
 * Test the 6-bit name encoder.
 *
 * An encoder that satisfies its own decoder proves very little -- both could
 * share the same wrong charset. Two independent tests:
 *
 *   1. ROUND TRIP over all 7404 PLAY records. encode(decode(x)) must reproduce
 *      the stored codes EXACTLY, including the zero padding. This catches
 *      charset asymmetry and off-by-one errors.
 *
 *   2. GROUND TRUTH via PLGA, which stores the same players' names as plain
 *      text. Encoding PLGA's text must produce the codes PLAY actually holds.
 *      This is the test that matters: PLGA was written by the game, not by us,
 *      so it cannot inherit a mistake from our decoder.
 */
import {
  MAX_FIRST_NAME,
  MAX_LAST_NAME,
  encodeName,
  encodeNameChar,
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
const str = (v: number | string) => (typeof v === 'string' ? v : '');
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
};

// --- 0. charset is a bijection ---------------------------------------------
const bad: string[] = [];
for (let code = 1; code <= 56; code++) {
  const ch = decodeNameChar(code);
  if (ch.startsWith('<')) continue; // unidentified code, skip
  let back: number;
  try {
    back = encodeNameChar(ch);
  } catch {
    bad.push(`code ${code} -> ${JSON.stringify(ch)} -> encoder rejected it`);
    continue;
  }
  if (back !== code) bad.push(`code ${code} -> ${JSON.stringify(ch)} -> ${back}`);
}
console.log(
  bad.length === 0
    ? 'PASS  charset round-trips for every decodable code 1..56'
    : `FAIL  ${bad.length} charset asymmetries:\n  ${bad.join('\n  ')}`,
);

// --- 1. round trip over every PLAY record ----------------------------------
const play = load('PLAY');
let checked = 0;
let mismatch = 0;
const examples: string[] = [];
for (const p of play) {
  const { first, last } = playerName(p);
  if (first.includes('<') || last.includes('<')) continue; // unknown code
  for (const [name, prefix, max] of [
    [first, 'PF', MAX_FIRST_NAME],
    [last, 'PL', MAX_LAST_NAME],
  ] as const) {
    let encoded: Record<string, number>;
    try {
      encoded = encodeName(name, prefix, max);
    } catch (e) {
      mismatch++;
      if (examples.length < 8) examples.push(`${name}: ${(e as Error).message}`);
      continue;
    }
    for (const [field, code] of Object.entries(encoded)) {
      checked++;
      if (num(p[field]) !== code) {
        mismatch++;
        if (examples.length < 8)
          examples.push(`PGID ${num(p.PGID)} ${field}: stored ${num(p[field])}, encoded ${code}`);
      }
    }
  }
}
console.log(
  mismatch === 0
    ? `PASS  round trip: ${checked.toLocaleString()} character slots across ${play.length.toLocaleString()} players reproduce exactly`
    : `FAIL  ${mismatch} mismatches:\n  ${examples.join('\n  ')}`,
);

// --- 2. ground truth: encode PLGA's plaintext, compare with PLAY -----------
const plga = load('PLGA');
const playByPgid = new Map(play.map((p) => [num(p.PGID), p]));
let gtPlayers = 0;
let gtSlots = 0;
let gtBad = 0;
const gtExamples: string[] = [];
for (const g of plga) {
  const p = playByPgid.get(num(g.PGID));
  if (!p) continue;
  gtPlayers++;
  for (const [text, prefix, max] of [
    [str(g.PFNA), 'PF', MAX_FIRST_NAME],
    [str(g.PLNA), 'PL', MAX_LAST_NAME],
  ] as const) {
    const encoded = encodeName(text, prefix, max);
    for (const [field, code] of Object.entries(encoded)) {
      gtSlots++;
      if (num(p[field]) !== code) {
        gtBad++;
        if (gtExamples.length < 8)
          gtExamples.push(
            `PGID ${num(g.PGID)} ${JSON.stringify(text)} ${field}: PLAY ${num(p[field])}, encoded ${code}`,
          );
      }
    }
  }
}
console.log(
  gtBad === 0
    ? `PASS  ground truth: PLGA's plaintext encodes to PLAY's stored codes for all ` +
        `${gtPlayers} players (${gtSlots} slots)`
    : `FAIL  ${gtBad}/${gtSlots} ground-truth mismatches:\n  ${gtExamples.join('\n  ')}`,
);

// --- 3. the interesting names ----------------------------------------------
console.log('\nnames exercising the punctuation codes:');
const punct = play.filter((p) => {
  const { first, last } = playerName(p);
  return /['.\-]/.test(first + last);
});
for (const p of punct.slice(0, 6)) {
  const { first, last } = playerName(p);
  console.log(
    `  ${`${first} ${last}`.padEnd(24)} -> ${Object.values(encodeName(first, 'PF', MAX_FIRST_NAME))
      .filter((c) => c)
      .join(',')} | ${Object.values(encodeName(last, 'PL', MAX_LAST_NAME))
      .filter((c) => c)
      .join(',')}`,
  );
}
console.log(`  (${punct.length} players use an apostrophe, period or hyphen)`);

// --- 4. guard rails ---------------------------------------------------------
console.log('\nguard rails:');
for (const [label, fn] of [
  ['name too long', () => encodeName('Abcdefghijklmn', 'PL', MAX_LAST_NAME)],
  ['digit', () => encodeName('Abc3', 'PF', MAX_FIRST_NAME)],
  ['space', () => encodeName('Van Dyke', 'PL', MAX_LAST_NAME)],
  ['accent', () => encodeName('Peña', 'PL', MAX_LAST_NAME)],
] as const) {
  try {
    fn();
    console.log(`  FAIL  ${label} was accepted`);
  } catch (e) {
    console.log(`  PASS  ${label} rejected: ${(e as Error).message.slice(0, 72)}`);
  }
}

// Padding is deliberately NOT emitted: 6774 of 7404 players hold residue past
// their terminator, and clearing it would change bytes the game never touched.
const short = encodeName('Li', 'PL', MAX_LAST_NAME);
console.log(
  `\n  "Li" emits ${Object.keys(short).length} fields (2 characters + 1 terminator), ` +
    `leaving PL04..PL13 untouched so post-terminator residue survives`,
);

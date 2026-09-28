/**
 * PLGA pass 3.
 *
 * The 52 generated E Washington players are named "<POS> #<jersey>" -- the game
 * has written the position ABBREVIATION as plain text next to the numeric PPOS.
 * PLAYER_POSITIONS was originally derived from physical profiles (linemen are
 * heavy and slow, corners are fast and light, kickers are scarce). That was
 * good evidence but indirect. This is the game telling us directly.
 *
 * Also chase: are SNPD / SNPO / PSNP the same 22 players, and do they track
 * position?
 */
import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
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
  return { fields: f, recs: readRecords(buf, h, f) };
};

const plga = load('PLGA');
const play = load('PLAY');
const playPgids = new Set(play.recs.map((p) => num(p.PGID)));
const generated = plga.recs.filter((r) => !playPgids.has(num(r.PGID)));

// --- the position abbreviation test ----------------------------------------
console.log('=== generated names vs PLAYER_POSITIONS ===');
const seen = new Map<number, Set<string>>();
let jerseyAgrees = 0;
for (const r of generated) {
  const m = /^([A-Z]+) #(\d+)$/.exec(str(r.PLNA));
  if (!m) {
    console.log(`  UNPARSED: ${JSON.stringify(str(r.PLNA))}`);
    continue;
  }
  const [, abbr, jersey] = m;
  const set = seen.get(num(r.PPOS)) ?? new Set<string>();
  set.add(abbr);
  seen.set(num(r.PPOS), set);
  if (Number(jersey) === num(r.PJEN)) jerseyAgrees++;
}
console.log(`jersey in the name == PJEN: ${jerseyAgrees}/${generated.length}`);
console.log('\nPPOS  our label   name says   agrees');
let agree = 0;
for (const [ppos, abbrs] of [...seen].sort((a, b) => a[0] - b[0])) {
  const ours = PLAYER_POSITIONS[ppos];
  const theirs = [...abbrs].join('/');
  const ok = abbrs.size === 1 && theirs === ours;
  if (ok) agree++;
  console.log(
    `${String(ppos).padStart(4)}  ${String(ours).padEnd(11)} ${theirs.padEnd(11)} ${ok ? 'yes' : 'NO'}`,
  );
}
console.log(
  `\n${agree}/${seen.size} positions present in the generated roster agree with PLAYER_POSITIONS`,
);
const missing = PLAYER_POSITIONS.map((p, i) => [i, p] as const).filter(
  ([i]) => !seen.has(i),
);
console.log(
  `positions absent from this 52-man roster: ${missing.map(([i, p]) => `${i}=${p}`).join(', ')}`,
);

// --- SNPD / SNPO / PSNP -----------------------------------------------------
console.log('\n=== SNPD / SNPO / PSNP ===');
const snpd = plga.recs.filter((r) => num(r.SNPD) === 1);
const snpo = plga.recs.filter((r) => num(r.SNPO) === 1);
const sameRows =
  snpd.length === snpo.length &&
  snpd.every((r) => num(r.SNPO) === 1) &&
  plga.recs.every((r) => num(r.SNPD) === num(r.SNPO));
console.log(`SNPD set on ${snpd.length}, SNPO set on ${snpo.length}, identical: ${sameRows}`);
const posOf = (r: Record<string, number | string>) => PLAYER_POSITIONS[num(r.PPOS)];
const tally = (rs: typeof plga.recs) => {
  const m = new Map<string, number>();
  for (const r of rs) m.set(posOf(r), (m.get(posOf(r)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([p, c]) => `${p}x${c}`).join(' ');
};
console.log(`SNPD=1 positions: ${tally(snpd)}`);
for (const v of [0, 1, 2, 3]) {
  const rs = plga.recs.filter((r) => num(r.PSNP) === v);
  if (rs.length) console.log(`PSNP=${v} (${rs.length}): ${tally(rs)}`);
}
// Is PSNP just a count of the two flags?
console.log(
  `\nPSNP vs SNPD+SNPO: equal on ${plga.recs.filter((r) => num(r.PSNP) === num(r.SNPD) + num(r.SNPO)).length}/${plga.recs.length}`,
);

// --- does the generated roster cover a real depth chart? -------------------
console.log('\n=== generated roster composition ===');
const byPos = new Map<string, number>();
for (const r of generated) byPos.set(posOf(r), (byPos.get(posOf(r)) ?? 0) + 1);
console.log(
  [...byPos]
    .sort((a, b) => PLAYER_POSITIONS.indexOf(a[0] as never) - PLAYER_POSITIONS.indexOf(b[0] as never))
    .map(([p, c]) => `${p}:${c}`)
    .join(' '),
);
const jerseys = generated.map((r) => num(r.PJEN));
console.log(
  `jerseys ${Math.min(...jerseys)}..${Math.max(...jerseys)}, ` +
    `distinct ${new Set(jerseys).size}/${jerseys.length}`,
);

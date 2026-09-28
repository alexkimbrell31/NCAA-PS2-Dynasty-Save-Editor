/**
 * PLAC's six value columns are {c,s} x {C,S,V}: PAcC/PAsC, PAcS/PAsS, PAcV/PAsV.
 * Hypothesis: c = career, s = season, and C/S/V are three stat slots whose
 * meaning depends on PAty (the category).
 *
 * With only one game played, career and season should be close but a career
 * value may exceed a season one for a returning player.
 */

import {
  PLAYER_POSITIONS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (t: string) => {
  const h = parseTableHeader(buf, findTable(toc, t).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { h, f, rows: readRecords(buf, h, f) };
};

const plac = load('PLAC');
const psof = load('PSOF');
const psde = load('PSDE');
const play = load('PLAY');
const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
const offBy = new Map(psof.rows.map((r) => [n(r.PGID), r]));
const defBy = new Map(psde.rows.map((r) => [n(r.PGID), r]));

// Is career >= season?
for (const s of ['C', 'S', 'V'] as const) {
  const c = `PAc${s}`;
  const ss = `PAs${s}`;
  const rel = plac.rows.filter((r) => n(r[c]) !== 0 || n(r[ss]) !== 0);
  console.log(
    `${c} vs ${ss}: ${c}>=${ss} on ${rel.filter((r) => n(r[c]) >= n(r[ss])).length}/${rel.length}; ` +
      `${ss}>=${c} on ${rel.filter((r) => n(r[ss]) >= n(r[c])).length}/${rel.length}; ` +
      `equal on ${rel.filter((r) => n(r[c]) === n(r[ss])).length}/${rel.length}`,
  );
}

// Does either side match this week's actual stat line?
console.log('\nMatching PLAC columns against the player\'s PSOF/PSDE line, per PAty:');
const statFields = [
  ...psof.f.map((f) => f.name),
  ...psde.f.map((f) => f.name),
].filter((f) => !['PGID', 'SEYR', 'sgmp'].includes(f));

for (const ty of [...new Set(plac.rows.map((r) => n(r.PAty)))].sort((a, b) => a - b)) {
  const mine = plac.rows.filter((r) => n(r.PAty) === ty);
  console.log(`\n  PAty ${ty} (${mine.length} rows):`);
  for (const col of ['PAcC', 'PAsC', 'PAcS', 'PAsS', 'PAcV', 'PAsV']) {
    let best = '';
    let bestN = 0;
    for (const sf of statFields) {
      const src = psof.f.some((f) => f.name === sf) ? offBy : defBy;
      const rel = mine.filter((r) => src.has(n(r.PGID)));
      if (rel.length < 5) continue;
      const hit = rel.filter((r) => n(r[col]) === n(src.get(n(r.PGID))![sf])).length;
      if (hit > bestN) {
        bestN = hit;
        best = `${sf} ${hit}/${rel.length}`;
      }
    }
    if (bestN) console.log(`    ${col} best match: ${best}`);
  }
}

// PAas: what is it? Check correlation with rank ordering inside a category.
console.log('\nPAas vs the values, inside PAty 3 (passing):');
const p3 = plac.rows
  .filter((r) => n(r.PAty) === 3)
  .sort((a, b) => n(a.PAas) - n(b.PAas));
for (const r of p3.slice(0, 15)) {
  const p = byP.get(n(r.PGID))!;
  const nm = playerName(p);
  const o = offBy.get(n(r.PGID));
  console.log(
    `  PAas ${String(n(r.PAas)).padStart(2)}  ${`${nm.first} ${nm.last}`.padEnd(20)} ` +
      `cC ${String(n(r.PAcC)).padStart(4)} sC ${String(n(r.PAsC)).padStart(5)} ` +
      `cS ${String(n(r.PAcS)).padStart(4)} sS ${String(n(r.PAsS)).padStart(4)} ` +
      `cV ${String(n(r.PAcV)).padStart(4)} sV ${String(n(r.PAsV)).padStart(4)}` +
      (o ? `  | game: ${n(o.sacm)}/${n(o.saat)} ${n(o.saya)}yd ${n(o.satd)}td` : ''),
  );
}

/** AAPL, second pass: explain the 50 conference mismatches and ARET. */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (t: string) => {
  const h = parseTableHeader(buf, findTable(toc, t).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
};

const aapl = load('AAPL');
const play = load('PLAY');
const team = load('TEAM');
const conf = load('CONF');
const byP = new Map(play.map((p) => [n(p.PGID), p]));
const tc = new Map(team.map((t) => [n(t.TGID), n(t.CGID)]));
const cn = new Map(conf.map((c) => [n(c.CGID), String(c.CNAM)]));
const ownConf = (r: Record<string, number | string>) =>
  tc.get(playerTeam(n(byP.get(n(r.PGID))!.PGID)))!;

const bad = aapl.filter((r) => ownConf(r) !== n(r.CGID));
console.log(`mismatches: ${bad.length}`);
const m = new Map<string, number>();
for (const r of bad) {
  const k = `AAPL says ${n(r.CGID)}=${cn.get(n(r.CGID))}, player is in ${ownConf(r)}=${cn.get(ownConf(r))}`;
  m.set(k, (m.get(k) ?? 0) + 1);
}
for (const [k, v] of m) console.log(`  ${k}  x${v}`);

console.log(
  `\nCGIDs in AAPL: ${[...new Set(aapl.map((r) => n(r.CGID)))]
    .sort((a, b) => a - b)
    .map((c) => `${c}=${cn.get(c)}`)
    .join(', ')}`,
);
console.log(
  `\nCGIDs in CONF but NOT in AAPL: ${conf
    .map((c) => n(c.CGID))
    .filter((c) => !aapl.some((r) => n(r.CGID) === c))
    .map((c) => `${c}=${cn.get(c)}`)
    .join(', ')}`,
);

const ar = aapl.filter((r) => n(r.ARET) === 1);
console.log(
  `\nARET=1: ${ar.length} rows; confs {${[...new Set(ar.map((r) => n(r.CGID)))].sort((a, b) => a - b).join(',')}}; ` +
    `TTYP {${[...new Set(ar.map((r) => n(r.TTYP)))].join(',')}}; ` +
    `PPOS {${[...new Set(ar.map((r) => n(r.PPOS)))].join(',')}}`,
);
const byCT = new Map<string, number>();
for (const r of ar) {
  const k = `${n(r.CGID)}|${n(r.TTYP)}`;
  byCT.set(k, (byCT.get(k) ?? 0) + 1);
}
console.log(`ARET buckets (conf,tier): ${byCT.size}, counts ${[...byCT.values()].join(',')}`);
const allCT = new Set(aapl.map((r) => `${n(r.CGID)}|${n(r.TTYP)}`));
console.log(
  `(conf,tier) buckets overall: ${allCT.size}; missing an ARET: ` +
    [...allCT].filter((k) => !byCT.has(k)).join(' '),
);

console.log(
  `\nAAPL.PPOS == PLAY.PPOS: ${aapl.filter((r) => n(r.PPOS) === n(byP.get(n(r.PGID))!.PPOS)).length}/${aapl.length}`,
);
const dup = new Map<number, number>();
for (const r of aapl) dup.set(n(r.PGID), (dup.get(n(r.PGID)) ?? 0) + 1);
console.log(`players appearing more than once: ${[...dup.values()].filter((v) => v > 1).length}`);

// per (conf, tier) slot counts
const slots = new Map<string, number>();
for (const r of aapl) {
  const k = `${n(r.CGID)}|${n(r.TTYP)}`;
  slots.set(k, (slots.get(k) ?? 0) + 1);
}
console.log(`slots per (conf,tier): ${[...new Set(slots.values())].join(',')}`);

// are the two tiers disjoint in players, and is tier 0 better rated?
const t0 = aapl.filter((r) => n(r.TTYP) === 0);
const t1 = aapl.filter((r) => n(r.TTYP) === 1);
const ovr = (rs: typeof aapl) =>
  rs.reduce((a, r) => a + n(byP.get(n(r.PGID))!.POVR), 0) / rs.length;
console.log(`mean raw POVR: first team ${ovr(t0).toFixed(1)}, second team ${ovr(t1).toFixed(1)}`);

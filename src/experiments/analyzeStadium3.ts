/**
 * STAD pass 3.
 *
 *  - Pin down TEAM.TMIA now that the real capacity is known.
 *  - STDR has exactly 119 rows at 127, which is suspiciously the FBS count.
 *  - SWFP/SWRP/SWSP/SWWP look like weather probabilities. If so, snow must
 *    track latitude and be zero in domes, Florida and Hawaii -- geography is
 *    an independent oracle the save file knows nothing about.
 *  - SIOT / STHS / SGPT / SBST are single bits; domes should separate them.
 *  - SMLX/SMLY look like map coordinates.
 */

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

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
function load(name: string) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  return readRecords(buf, h, parseFieldDescriptors(buf, h));
}
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);
const s = (v: number | string) => (typeof v === 'string' ? v : '');

const stad = load('STAD');
const team = load('TEAM');
const play = load('PLAY');
const fbs = new Set(play.map((p) => playerTeam(n(p.PGID))));
const fbsTeams = team.filter((t) => fbs.has(n(t.TGID)));
const byGid = new Map(stad.map((r) => [n(r.SGID), r]));
const corr = (xs: number[], ys: number[]) => {
  const N = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / N;
  const my = ys.reduce((a, b) => a + b, 0) / N;
  let nu = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < N; i++) {
    nu += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return nu / Math.sqrt(dx * dy);
};

// --- TMIA ------------------------------------------------------------------
console.log('=== TEAM.TMIA with the real capacity known ===');
const joined = fbsTeams.map((t) => ({ t, st: byGid.get(n(t.SGID))! })).filter((j) => j.st);
let exactPct = 0;
let within1 = 0;
for (const j of joined) {
  const pct = (n(j.t.TMAA) / n(j.st.SCAP)) * 100;
  if (Math.round(pct) === n(j.t.TMIA)) exactPct++;
  if (Math.abs(pct - n(j.t.TMIA)) <= 1) within1++;
}
console.log(`  TMIA == round(TMAA / SCAP * 100): ${exactPct}/${joined.length} exact, ${within1} within 1pt`);
console.log('  samples:');
for (const j of joined.slice(0, 8)) {
  console.log(
    `    ${s(j.t.TDNA).padEnd(18)} TMAA=${String(n(j.t.TMAA)).padStart(6)} ` +
      `SCAP=${String(n(j.st.SCAP)).padStart(6)} ratio=${((n(j.t.TMAA) / n(j.st.SCAP)) * 100).toFixed(1)}% ` +
      `TMIA=${n(j.t.TMIA)}`,
  );
}

// --- STDR ------------------------------------------------------------------
console.log('\n=== STDR ===');
const dr127 = stad.filter((r) => n(r.STDR) === 127);
const usedByFbs = new Set(fbsTeams.map((t) => n(t.SGID)));
console.log(`  ${dr127.length} rows have STDR=127`);
console.log(
  `    of those, ${dr127.filter((r) => usedByFbs.has(n(r.SGID))).length} are FBS home stadiums`,
);
const drOther = stad.filter((r) => n(r.STDR) !== 127);
console.log(
  `  ${drOther.length} rows have STDR<127, of which ` +
    `${drOther.filter((r) => usedByFbs.has(n(r.SGID))).length} are FBS home stadiums`,
);
// Does STDR point at a team?
const teamByTgid = new Map(team.map((t) => [n(t.TGID), t]));
let drNameHit = 0;
for (const r of drOther) {
  const t = teamByTgid.get(n(r.STDR));
  if (t && s(t.TDNA) === s(r.TDNA)) drNameHit++;
}
console.log(`  STDR read as a TGID whose school name matches: ${drNameHit}/${drOther.length}`);

// --- weather ---------------------------------------------------------------
console.log('\n=== Weather fields ===');
for (const f of ['SWFP', 'SWRP', 'SWSP', 'SWWP']) {
  const vals = stad.map((r) => n(r[f]));
  const nz = vals.filter((v) => v > 0).length;
  console.log(
    `  ${f}: range ${Math.min(...vals)}..${Math.max(...vals)}, ` +
      `${new Set(vals).size} distinct, ${nz}/${vals.length} non-zero`,
  );
}

// Snow must be a northern phenomenon. Use the state code as a proxy.
const COLD = new Set(['ME', 'NH', 'VT', 'NY', 'MI', 'MN', 'WI', 'ND', 'SD', 'MT', 'WY', 'ID', 'IA', 'NE', 'MA', 'CT', 'RI', 'PA', 'OH', 'IN', 'IL', 'CO', 'UT', 'WV']);
const WARM = new Set(['FL', 'HI', 'LA', 'TX', 'AZ', 'CA', 'GA', 'AL', 'MS', 'SC', 'NM']);
const cold = stad.filter((r) => COLD.has(s(r.SSTA)));
const warm = stad.filter((r) => WARM.has(s(r.SSTA)));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
console.log(
  `\n  mean SWSP (snow?) in cold states: ${mean(cold.map((r) => n(r.SWSP))).toFixed(2)} ` +
    `(${cold.length} stadiums)`,
);
console.log(
  `  mean SWSP in warm states:         ${mean(warm.map((r) => n(r.SWSP))).toFixed(2)} ` +
    `(${warm.length} stadiums)`,
);
console.log(
  `  warm-state stadiums with SWSP > 0: ${warm.filter((r) => n(r.SWSP) > 0).length}/${warm.length}`,
);
console.log(`\n  Snowiest stadiums (highest SWSP):`);
for (const r of [...stad].sort((a, b) => n(b.SWSP) - n(a.SWSP)).slice(0, 10)) {
  console.log(
    `    SWSP=${String(n(r.SWSP)).padStart(2)} SWRP=${String(n(r.SWRP)).padStart(2)} ` +
      `SWWP=${String(n(r.SWWP)).padStart(2)}  ${s(r.SNAM).padEnd(30)} ${s(r.SCIT)}, ${s(r.SSTA)}`,
  );
}
console.log(`\n  Rainiest (highest SWRP):`);
for (const r of [...stad].sort((a, b) => n(b.SWRP) - n(a.SWRP)).slice(0, 8)) {
  console.log(
    `    SWRP=${String(n(r.SWRP)).padStart(2)}  ${s(r.SNAM).padEnd(30)} ${s(r.SCIT)}, ${s(r.SSTA)}`,
  );
}

// --- domes -----------------------------------------------------------------
console.log('\n=== Dome / indoor flags ===');
const DOMES = [
  'Carrier Dome',
  'Georgia Dome1',
  'Louisiana Superdome0',
  'Alamodome',
  'Ford Field',
  'Reliant Stadium0',
  'RCA Dome',
  'Metrodome',
];
for (const f of ['SIOT', 'STHS', 'SGPT', 'SBST', 'STCA', 'MPTH', 'SORI', 'SUTf', 'SFWE']) {
  const on = stad.filter((r) => n(r[f]) === 1);
  const domeOn = on.filter((r) => DOMES.some((d) => s(r.SNAM).startsWith(d.slice(0, 8)))).length;
  const domeTotal = stad.filter((r) => DOMES.some((d) => s(r.SNAM).startsWith(d.slice(0, 8)))).length;
  console.log(`  ${f}: ${on.length}/${stad.length} set; of ${domeTotal} known domes, ${domeOn} set`);
}
console.log('\n  Known dome rows:');
for (const r of stad.filter((x) => DOMES.some((d) => s(x.SNAM).startsWith(d.slice(0, 8))))) {
  console.log(
    `    ${s(r.SNAM).padEnd(24)} SIOT=${n(r.SIOT)} STHS=${n(r.STHS)} SGPT=${n(r.SGPT)} ` +
      `SBST=${n(r.SBST)} STYP=${n(r.STYP)} SWSP=${n(r.SWSP)} SWRP=${n(r.SWRP)} SFTY=${n(r.SFTY)}`,
  );
}
console.log('\n  Outdoor northern rows for contrast:');
for (const nm of ['Michigan Stadium', 'Beaver Stadium', 'Ohio Stadium']) {
  const r = stad.find((x) => s(x.SNAM) === nm);
  if (r)
    console.log(
      `    ${nm.padEnd(24)} SIOT=${n(r.SIOT)} STHS=${n(r.STHS)} SGPT=${n(r.SGPT)} ` +
        `SBST=${n(r.SBST)} STYP=${n(r.STYP)} SWSP=${n(r.SWSP)} SWRP=${n(r.SWRP)} SFTY=${n(r.SFTY)}`,
    );
}

// --- SMLX / SMLY as map coordinates ----------------------------------------
console.log('\n=== SMLX / SMLY as map coordinates ===');
// If these are screen coords on a US map, X should track longitude (west->east)
// and Y should track latitude (north->south, inverted for screen space).
const WEST = ['WA', 'OR', 'CA', 'NV', 'ID', 'AZ', 'UT'];
const EAST = ['ME', 'NH', 'MA', 'CT', 'RI', 'NY', 'NJ', 'PA', 'MD', 'DE', 'VA'];
const NORTH = ['ME', 'NH', 'VT', 'MN', 'ND', 'MT', 'WI', 'MI', 'WA'];
const SOUTH = ['FL', 'TX', 'LA', 'MS', 'AL', 'GA', 'HI'];
const pick = (codes: string[], f: string) =>
  mean(stad.filter((r) => codes.includes(s(r.SSTA))).map((r) => n(r[f])));
console.log(`  mean SMLX  west states=${pick(WEST, 'SMLX').toFixed(0)}  east states=${pick(EAST, 'SMLX').toFixed(0)}`);
console.log(`  mean SMLY north states=${pick(NORTH, 'SMLY').toFixed(0)}  south states=${pick(SOUTH, 'SMLY').toFixed(0)}`);
const hawaii = stad.filter((r) => s(r.SSTA) === 'HI');
console.log(
  `  Hawaii (far west, far south): ` +
    hawaii.map((r) => `SMLX=${n(r.SMLX)} SMLY=${n(r.SMLY)}`).join(' '),
);
// STID is a state id; stadiums in the same state should cluster tightly.
const spread: number[] = [];
for (const st of new Set(stad.map((r) => s(r.SSTA)))) {
  const rows = stad.filter((r) => s(r.SSTA) === st);
  if (rows.length < 3) continue;
  const xs = rows.map((r) => n(r.SMLX));
  spread.push(Math.max(...xs) - Math.min(...xs));
}
console.log(
  `  within-state SMLX spread: mean ${mean(spread).toFixed(0)} vs full range ` +
    `${Math.max(...stad.map((r) => n(r.SMLX))) - Math.min(...stad.map((r) => n(r.SMLX)))}`,
);

// --- remaining small fields ------------------------------------------------
console.log('\n=== Remaining fields ===');
for (const f of ['STwp', 'STts', 'STjt', 'STfw', 'STFN', 'STGN', 'SFTY', 'SFTI', 'STtv', 'STS2', 'SORD', 'SRES']) {
  const vals = stad.map((r) => n(r[f]));
  console.log(
    `  ${f}: range ${Math.min(...vals)}..${Math.max(...vals)}, ${new Set(vals).size} distinct`,
  );
}
console.log(`  corr(STwp, STfw) = ${corr(stad.map((r) => n(r.STwp)), stad.map((r) => n(r.STfw))).toFixed(3)}`);
console.log(`  STwp == STfw for ${stad.filter((r) => n(r.STwp) === n(r.STfw)).length}/${stad.length} rows`);
console.log(`  corr(STts, SCAP) = ${corr(stad.map((r) => n(r.STts)), stad.map((r) => n(r.SCAP))).toFixed(3)}`);
console.log(`  corr(STjt, SCAP) = ${corr(stad.map((r) => n(r.STjt)), stad.map((r) => n(r.SCAP))).toFixed(3)}`);
console.log('\n  SFTY (field type?) by surface-known stadiums:');
for (const nm of ['Michigan Stadium', 'Carrier Dome', 'Ohio Stadium', 'Beaver Stadium', 'Nippert Stadium']) {
  const r = stad.find((x) => s(x.SNAM) === nm);
  if (r) console.log(`    ${nm.padEnd(22)} SFTY=${n(r.SFTY)} STYP=${n(r.STYP)} STFN=${n(r.STFN)} STGN=${n(r.STGN)}`);
}

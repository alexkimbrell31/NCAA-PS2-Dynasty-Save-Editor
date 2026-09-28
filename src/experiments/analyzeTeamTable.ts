/**
 * Semantic analysis of the TEAM table.
 *
 * TEAM decodes structurally on the first attempt (112 fields, clean tiling),
 * so the work here is semantic: which field means what, and do the values
 * agree with the PLAY table we already trust?
 */

import {
  RATING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const team = load(buf, toc, 'TEAM');
  const play = load(buf, toc, 'PLAY');
  const conf = load(buf, toc, 'CONF');

  const recs = team.records;
  console.log(`TEAM: ${recs.length} records, ${team.fields.length} fields\n`);

  // --- 1. Are JJNM / TPIP really strings? -----------------------------------
  // Both are wider than 32 bits so our heuristic treats them as text, but they
  // decoded as mojibake. Check how many records look like printable ASCII.
  console.log('=== String-field sanity ===');
  for (const name of ['TDNA', 'TMNA', 'TSNA', 'JJNM', 'TPIP']) {
    const vals = recs.map((r) => str(r[name]));
    const nonEmpty = vals.filter((v) => v.length > 0);
    const printable = nonEmpty.filter((v) => /^[\x20-\x7E]+$/.test(v));
    const sample = nonEmpty.slice(0, 3).map((v) => JSON.stringify(v)).join(', ');
    console.log(
      `  ${name}: ${nonEmpty.length}/${recs.length} non-empty, ` +
        `${printable.length} fully printable ` +
        `(${((printable.length / Math.max(1, nonEmpty.length)) * 100).toFixed(0)}%)  ${sample}`,
    );
  }

  // --- 2. Team identity -----------------------------------------------------
  console.log('\n=== Identity ===');
  const tgids = recs.map((r) => num(r.TGID));
  console.log(
    `  TGID: ${new Set(tgids).size} distinct / ${recs.length} ` +
      `(min ${Math.min(...tgids)}, max ${Math.max(...tgids)}) ` +
      `${new Set(tgids).size === recs.length ? 'PRIMARY KEY' : 'NOT UNIQUE'}`,
  );
  const tgidEqToid = recs.filter((r) => num(r.TGID) === num(r.TOID)).length;
  console.log(`  TOID == TGID for ${tgidEqToid}/${recs.length} rows`);

  const alphabetical = recs.every(
    (r, i) => i === 0 || str(r.TDNA) >= str(recs[i - 1].TDNA),
  );
  console.log(`  rows sorted alphabetically by TDNA: ${alphabetical}`);

  // --- 3. Conference link ---------------------------------------------------
  console.log('\n=== Conference (CGID -> CONF) ===');
  const confName = new Map<number, string>();
  for (const c of conf.records) confName.set(num(c.CGID), str(c.CNAM));
  const badConf = recs.filter((r) => !confName.has(num(r.CGID)));
  console.log(
    `  ${recs.length - badConf.length}/${recs.length} teams resolve to a conference` +
      (badConf.length ? ` (${badConf.length} orphans)` : ''),
  );
  const byConf = new Map<string, string[]>();
  for (const r of recs) {
    const cn = confName.get(num(r.CGID)) ?? `?${num(r.CGID)}`;
    if (!byConf.has(cn)) byConf.set(cn, []);
    byConf.get(cn)!.push(str(r.TDNA));
  }
  for (const [cn, teams] of [...byConf.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)) {
    console.log(`  ${cn.padEnd(18)} ${String(teams.length).padStart(3)}  ${teams.slice(0, 4).join(', ')}...`);
  }

  // --- 4. Do team ratings track the roster? ---------------------------------
  // TROV/TROF/TRDE etc. span 0..98, i.e. they are already on the 0-99 display
  // scale rather than the 5-bit player scale. If TROV is a team overall it
  // should correlate with the mean overall of that team's players.
  console.log('\n=== Team ratings vs roster ===');
  const rosterOvr = new Map<number, number[]>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    if (!rosterOvr.has(t)) rosterOvr.set(t, []);
    rosterOvr.get(t)!.push(ratingToDisplay(num(p.POVR)));
  }
  // Top 25 players approximate the two-deep that drives a team rating.
  const rosterStrength = new Map<number, number>();
  for (const [t, list] of rosterOvr) {
    const top = [...list].sort((a, b) => b - a).slice(0, 25);
    rosterStrength.set(t, top.reduce((s, v) => s + v, 0) / top.length);
  }

  const withRoster = recs.filter((r) => rosterStrength.has(num(r.TGID)));
  const corr = (field: string) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of withRoster) {
      const v = num(r[field]);
      if (!Number.isFinite(v) || v === 0 || v === 255) continue;
      xs.push(v);
      ys.push(rosterStrength.get(num(r.TGID))!);
    }
    if (xs.length < 20) return { field, n: xs.length, r: NaN };
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    return { field, n: xs.length, r: sxy / Math.sqrt(sxx * syy) };
  };

  const candidates = ['TROV', 'TROF', 'TRDE', 'TRST', 'TRQB', 'TRRB', 'TRDB', 'TRLB', 'TRDL', 'TROL', 'TWRR', 'TPRS'];
  console.table(
    candidates
      .map(corr)
      .map((c) => ({ field: c.field, n: c.n, correlation: Number.isNaN(c.r) ? '-' : c.r.toFixed(3) }))
      .sort((a, b) => Number(b.correlation) - Number(a.correlation)),
  );

  // --- 5. FBS vs FCS separation ---------------------------------------------
  console.log('\n=== FBS vs FCS ===');
  const hasRoster = (r: (typeof recs)[number]) => rosterStrength.has(num(r.TGID));
  for (const field of ['TTYP', 'TVIS', 'TNCL', 'TSWI', 'TSLO', 'TENV']) {
    const fbs = new Map<number, number>();
    const fcs = new Map<number, number>();
    for (const r of recs) {
      const m = hasRoster(r) ? fbs : fcs;
      const v = num(r[field]);
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    const fmt = (m: Map<number, number>) =>
      [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ');
    console.log(`  ${field}  FBS[${fmt(fbs)}]  FCS[${fmt(fcs)}]`);
  }

  // --- 6. Prestige / recruiting-looking fields ------------------------------
  console.log('\n=== Top teams by candidate prestige fields ===');
  for (const field of ['TPRS', 'TCHS', 'TMAA']) {
    const top = [...recs]
      .filter(hasRoster)
      .sort((a, b) => num(b[field]) - num(a[field]))
      .slice(0, 8)
      .map((r) => `${str(r.TDNA)}(${num(r[field])})`);
    console.log(`  ${field}: ${top.join(', ')}`);
  }

  // --- 7. Stadium capacity --------------------------------------------------
  console.log('\n=== TMAA / TMIA (capacity?) ===');
  const capTop = [...recs]
    .filter(hasRoster)
    .sort((a, b) => num(b.TMAA) - num(a.TMAA))
    .slice(0, 10);
  console.table(
    capTop.map((r) => ({
      team: str(r.TDNA),
      TMAA: num(r.TMAA),
      TMIA: num(r.TMIA),
      TEZ1: num(r.TEZ1),
      TEZ2: num(r.TEZ2),
    })),
  );
}

main();

/**
 * Confirm team prestige and the remaining TEAM semantics.
 */

import {
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
  const recs = team.records;

  const byTeam = new Map<number, number[]>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(ratingToDisplay(num(p.POVR)));
  }
  const fbs = recs.filter((r) => byTeam.has(num(r.TGID)));

  // --- Prestige: TMPR vs TMAR ----------------------------------------------
  for (const field of ['TMPR', 'TMAR']) {
    console.log(`\n=== ${field} ===`);
    const groups = new Map<number, string[]>();
    for (const r of fbs) {
      const v = num(r[field]);
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(str(r.TDNA));
    }
    for (const [v, names] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      console.log(`  ${v} (${String(names.length).padStart(3)}): ${names.slice(0, 14).join(', ')}${names.length > 14 ? '...' : ''}`);
    }
  }

  // --- Rivalries ------------------------------------------------------------
  console.log('\n=== Rivalries (TMRV) ===');
  const nameByTgid = new Map(recs.map((r) => [num(r.TGID), str(r.TDNA)]));
  const famous = ['Ohio State', 'Michigan', 'Texas', 'Oklahoma', 'USC', 'Florida', 'Georgia', 'Auburn', 'Clemson', 'Notre Dame', 'Army', 'Navy', 'Oregon', 'Washington'];
  for (const n of famous) {
    const r = recs.find((x) => str(x.TDNA) === n);
    if (r) console.log(`  ${n.padEnd(14)} -> ${nameByTgid.get(num(r.TMRV)) ?? '?'}`);
  }

  // --- Conference alignment sanity -----------------------------------------
  console.log('\n=== Division (DGID) within a conference ===');
  const conf = load(buf, toc, 'CONF');
  const confName = new Map(conf.records.map((c) => [num(c.CGID), str(c.CNAM)]));
  for (const target of ['SEC', 'Big 12', 'ACC']) {
    const cg = [...confName.entries()].find(([, n]) => n === target)?.[0];
    if (cg === undefined) continue;
    const members = recs.filter((r) => num(r.CGID) === cg);
    const divs = new Map<number, string[]>();
    for (const m of members) {
      const d = num(m.DGID);
      if (!divs.has(d)) divs.set(d, []);
      divs.get(d)!.push(str(m.TDNA));
    }
    console.log(`  ${target}:`);
    for (const [d, names] of [...divs.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`    DGID ${d}: ${names.join(', ')}`);
    }
  }

  // --- Stadium --------------------------------------------------------------
  console.log('\n=== Stadium link ===');
  const stad = load(buf, toc, 'STAD');
  const stadName = stad.fields.find((f) => f.isString)!.name;
  const byId = new Map(stad.records.map((s) => [num(s.SGID), str(s[stadName])]));
  const capTop = [...fbs].sort((a, b) => num(b.TMAA) - num(a.TMAA)).slice(0, 8);
  console.table(
    capTop.map((r) => ({
      team: str(r.TDNA),
      stadium: byId.get(num(r.SGID)) ?? '?',
      capacity: num(r.TMAA),
      prestige: num(r.TMPR),
      rival: nameByTgid.get(num(r.TMRV)) ?? '?',
      teamOvr: num(r.TROV),
    })),
  );

  // --- Does TROV match a computed team overall? ----------------------------
  console.log('\n=== TROV vs roster ===');
  const sample = [...fbs]
    .sort((a, b) => num(b.TROV) - num(a.TROV))
    .slice(0, 10)
    .map((r) => {
      const list = byTeam.get(num(r.TGID))!.slice().sort((a, b) => b - a);
      return {
        team: str(r.TDNA),
        TROV: num(r.TROV),
        TROF: num(r.TROF),
        TRDE: num(r.TRDE),
        top25avg: (list.slice(0, 25).reduce((s, v) => s + v, 0) / 25).toFixed(1),
        best: list[0],
      };
    });
  console.table(sample);
}

main();

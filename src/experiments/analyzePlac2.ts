/**
 * PLAC, second pass. PAas (1..45, never zero) and PAat (0/1) are PLAC-only.
 * If PAas is the specific award and PAty the position category, the two should
 * be nested, not independent.
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

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) };
  };

  const plac = load('PLAC');
  const play = load('PLAY');
  const team = load('TEAM');
  const byPgid = new Map(play.rows.map((p) => [num(p.PGID), p]));
  const teamName = new Map(team.rows.map((t) => [num(t.TGID), String(t.TDNA)]));

  // Is PAas nested inside PAty?
  const tyOfAs = new Map<number, Set<number>>();
  const asOfTy = new Map<number, Set<number>>();
  for (const r of plac.rows) {
    const a = num(r.PAas);
    const t = num(r.PAty);
    if (!tyOfAs.has(a)) tyOfAs.set(a, new Set());
    tyOfAs.get(a)!.add(t);
    if (!asOfTy.has(t)) asOfTy.set(t, new Set());
    asOfTy.get(t)!.add(a);
  }
  const nested = [...tyOfAs.values()].every((s) => s.size === 1);
  console.log(
    `PAas -> PAty is ${nested ? 'FUNCTIONAL (each PAas has exactly one PAty)' : 'NOT functional'}`,
  );
  console.log('\nPAas breakdown:');
  for (const [a, tys] of [...tyOfAs].sort((x, y) => x[0] - y[0])) {
    const mine = plac.rows.filter((r) => num(r.PAas) === a);
    const posns = new Set(
      mine.map((r) => PLAYER_POSITIONS[num(byPgid.get(num(r.PGID))!.PPOS)] ?? '?'),
    );
    const sgnms = new Set(mine.map((r) => num(r.SGNM)));
    const players = new Set(mine.map((r) => num(r.PGID)));
    console.log(
      `  PAas ${String(a).padStart(2)}  PAty {${[...tys].join(',')}}  ` +
        `${String(mine.length).padStart(3)} rows  ${players.size} players  ` +
        `SGNM ${sgnms.size} distinct  pos {${[...posns].slice(0, 8).join(',')}}`,
    );
  }

  // SGNM: does it join to SCHD like it does in BOWL?
  const schd = load('SCHD');
  const wk0 = schd.rows.filter((g) => num(g.SEWN) === 0);
  console.log(
    `\nSGNM 0..${Math.max(...plac.rows.map((r) => num(r.SGNM)))}; ` +
      `SCHD week 0 has ${wk0.length} games with SGNM ` +
      `${Math.min(...wk0.map((g) => num(g.SGNM)))}..${Math.max(...wk0.map((g) => num(g.SGNM)))}`,
  );
  const sgnmSet = new Set(wk0.map((g) => num(g.SGNM)));
  const joins = plac.rows.filter((r) => sgnmSet.has(num(r.SGNM))).length;
  console.log(`PLAC rows whose (SEWN=0, SGNM) exists in SCHD: ${joins}/${plac.rows.length}`);

  // If it joins, is the player's team one of the two teams in that game?
  let teamOk = 0;
  let teamChecked = 0;
  const byKey = new Map(wk0.map((g) => [num(g.SGNM), g]));
  for (const r of plac.rows) {
    const g = byKey.get(num(r.SGNM));
    if (!g) continue;
    teamChecked++;
    const t = playerTeam(num(r.PGID));
    if (t === num(g.GHTG) || t === num(g.GATG)) teamOk++;
  }
  console.log(
    `player's team is one of the two in that SCHD game: ${teamOk}/${teamChecked}` +
      `  (random chance would be ~${((2 / 203) * teamChecked).toFixed(1)})`,
  );

  // PAat
  for (const v of [0, 1]) {
    const mine = plac.rows.filter((r) => num(r.PAat) === v);
    const tys = new Set(mine.map((r) => num(r.PAty)));
    const ass = new Set(mine.map((r) => num(r.PAas)));
    console.log(
      `PAat=${v}: ${mine.length} rows, PAty {${[...tys].sort((a, b) => a - b).join(',')}}, ` +
        `${ass.size} distinct PAas`,
    );
  }

  // Duplicate rows for same player+PAas: identical or progressive?
  const key = (r: Record<string, number | string>) => `${num(r.PGID)}|${num(r.PAas)}`;
  const groups = new Map<string, Array<Record<string, number | string>>>();
  for (const r of plac.rows) {
    if (!groups.has(key(r))) groups.set(key(r), []);
    groups.get(key(r))!.push(r);
  }
  const multi = [...groups.values()].filter((g) => g.length > 1);
  const identical = multi.filter((g) =>
    g.every((r) => JSON.stringify(r) === JSON.stringify(g[0])),
  );
  console.log(
    `\n${multi.length} (player,PAas) groups have >1 row; ${identical.length} are byte-identical duplicates`,
  );
  const ex = multi.find((g) => g.length > 2 && !identical.includes(g));
  if (ex) {
    const p = byPgid.get(num(ex[0].PGID))!;
    const nm = playerName(p);
    console.log(`  example ${nm.first} ${nm.last} (${PLAYER_POSITIONS[num(p.PPOS)]}) PAas ${num(ex[0].PAas)}:`);
    for (const r of ex) {
      console.log(
        `    SGNM ${String(num(r.SGNM)).padStart(3)} GQTR ${num(r.GQTR)}  ` +
          `AcC ${String(num(r.PAcC)).padStart(4)} AsC ${String(num(r.PAsC)).padStart(5)} ` +
          `AcS ${String(num(r.PAcS)).padStart(4)} AsS ${String(num(r.PAsS)).padStart(4)} ` +
          `AcV ${String(num(r.PAcV)).padStart(4)} AsV ${String(num(r.PAsV)).padStart(5)}`,
      );
    }
  }
}

main();

/**
 * PLAC. Shares an eight-field block with HEIS (PGID + PAcC PAsC PAcS PAsS PAcV
 * PAsV PAty), so whatever that block means, 490 rows will say it more clearly
 * than HEIS's ten.
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

  console.log(
    `PLAC  ${plac.h.currentRecords}/${plac.h.maxRecords} records, ` +
      `${plac.f.length} fields, ${plac.h.recordLenBytes}B each`,
  );
  const sorted = [...plac.f].sort((a, b) => a.bitOffset - b.bitOffset);
  for (const f of sorted) {
    const vals = plac.rows.map((r) => num(r[f.name]));
    console.log(
      `  ${f.name.padEnd(6)} bit ${String(f.bitOffset).padStart(4)} x${String(f.bits).padStart(3)} ` +
        `type ${f.type}  ${String(new Set(vals).size).padStart(4)} distinct  ` +
        `${Math.min(...vals)}..${Math.max(...vals)}  ` +
        `${vals.filter((v) => v === 0).length} zero`,
    );
  }

  // How many rows per player? Per PAty?
  const perPlayer = new Map<number, number>();
  for (const r of plac.rows) perPlayer.set(num(r.PGID), (perPlayer.get(num(r.PGID)) ?? 0) + 1);
  const counts = new Map<number, number>();
  for (const c of perPlayer.values()) counts.set(c, (counts.get(c) ?? 0) + 1);
  console.log(
    `\n${perPlayer.size} distinct players. rows-per-player histogram: ` +
      [...counts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x:${v}`).join(' '),
  );

  const perTy = new Map<number, number>();
  for (const r of plac.rows) perTy.set(num(r.PAty), (perTy.get(num(r.PAty)) ?? 0) + 1);
  console.log(`\nPAty histogram (${perTy.size} distinct):`);
  for (const [t, c] of [...perTy].sort((a, b) => a[0] - b[0])) {
    const sample = plac.rows.filter((r) => num(r.PAty) === t).slice(0, 5);
    const posns = new Set(
      plac.rows
        .filter((r) => num(r.PAty) === t)
        .map((r) => PLAYER_POSITIONS[num(byPgid.get(num(r.PGID))?.PPOS ?? -1)] ?? '?'),
    );
    console.log(
      `  PAty ${String(t).padStart(2)}: ${String(c).padStart(4)} rows  ` +
        `positions {${[...posns].join(',')}}`,
    );
    for (const r of sample) {
      const p = byPgid.get(num(r.PGID));
      const nm = p ? playerName(p) : { first: '?', last: String(num(r.PGID)) };
      console.log(
        `      ${`${nm.first} ${nm.last}`.padEnd(20)} ` +
          `${(p ? PLAYER_POSITIONS[num(p.PPOS)] : '?').padEnd(3)} ` +
          `AcC ${String(num(r.PAcC)).padStart(4)} AsC ${String(num(r.PAsC)).padStart(4)} ` +
          `AcS ${String(num(r.PAcS)).padStart(4)} AsS ${String(num(r.PAsS)).padStart(4)} ` +
          `AcV ${String(num(r.PAcV)).padStart(4)} AsV ${String(num(r.PAsV)).padStart(4)}  ` +
          `${(p ? teamName.get(playerTeam(num(p.PGID))) : '') ?? ''}`,
      );
    }
  }

  // Do all PGIDs resolve?
  const unresolved = plac.rows.filter((r) => !byPgid.has(num(r.PGID)));
  console.log(`\n${plac.rows.length - unresolved.length}/${plac.rows.length} PGIDs resolve in PLAY`);
}

main();

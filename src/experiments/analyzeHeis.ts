/**
 * First look at HEIS. Expected: a Heisman ballot -- ~10 rows, a player
 * reference and a descending vote/point total.
 */

import {
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

  const heis = load('HEIS');
  console.log(
    `HEIS  ${heis.h.currentRecords}/${heis.h.maxRecords} records, ` +
      `${heis.f.length} fields, ${heis.h.recordLenBytes}B each`,
  );

  const sorted = [...heis.f].sort((a, b) => a.bitOffset - b.bitOffset);
  for (const f of sorted) {
    const vals = heis.rows.map((r) => r[f.name]);
    const numeric = vals.every((v) => typeof v === 'number');
    console.log(
      `  ${f.name.padEnd(6)} bit ${String(f.bitOffset).padStart(4)} x${String(f.bits).padStart(3)} ` +
        `type ${f.type}  ${String(new Set(vals.map(String)).size).padStart(3)} distinct  ` +
        (numeric ? `${Math.min(...vals.map(num))}..${Math.max(...vals.map(num))}` : 'string'),
    );
  }

  console.log('\nAll rows:');
  const names = sorted.map((f) => f.name);
  console.log('  ' + names.map((n) => n.padEnd(10)).join(''));
  for (const r of heis.rows) {
    console.log('  ' + names.map((n) => String(r[n]).padEnd(10)).join(''));
  }

  // Try resolving every numeric field as a PLAY.PGID.
  const play = load('PLAY');
  const byPgid = new Map(play.rows.map((p) => [num(p.PGID), p]));
  const team = load('TEAM');
  const teamName = new Map(team.rows.map((t) => [num(t.TGID), String(t.TDNA)]));

  console.log('\nResolving each field as PLAY.PGID:');
  for (const f of sorted) {
    if (heis.rows.some((r) => typeof r[f.name] !== 'number')) continue;
    const hits = heis.rows.filter((r) => byPgid.has(num(r[f.name])));
    if (!hits.length) continue;
    console.log(`  ${f.name}: ${hits.length}/${heis.rows.length} resolve`);
    for (const r of hits.slice(0, 12)) {
      const p = byPgid.get(num(r[f.name]))!;
      const nm = playerName(p);
      console.log(
        `     ${String(num(r[f.name])).padStart(6)}  ${`${nm.first} ${nm.last}`.padEnd(24)} ` +
          `${String(p.PPOS).padStart(3)} ovr ${String(p.POVR).padStart(3)}  ` +
          `${teamName.get(playerTeam(num(p.PGID))) ?? '?'}`,
      );
    }
  }

  // And as a TEAM.TGID.
  console.log('\nResolving each field as TEAM.TGID:');
  for (const f of sorted) {
    if (heis.rows.some((r) => typeof r[f.name] !== 'number')) continue;
    const hits = heis.rows.filter((r) => teamName.has(num(r[f.name])));
    if (hits.length === heis.rows.length) {
      console.log(
        `  ${f.name}: 10/10 -> ${heis.rows.map((r) => teamName.get(num(r[f.name]))).join(', ')}`,
      );
    }
  }
}

main();

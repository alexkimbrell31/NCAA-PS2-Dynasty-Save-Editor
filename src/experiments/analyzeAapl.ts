/**
 * AAPL -- expected to be all-conference selections. Also re-check the three
 * unplayed week-0 games, which WQTS just revealed.
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

  const aapl = load('AAPL');
  const play = load('PLAY');
  const team = load('TEAM');
  const conf = load('CONF');
  const byPgid = new Map(play.rows.map((p) => [num(p.PGID), p]));
  const teamName = new Map(team.rows.map((t) => [num(t.TGID), String(t.TDNA)]));
  const teamConf = new Map(team.rows.map((t) => [num(t.TGID), num(t.CGID)]));
  const confName = new Map(conf.rows.map((c) => [num(c.CGID), String(c.CNAM)]));

  console.log(
    `AAPL  ${aapl.h.currentRecords}/${aapl.h.maxRecords} records, ` +
      `${aapl.f.length} fields, ${aapl.h.recordLenBytes}B each`,
  );
  const sorted = [...aapl.f].sort((a, b) => a.bitOffset - b.bitOffset);
  for (const f of sorted) {
    const vals = aapl.rows.map((r) => num(r[f.name]));
    console.log(
      `  ${f.name.padEnd(6)} bit ${String(f.bitOffset).padStart(4)} x${String(f.bits).padStart(3)} ` +
        `type ${f.type}  ${String(new Set(vals).size).padStart(4)} distinct  ` +
        `${Math.min(...vals)}..${Math.max(...vals)}  ${vals.filter((v) => v === 0).length} zero`,
    );
  }

  const pgidField = sorted.find((f) => f.name === 'PGID');
  if (pgidField) {
    const resolve = aapl.rows.filter((r) => byPgid.has(num(r.PGID))).length;
    console.log(`\nPGID resolves ${resolve}/${aapl.rows.length} in PLAY`);
  }

  // Look for a conference column and a team/tier column.
  for (const f of sorted) {
    const vals = aapl.rows.map((r) => num(r[f.name]));
    const d = new Set(vals);
    if (d.size <= 30 && d.size > 1) {
      console.log(
        `\n${f.name} histogram (${d.size} values):  ` +
          [...d]
            .sort((a, b) => a - b)
            .map((v) => `${v}:${vals.filter((x) => x === v).length}`)
            .join('  '),
      );
    }
  }

  // If there is a PGID, does each row's conference agree with a conference col?
  if (pgidField) {
    for (const f of sorted) {
      if (f.name === 'PGID') continue;
      const agree = aapl.rows.filter((r) => {
        const p = byPgid.get(num(r.PGID));
        return p && teamConf.get(playerTeam(num(p.PGID))) === num(r[f.name]);
      }).length;
      if (agree / aapl.rows.length > 0.9) {
        console.log(
          `\n${f.name} == the player's own conference on ${agree}/${aapl.rows.length}`,
        );
      }
    }

    console.log('\nFirst 15 rows:');
    for (const r of aapl.rows.slice(0, 15)) {
      const p = byPgid.get(num(r.PGID));
      const nm = p ? playerName(p) : null;
      const tg = p ? playerTeam(num(p.PGID)) : -1;
      console.log(
        `  ${(nm ? `${nm.first} ${nm.last}` : `PGID ${num(r.PGID)}`).padEnd(22)} ` +
          `${(p ? PLAYER_POSITIONS[num(p.PPOS)] : '?').padEnd(4)} ` +
          `${(teamName.get(tg) ?? '?').padEnd(16)} ` +
          `${(confName.get(teamConf.get(tg) ?? -1) ?? '?').padEnd(12)}  ` +
          sorted
            .filter((f) => f.name !== 'PGID')
            .map((f) => `${f.name}=${num(r[f.name])}`)
            .join(' '),
      );
    }
  }
}

main();

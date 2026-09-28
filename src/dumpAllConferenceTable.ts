/** Decode AAPL (all-conference / All-America selections) to CSV. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_CONF_FIRST_TEAM,
  PLAYER_POSITIONS,
  PLAYER_YEARS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (t: string) => {
    const e = findTable(toc, t);
    const h = parseTableHeader(buf, e.realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { e, h, f, rows: readRecords(buf, h, f) };
  };

  const aapl = load('AAPL');
  const play = load('PLAY');
  const team = load('TEAM');
  const conf = load('CONF');
  const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
  const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
  const cn = new Map(conf.rows.map((c) => [n(c.CGID), String(c.CNAM).trim()]));

  console.log(
    `AAPL @ 0x${aapl.e.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${aapl.h.currentRecords}/${aapl.h.maxRecords} records, ` +
      `${aapl.f.length} fields, ${aapl.h.recordLenBytes}B each`,
  );

  const sorted = [...aapl.f].sort((a, b) => a.bitOffset - b.bitOffset);
  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(
    join(root, 'analysis', 'allconference_schema.json'),
    JSON.stringify(
      {
        table: 'AAPL',
        offset: aapl.e.realOffset,
        recordLenBytes: aapl.h.recordLenBytes,
        records: aapl.h.currentRecords,
        fields: sorted.map((f) => ({
          name: f.name,
          bitOffset: f.bitOffset,
          bits: f.bits,
          type: f.type,
        })),
      },
      null,
      2,
    ),
  );

  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const derived = ['squad', 'tier', 'slot', 'player', 'position', 'year', 'overall', 'school', 'returner'];
  const raw = sorted.map((f) => f.name);
  const out: string[] = [derived.concat(raw).join(',')];

  for (const r of aapl.rows) {
    const p = byP.get(n(r.PGID))!;
    const nm = playerName(p);
    const tg = playerTeam(n(p.PGID));
    const cells: Array<string | number> = [
      cn.get(n(r.CGID)) ?? `CGID ${n(r.CGID)}`,
      n(r.TTYP) === ALL_CONF_FIRST_TEAM ? '1st team' : '2nd team',
      PLAYER_POSITIONS[n(r.PPOS)] ?? `#${n(r.PPOS)}`,
      `${nm.first} ${nm.last}`,
      PLAYER_POSITIONS[n(p.PPOS)] ?? `#${n(p.PPOS)}`,
      PLAYER_YEARS[n(p.PYER)] ?? '',
      ratingToDisplay(n(p.POVR)),
      tn.get(tg) ?? '',
      n(r.ARET) ? 'yes' : '',
    ];
    for (const name of raw) cells.push(r[name]);
    out.push(cells.map(esc).join(','));
  }

  const csv = join(root, 'out', 'AAPL.csv');
  writeFileSync(csv, out.join('\n') + '\n');
  console.log(`  wrote ${csv} (${derived.length + raw.length} columns x ${aapl.rows.length} rows)`);

  // Print one squad in full as a readability check.
  const sample = aapl.rows
    .filter((r) => n(r.CGID) === 15 && n(r.TTYP) === ALL_CONF_FIRST_TEAM)
    .sort((a, b) => n(a.PPOS) - n(b.PPOS));
  console.log('\nAll-America first team:');
  for (const r of sample) {
    const p = byP.get(n(r.PGID))!;
    const nm = playerName(p);
    console.log(
      `  ${(PLAYER_POSITIONS[n(r.PPOS)] ?? '?').padEnd(5)} ` +
        `${`${nm.first} ${nm.last}`.padEnd(22)} ` +
        `ovr ${String(ratingToDisplay(n(p.POVR))).padStart(3)}  ` +
        `${(PLAYER_YEARS[n(p.PYER)] ?? '').padEnd(10)} ` +
        `${tn.get(playerTeam(n(p.PGID))) ?? ''}`,
    );
  }
}

main();

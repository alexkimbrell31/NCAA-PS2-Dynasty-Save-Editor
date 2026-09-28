/**
 * Decode the SCHD (schedule) table to CSV.
 *
 * SCHD is the smallest interesting table in the file: 14 fields in 16 bytes.
 * Every field is resolved -- see docs/SCHDTableSchemaAndSemantics.md.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GAME_DAYS,
  NO_TEAM,
  WEEK_TYPES,
  findTable,
  gameWinner,
  kickoffTime,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
  teamName,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const entry = findTable(toc, 'SCHD');
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  const games = readRecords(buf, header, fields);

  console.log(
    `SCHD @ 0x${entry.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${header.currentRecords}/${header.maxRecords} records, ` +
      `${fields.length} fields, ${header.recordLenBytes}B each`,
  );

  // Guard the assumption every later script depends on.
  const sorted = [...fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(
        `SCHD field ${f.name} starts at bit ${f.bitOffset}, expected ${cursor}`,
      );
    }
    cursor += f.bits;
  }
  const capacity = header.recordLenBytes * 8;
  console.log(`  bits 0..${cursor - 1} tile cleanly (${capacity - cursor} bits padding)`);

  const teamRecs = (() => {
    const h = parseTableHeader(buf, findTable(toc, 'TEAM').realOffset);
    return readRecords(buf, h, parseFieldDescriptors(buf, h));
  })();
  const byTgid = new Map(teamRecs.map((t) => [num(t.TGID), t]));
  const nameOf = (id: number) => {
    if (id === NO_TEAM) return 'TBD';
    const t = byTgid.get(id);
    return t ? teamName(t) : `unknown(${id})`;
  };

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });

  const schemaPath = join(root, 'analysis', 'schedule_schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'SCHD',
        offset: entry.realOffset,
        recordLenBytes: header.recordLenBytes,
        records: header.currentRecords,
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
  console.log(`  wrote ${schemaPath}`);

  // Derived columns first, then the raw fields.
  const derived = [
    'week',
    'weekType',
    'day',
    'kickoff',
    'awayTeam',
    'homeTeam',
    'result',
    'winner',
    'conferenceGame',
    'userGame',
  ];
  const rawNames = sorted.map((f) => f.name);
  const rows: string[] = [derived.concat(rawNames).join(',')];

  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  for (const g of games) {
    const week = num(g.SEWN);
    const played = num(g.GSTA) !== 0;
    const win = gameWinner(g);
    const cells: Array<string | number> = [
      week,
      WEEK_TYPES[num(g.SEWT)] ?? 'Regular Season',
      GAME_DAYS[num(g.GDAT)] ?? `?${num(g.GDAT)}`,
      kickoffTime(num(g.GTOD)),
      nameOf(num(g.GATG)),
      nameOf(num(g.GHTG)),
      played ? `${num(g.GASC)}-${num(g.GHSC)}` : '',
      win === 'away' ? nameOf(num(g.GATG)) : win === 'home' ? nameOf(num(g.GHTG)) : '',
      num(g.GMFX) === 1 ? 'yes' : 'no',
      num(g.GFFU) === 1 || num(g.GFHU) === 1 ? 'yes' : 'no',
    ];
    for (const name of rawNames) cells.push(g[name]);
    rows.push(cells.map(esc).join(','));
  }

  const csvPath = join(root, 'out', 'SCHD.csv');
  writeFileSync(csvPath, rows.join('\n') + '\n');
  console.log(`  wrote ${csvPath} (${derived.length + rawNames.length} columns x ${games.length} rows)`);

  const completed = games.filter((g) => num(g.GSTA) !== 0).length;
  const tbd = games.filter((g) => num(g.GATG) === NO_TEAM).length;
  console.log(
    `\n  ${games.length - tbd} scheduled games, ${tbd} postseason slots still TBD, ` +
      `${completed} played`,
  );

  // Spot check: print the user's season, whoever that is.
  const userGames = games.filter((g) => num(g.GFFU) === 1 || num(g.GFHU) === 1);
  if (userGames.length) {
    const tally = new Map<number, number>();
    for (const g of userGames) {
      for (const id of [num(g.GATG), num(g.GHTG)]) {
        tally.set(id, (tally.get(id) ?? 0) + 1);
      }
    }
    const [userId] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(`\nUser team: ${nameOf(userId)}`);
    for (const g of userGames.sort((a, b) => num(a.SEWN) - num(b.SEWN))) {
      const home = num(g.GHTG) === userId;
      const opp = home ? num(g.GATG) : num(g.GHTG);
      const win = gameWinner(g);
      const res =
        win === null
          ? ''
          : (win === 'home') === home
            ? `  W ${Math.max(num(g.GASC), num(g.GHSC))}-${Math.min(num(g.GASC), num(g.GHSC))}`
            : `  L ${Math.min(num(g.GASC), num(g.GHSC))}-${Math.max(num(g.GASC), num(g.GHSC))}`;
      console.log(
        `  wk${String(num(g.SEWN)).padStart(2)} ${GAME_DAYS[num(g.GDAT)].slice(0, 3)} ` +
          `${kickoffTime(num(g.GTOD)).padStart(7)}  ${home ? 'vs' : '@ '} ${nameOf(opp).padEnd(28)}` +
          `${num(g.GMFX) === 1 ? 'conf' : '    '}${res}`,
      );
    }
  }
}

main();

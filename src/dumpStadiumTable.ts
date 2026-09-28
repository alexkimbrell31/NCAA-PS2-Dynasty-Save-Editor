/**
 * Decode the STAD (stadium) table to CSV.
 *
 * STAD is the richest reference table in the file: five string columns plus
 * capacity, geography, weather and surface data. It holds the real stadium
 * capacity (SCAP), which is what revealed that TEAM.TMAA is average attendance
 * rather than capacity.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  STADIUM_NO_DETAIL,
  SURFACE_GRASS,
  SURFACE_TURF,
  findTable,
  isIndoorStadium,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const entry = findTable(toc, 'STAD');
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  const stadiums = readRecords(buf, header, fields);

  console.log(
    `STAD @ 0x${entry.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${header.currentRecords}/${header.maxRecords} records, ` +
      `${fields.length} fields, ${header.recordLenBytes}B each`,
  );

  const sorted = [...fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`STAD field ${f.name} starts at bit ${f.bitOffset}, expected ${cursor}`);
    }
    cursor += f.bits;
  }
  console.log(
    `  bits 0..${cursor - 1} tile cleanly (${header.recordLenBytes * 8 - cursor} bits padding)`,
  );

  // Link each stadium back to its home team, if it has one.
  const teamHeader = parseTableHeader(buf, findTable(toc, 'TEAM').realOffset);
  const teams = readRecords(buf, teamHeader, parseFieldDescriptors(buf, teamHeader));
  const playHeader = parseTableHeader(buf, findTable(toc, 'PLAY').realOffset);
  const players = readRecords(buf, playHeader, parseFieldDescriptors(buf, playHeader));
  const fbs = new Set(players.map((p) => playerTeam(num(p.PGID))));
  const homeTeam = new Map<number, Record<string, number | string>>();
  for (const t of teams) if (!homeTeam.has(num(t.SGID))) homeTeam.set(num(t.SGID), t);

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });

  const schemaPath = join(root, 'analysis', 'stadium_schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'STAD',
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

  const derived = ['stadium', 'nickname', 'school', 'city', 'state', 'capacity', 'homeTeamTier', 'roof', 'surface'];
  const rawNames = sorted.map((f) => f.name);
  const rows: string[] = [derived.concat(rawNames).join(',')];
  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  for (const r of stadiums) {
    const team = homeTeam.get(num(r.SGID));
    const tier = !team ? 'neutral' : fbs.has(num(team.TGID)) ? 'FBS' : 'FCS';
    const surface =
      num(r.SFTY) === SURFACE_GRASS
        ? 'grass'
        : num(r.SFTY) === SURFACE_TURF
          ? 'turf'
          : `variant ${num(r.SFTY)}`;
    const cells: Array<string | number> = [
      str(r.SNAM),
      str(r.STNN),
      str(r.TDNA),
      str(r.SCIT),
      str(r.SSTA),
      num(r.SCAP),
      tier,
      isIndoorStadium(r) ? 'indoor' : 'outdoor',
      surface,
    ];
    for (const name of rawNames) cells.push(r[name]);
    rows.push(cells.map(esc).join(','));
  }

  const csvPath = join(root, 'out', 'STAD.csv');
  writeFileSync(csvPath, rows.join('\n') + '\n');
  console.log(
    `  wrote ${csvPath} (${derived.length + rawNames.length} columns x ${stadiums.length} rows)`,
  );

  const indoor = stadiums.filter(isIndoorStadium).length;
  const neutral = stadiums.filter((r) => !homeTeam.has(num(r.SGID))).length;
  console.log(
    `\n  ${stadiums.length - neutral} home grounds, ${neutral} neutral / bowl sites, ` +
      `${indoor} domes, ${stadiums.filter((r) => num(r.STDR) !== STADIUM_NO_DETAIL).length} with a detail id`,
  );

  console.log('\nLargest stadiums:');
  for (const r of [...stadiums].sort((a, b) => num(b.SCAP) - num(a.SCAP)).slice(0, 8)) {
    console.log(
      `  ${String(num(r.SCAP)).padStart(7)}  ${str(r.SNAM).padEnd(30)} ` +
        `${str(r.SCIT)}, ${str(r.SSTA)}`,
    );
  }

  console.log('\nHarshest weather (by snow chance):');
  for (const r of [...stadiums].sort((a, b) => num(b.SWSP) - num(a.SWSP)).slice(0, 5)) {
    console.log(
      `  snow ${String(num(r.SWSP)).padStart(2)}%  rain ${String(num(r.SWRP)).padStart(2)}%  ` +
        `wind ${String(num(r.SWWP)).padStart(2)}%  ${str(r.SNAM).padEnd(30)} ${str(r.SCIT)}, ${str(r.SSTA)}`,
    );
  }

  const uw = stadiums.find((r) => str(r.TDNA) === 'Washington');
  if (uw) {
    console.log(
      `\nUser's home field: ${str(uw.SNAM)}, ${str(uw.SCIT)} ${str(uw.SSTA)} — ` +
        `capacity ${num(uw.SCAP).toLocaleString()}, ` +
        `${isIndoorStadium(uw) ? 'indoor' : 'outdoor'}, ` +
        `rain ${num(uw.SWRP)}% snow ${num(uw.SWSP)}% wind ${num(uw.SWWP)}%`,
    );
  }
}

main();

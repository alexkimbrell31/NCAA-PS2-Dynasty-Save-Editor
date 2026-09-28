/**
 * Decode the PLGA table to CSV.
 *
 * PLGA is the roster cache for the next game on the schedule. It matters out of
 * proportion to its size for two reasons:
 *
 *   - It stores names as PLAIN TEXT, while PLAY packs them into 23 separate
 *     6-bit character fields. That gives a known-plaintext corpus for the name
 *     encoder.
 *   - It carries the appearance and equipment data PLAY does not have, and it
 *     contains generated FCS players who exist nowhere else in the file.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PLAYER_POSITIONS,
  PLAYER_WEIGHT_OFFSET,
  PLAYER_YEARS,
  RATING_FIELDS,
  findTable,
  isGeneratedPlayer,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerHeight,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
  teamName,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (name: string) => {
    const entry = findTable(toc, name);
    const header = parseTableHeader(buf, entry.realOffset);
    const fields = parseFieldDescriptors(buf, header);
    return { entry, header, fields, records: readRecords(buf, header, fields) };
  };

  const plga = load('PLGA');
  const team = load('TEAM');
  const play = load('PLAY');

  console.log(
    `PLGA @ 0x${plga.entry.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${plga.header.currentRecords}/${plga.header.maxRecords} records, ` +
      `${plga.fields.length} fields, ${plga.header.recordLenBytes}B each`,
  );

  const sorted = [...plga.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`PLGA field ${f.name} starts at bit ${f.bitOffset}, expected ${cursor}`);
    }
    cursor += f.bits;
  }
  console.log(
    `  bits 0..${cursor - 1} tile cleanly ` +
      `(${plga.header.recordLenBytes * 8 - cursor} bits padding)`,
  );

  const teamByTgid = new Map(team.records.map((t) => [num(t.TGID), t]));
  const playPgids = new Set(play.records.map((p) => num(p.PGID)));

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });

  const schemaPath = join(root, 'analysis', 'plga_schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'PLGA',
        offset: plga.entry.realOffset,
        recordLenBytes: plga.header.recordLenBytes,
        records: plga.header.currentRecords,
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

  const derived = [
    'name', 'team', 'origin', 'position', 'year', 'jersey',
    'height', 'weight', 'inPlay', 'lineupSNPD', 'lineupSNPO',
  ];
  const ratingCols = RATING_FIELDS.filter((f) =>
    plga.fields.some((x) => x.name === f),
  ).map((f) => `${f}_display`);
  const rawNames = sorted.map((f) => f.name);
  const rows: string[] = [derived.concat(ratingCols, rawNames).join(',')];
  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  for (const r of plga.records) {
    const tgid = playerTeam(num(r.PGID));
    const t = teamByTgid.get(tgid);
    const generated = isGeneratedPlayer(r);
    const cells: Array<string | number> = [
      generated ? str(r.PLNA) : `${str(r.PFNA)} ${str(r.PLNA)}`,
      t ? teamName(t) : `TGID ${tgid}`,
      generated ? 'generated' : 'roster',
      PLAYER_POSITIONS[num(r.PPOS)] ?? num(r.PPOS),
      PLAYER_YEARS[num(r.PYER)] ?? num(r.PYER),
      num(r.PJEN),
      playerHeight(r),
      num(r.PWGT) + PLAYER_WEIGHT_OFFSET,
      playPgids.has(num(r.PGID)) ? 'yes' : 'no',
      num(r.SNPD),
      num(r.SNPO),
    ];
    for (const f of RATING_FIELDS) {
      if (!plga.fields.some((x) => x.name === f)) continue;
      cells.push(ratingToDisplay(num(r[f])));
    }
    for (const name of rawNames) cells.push(r[name]);
    rows.push(cells.map(esc).join(','));
  }

  const csvPath = join(root, 'out', 'PLGA.csv');
  writeFileSync(csvPath, rows.join('\n') + '\n');
  console.log(
    `  wrote ${csvPath} (${derived.length + ratingCols.length + rawNames.length} columns x ${plga.records.length} rows)`,
  );

  const generated = plga.records.filter(isGeneratedPlayer);
  const squads = new Map<number, number>();
  for (const r of plga.records) {
    const t = playerTeam(num(r.PGID));
    squads.set(t, (squads.get(t) ?? 0) + 1);
  }
  console.log(`\n  the matchup:`);
  for (const [tgid, count] of [...squads].sort((a, b) => b[1] - a[1])) {
    const t = teamByTgid.get(tgid);
    const gen = plga.records.filter(
      (r) => playerTeam(num(r.PGID)) === tgid && isGeneratedPlayer(r),
    ).length;
    console.log(
      `    ${String(t ? teamName(t) : tgid).padEnd(26)} ${String(count).padStart(3)} players` +
        `${gen ? ` (all ${gen} generated on the fly, no PLAY rows)` : ''}`,
    );
  }
  console.log(
    `  ${plga.records.length - generated.length} real players, ${generated.length} generated`,
  );

  for (const flag of ['SNPD', 'SNPO'] as const) {
    const lineup = plga.records.filter((r) => num(r[flag]) === 1);
    const byTeam = new Map<number, string[]>();
    for (const r of lineup) {
      const t = playerTeam(num(r.PGID));
      const list = byTeam.get(t) ?? [];
      list.push(PLAYER_POSITIONS[num(r.PPOS)] ?? String(num(r.PPOS)));
      byTeam.set(t, list);
    }
    console.log(`\n  ${flag} lineup (${lineup.length} players):`);
    for (const [tgid, positions] of [...byTeam].sort((a, b) => a[0] - b[0])) {
      const t = teamByTgid.get(tgid);
      const counts = new Map<string, number>();
      for (const p of positions) counts.set(p, (counts.get(p) ?? 0) + 1);
      console.log(
        `    ${String(t ? teamName(t) : tgid).padEnd(26)} ` +
          [...counts]
            .sort(
              (a, b) =>
                PLAYER_POSITIONS.indexOf(a[0] as never) -
                PLAYER_POSITIONS.indexOf(b[0] as never),
            )
            .map(([p, c]) => `${p}${c > 1 ? `x${c}` : ''}`)
            .join(' '),
      );
    }
  }
}

main();

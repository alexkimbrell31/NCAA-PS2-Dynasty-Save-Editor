/**
 * Decode the BOWL (postseason) table to CSV.
 *
 * BOWL is the table that finishes the postseason picture SCHD had to leave
 * open. SCHD carries 34 slots whose participants are all `NO_TEAM`; BOWL holds
 * exactly those 34, joined on (`SEWN`, `SGNM`), and gives each one a name, a
 * venue, a date and the two conference tie-ins that will fill it.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BOWL_RANK_AT_LARGE,
  BOWL_VENUE_TBD,
  CONFERENCE_GENERIC,
  findTable,
  isConferenceChampionship,
  kickoffTime,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
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
  const load = (name: string) => {
    const entry = findTable(toc, name);
    const header = parseTableHeader(buf, entry.realOffset);
    const fields = parseFieldDescriptors(buf, header);
    return { entry, header, fields, records: readRecords(buf, header, fields) };
  };

  const bowl = load('BOWL');
  const stad = load('STAD');
  const conf = load('CONF');
  const schd = load('SCHD');

  console.log(
    `BOWL @ 0x${bowl.entry.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${bowl.header.currentRecords}/${bowl.header.maxRecords} records, ` +
      `${bowl.fields.length} fields, ${bowl.header.recordLenBytes}B each`,
  );

  const sorted = [...bowl.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`BOWL field ${f.name} starts at bit ${f.bitOffset}, expected ${cursor}`);
    }
    cursor += f.bits;
  }
  console.log(
    `  bits 0..${cursor - 1} tile cleanly ` +
      `(${bowl.header.recordLenBytes * 8 - cursor} bits padding)`,
  );

  const stadByGid = new Map(stad.records.map((s) => [num(s.SGID), s]));
  const confByGid = new Map(conf.records.map((c) => [num(c.CGID), c]));
  const slotByKey = new Map(
    schd.records.map((g) => [`${num(g.SEWN)}:${num(g.SGNM)}`, g]),
  );

  const tieIn = (cgid: number, rank: number) => {
    if (cgid === CONFERENCE_GENERIC && rank === BOWL_RANK_AT_LARGE) return 'at-large';
    const c = confByGid.get(cgid);
    return `${c ? str(c.CNAM).trim() : `CGID ${cgid}`} #${rank}`;
  };

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });

  const schemaPath = join(root, 'analysis', 'bowl_schema.json');
  writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'BOWL',
        offset: bowl.entry.realOffset,
        recordLenBytes: bowl.header.recordLenBytes,
        records: bowl.header.currentRecords,
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
    'bowl', 'kind', 'date', 'kickoff', 'venue', 'city', 'state',
    'tieIn1', 'tieIn2', 'scheduleWeek', 'scheduleSlot',
  ];
  const rawNames = sorted.map((f) => f.name);
  const rows: string[] = [derived.concat(rawNames).join(',')];
  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  for (const r of bowl.records) {
    const venue = stadByGid.get(num(r.SGID));
    const slot = slotByKey.get(`${num(r.SEWN)}:${num(r.SGNM)}`);
    const cells: Array<string | number> = [
      str(r.BNME),
      isConferenceChampionship(r) ? 'conference championship' : 'bowl',
      `${num(r.BMON)}/${num(r.BDAY)}`,
      kickoffTime(num(r.GTOD)),
      num(r.SGID) === BOWL_VENUE_TBD ? 'TBD' : venue ? str(venue.SNAM) : `SGID ${num(r.SGID)}`,
      venue ? str(venue.SCIT) : '',
      venue ? str(venue.SSTA) : '',
      tieIn(num(r.BCI1), num(r.BCR1)),
      tieIn(num(r.BCI2), num(r.BCR2)),
      num(r.SEWN),
      slot ? num(r.SGNM) : -1,
    ];
    for (const name of rawNames) cells.push(r[name]);
    rows.push(cells.map(esc).join(','));
  }

  const csvPath = join(root, 'out', 'BOWL.csv');
  writeFileSync(csvPath, rows.join('\n') + '\n');
  console.log(
    `  wrote ${csvPath} (${derived.length + rawNames.length} columns x ${bowl.records.length} rows)`,
  );

  const champs = bowl.records.filter(isConferenceChampionship);
  const tbd = bowl.records.filter((r) => num(r.SGID) === BOWL_VENUE_TBD);
  console.log(
    `\n  ${bowl.records.length} slots: ${champs.length} conference championships, ` +
      `${bowl.records.length - champs.length} bowls; ${tbd.length} with the venue still TBD`,
  );

  console.log('\nSlots with an at-large berth:');
  for (const r of bowl.records) {
    if (num(r.BCI1) !== CONFERENCE_GENERIC && num(r.BCI2) !== CONFERENCE_GENERIC) continue;
    const venue = stadByGid.get(num(r.SGID));
    console.log(
      `  ${str(r.BNME).padEnd(24)} ${(venue ? str(venue.SCIT) : 'TBD').padEnd(16)} ` +
        `${tieIn(num(r.BCI1), num(r.BCR1))} v ${tieIn(num(r.BCI2), num(r.BCR2))}`,
    );
  }

  console.log('\nConference championship games:');
  for (const r of champs) {
    const venue = stadByGid.get(num(r.SGID));
    console.log(
      `  ${str(r.BNME).padEnd(24)} ${num(r.BMON)}/${num(r.BDAY)} ` +
        `${(venue ? `${str(venue.SNAM)}, ${str(venue.SCIT)}` : 'venue TBD').padEnd(34)}`,
    );
  }
}

main();

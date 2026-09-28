/**
 * Decode the DIVI (conference division) table to CSV.
 *
 * DIVI is the smallest table in the file — 10 rows, 3 fields — but it is worth
 * dumping because `DNAM` is plain text and therefore self-labelling, which
 * makes it the one table that can validate a foreign key in another table
 * (`TEAM.DGID`) without any outside knowledge at all.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DIVISION_NONE,
  findTable,
  hasDivision,
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

  const load = (tag: string) => {
    const entry = findTable(toc, tag);
    const header = parseTableHeader(buf, entry.realOffset);
    const fields = parseFieldDescriptors(buf, header);
    return { entry, header, fields, rows: readRecords(buf, header, fields) };
  };

  const divi = load('DIVI');
  const conf = load('CONF');
  const team = load('TEAM');

  console.log(
    `DIVI @ 0x${divi.entry.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${divi.header.currentRecords}/${divi.header.maxRecords} records, ` +
      `${divi.fields.length} fields, ${divi.header.recordLenBytes}B each`,
  );

  const sorted = [...divi.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`DIVI field ${f.name} starts at bit ${f.bitOffset}, expected ${cursor}`);
    }
    cursor += f.bits;
  }
  console.log(
    `  bits 0..${cursor - 1} tile cleanly ` +
      `(${divi.header.recordLenBytes * 8 - cursor} bits padding)`,
  );

  const confName = new Map<number, string>();
  for (const c of conf.rows) confName.set(num(c.CGID), str(c.CNAM));

  const members = new Map<number, string[]>();
  for (const t of team.rows) {
    const d = num(t.DGID);
    if (!members.has(d)) members.set(d, []);
    members.get(d)!.push(str(t.TDNA) || String(num(t.TGID)));
  }
  for (const list of members.values()) list.sort();

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });

  writeFileSync(
    join(root, 'analysis', 'division_schema.json'),
    JSON.stringify(
      {
        table: 'DIVI',
        offset: divi.entry.realOffset,
        recordLenBytes: divi.header.recordLenBytes,
        records: divi.header.currentRecords,
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
  const derived = ['division', 'conference', 'teamCount', 'members'];
  const rawNames = sorted.map((f) => f.name);
  const rows: string[] = [derived.concat(rawNames).join(',')];

  for (const r of divi.rows) {
    const mine = members.get(num(r.DGID)) ?? [];
    const cells: Array<string | number> = [
      str(r.DNAM),
      confName.get(num(r.CGID)) ?? `CGID ${num(r.CGID)}`,
      mine.length,
      mine.join('; '),
    ];
    for (const name of rawNames) cells.push(r[name]);
    rows.push(cells.map(esc).join(','));
  }

  const csvPath = join(root, 'out', 'DIVI.csv');
  writeFileSync(csvPath, rows.join('\n') + '\n');
  console.log(
    `  wrote ${csvPath} (${derived.length + rawNames.length} columns x ${divi.rows.length} rows)`,
  );

  console.log('\nDivisions:');
  for (const r of [...divi.rows].sort((a, b) => num(a.DGID) - num(b.DGID))) {
    const mine = members.get(num(r.DGID)) ?? [];
    console.log(
      `  ${String(num(r.DGID)).padStart(2)}  ${str(r.DNAM).padEnd(16)} ` +
        `${(confName.get(num(r.CGID)) ?? '?').padEnd(14)} ` +
        `${String(mine.length).padStart(2)} teams  ${mine.join(', ')}`,
    );
  }

  const undivided = team.rows.filter((t) => !hasDivision(t));
  const undividedConfs = new Set(undivided.map((t) => num(t.CGID)));
  console.log(
    `\n${team.rows.length - undivided.length} teams sit in a division; ` +
      `${undivided.length} carry DGID ${DIVISION_NONE} across ` +
      `${undividedConfs.size} conferences ` +
      `(${[...undividedConfs]
        .sort((a, b) => a - b)
        .map((c) => confName.get(c) ?? `#${c}`)
        .join(', ')})`,
  );
}

main();

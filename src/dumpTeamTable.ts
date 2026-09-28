/**
 * Dump the TEAM table.
 *
 * Emits a schema artifact plus a CSV with resolved conference, division,
 * stadium and rival names alongside the raw field values.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findTable,
  hex,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
  teamName,
} from './lib/eadb.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'out');
const schemaPath = path.join(here, '..', 'analysis', 'team_schema.json');
const csvPath = path.join(outDir, 'TEAM.csv');

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const entry = findTable(toc, name);
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  return { entry, header, fields, records: readRecords(buf, header, fields) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const team = load(buf, toc, 'TEAM');
  const conf = load(buf, toc, 'CONF');
  const stad = load(buf, toc, 'STAD');

  console.log(`TEAM @ ${hex(team.entry.realOffset)}`);
  console.log(
    `  ${team.records.length}/${team.header.maxRecords} records, ` +
      `${team.fields.length} fields, ${team.header.recordLenBytes}B each`,
  );

  // Assert the descriptor block tiles the record cleanly.
  const sorted = [...team.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`TEAM bit gap at ${cursor}: ${f.name} starts at ${f.bitOffset}`);
    }
    cursor += f.bits;
  }
  const capacity = team.header.recordLenBytes * 8;
  console.log(`  bits 0..${cursor - 1} tile cleanly (${capacity - cursor} bits padding)`);

  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'TEAM',
        offset: team.entry.realOffset,
        recordLenBytes: team.header.recordLenBytes,
        records: team.records.length,
        fields: sorted.map((f) => ({
          name: f.name,
          bitOffset: f.bitOffset,
          bits: f.bits,
          type: f.type,
          isString: f.isString,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`  wrote ${schemaPath}`);

  // --- Lookups --------------------------------------------------------------
  const confName = new Map(conf.records.map((c) => [num(c.CGID), str(c.CNAM)]));
  const stadNameField = stad.fields.find((f) => f.isString)!.name;
  const stadName = new Map(stad.records.map((s) => [num(s.SGID), str(s[stadNameField])]));
  const tgidName = new Map(team.records.map((r) => [num(r.TGID), teamName(r)]));

  const names = team.fields.map((f) => f.name);
  const header = ['name', 'conference', 'stadium', 'rival', ...names];
  const lines = [header.join(',')];

  for (const r of team.records) {
    const cells = [
      teamName(r),
      confName.get(num(r.CGID)) ?? '',
      stadName.get(num(r.SGID)) ?? '',
      tgidName.get(num(r.TMRV)) ?? '',
      ...names.map((k) => r[k]),
    ];
    // Quote anything containing a comma so the CSV stays parseable.
    lines.push(cells.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(','));
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  console.log(`  wrote ${csvPath} (${header.length} columns x ${team.records.length} rows)`);

  console.log('\nSpot check:');
  for (const n of ['Michigan', 'Ohio State', 'Texas']) {
    const r = team.records.find((x) => str(x.TDNA) === n);
    if (!r) continue;
    console.log(
      `  ${teamName(r).padEnd(26)} ${(confName.get(num(r.CGID)) ?? '?').padEnd(10)} ` +
        `prestige ${num(r.TMPR)} academics ${num(r.TMAR)} ` +
        `ovr ${num(r.TROV)} cap ${num(r.TMAA).toLocaleString()} ` +
        `rival ${tgidName.get(num(r.TMRV)) ?? '?'}`,
    );
  }
}

main();

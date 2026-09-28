/**
 * Dump the COCH table.
 *
 * Emits a schema artifact plus a CSV with the coach's team resolved. Note that
 * most saves ship with generic placeholder coach names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NO_TEAM,
  coachName,
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
const schemaPath = path.join(here, '..', 'analysis', 'coach_schema.json');
const csvPath = path.join(outDir, 'COCH.csv');

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const entry = findTable(toc, name);
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);
  return { entry, header, fields, records: readRecords(buf, header, fields) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));

  const coch = load(buf, toc, 'COCH');
  const team = load(buf, toc, 'TEAM');

  console.log(`COCH @ ${hex(coch.entry.realOffset)}`);
  console.log(
    `  ${coch.records.length}/${coch.header.maxRecords} records, ` +
      `${coch.fields.length} fields, ${coch.header.recordLenBytes}B each`,
  );

  const sorted = [...coch.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) {
      throw new Error(`COCH bit gap at ${cursor}: ${f.name} starts at ${f.bitOffset}`);
    }
    cursor += f.bits;
  }
  const capacity = coch.header.recordLenBytes * 8;
  console.log(`  bits 0..${cursor - 1} tile cleanly (${capacity - cursor} bits padding)`);

  fs.mkdirSync(path.dirname(schemaPath), { recursive: true });
  fs.writeFileSync(
    schemaPath,
    JSON.stringify(
      {
        table: 'COCH',
        offset: coch.entry.realOffset,
        recordLenBytes: coch.header.recordLenBytes,
        records: coch.records.length,
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

  const teamByTgid = new Map(team.records.map((t) => [num(t.TGID), t]));
  const names = coch.fields.map((f) => f.name);
  const lines = [['coach', 'team', 'employed', ...names].join(',')];

  for (const r of coch.records) {
    const t = teamByTgid.get(num(r.TGID));
    const cells = [
      coachName(r),
      t ? teamName(t) : '',
      num(r.TGID) === NO_TEAM ? 'no' : 'yes',
      ...names.map((k) => r[k]),
    ];
    lines.push(cells.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(','));
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  console.log(`  wrote ${csvPath} (${names.length + 3} columns x ${coch.records.length} rows)`);

  const employed = coch.records.filter((r) => num(r.TGID) !== NO_TEAM).length;
  console.log(
    `\n  ${employed} coaches employed, ${coch.records.length - employed} in the free-agent pool`,
  );
  console.log('\nSpot check:');
  for (const n of ['Michigan', 'Ohio State', 'Texas']) {
    const t = team.records.find((x) => x.TDNA === n);
    if (!t) continue;
    const c = coch.records.find((r) => num(r.TGID) === num(t.TGID));
    if (!c) continue;
    console.log(
      `  ${coachName(c).padEnd(18)} ${teamName(t).padEnd(24)} ` +
        `prestige ${num(c.CPRE)} off.playbook ${num(c.CPID)} def.playbook ${num(c.CDID)} ` +
        `focus ${num(c.CDPC)}/${num(c.CRPC)}/${num(c.CTPC)}`,
    );
  }
}

main();

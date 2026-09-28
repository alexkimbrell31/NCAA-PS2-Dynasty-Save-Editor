/**
 * Dump the PLAY table.
 *
 * The schema is read from the file's own descriptor block at runtime -- nothing
 * about the 98 fields is hardcoded here. play_schema.json is a build ARTIFACT,
 * not an input.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  FIELD_TYPE_SIGNED,
  PLAYER_POSITIONS,
  PLAYER_YEARS,
  RATING_FIELDS,
  findTable,
  hex,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerRosterSlot,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const schemaPath = path.join(repoRoot, 'play_schema.json');
const outDir = path.join(repoRoot, 'out');
const csvPath = path.join(outDir, 'PLAY.csv');

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  const entry = findTable(toc, 'PLAY');
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);

  console.log(`PLAY header   : ${hex(entry.realOffset)}`);
  console.log(`Descriptors   : ${hex(header.fieldsOffset)}`);
  console.log(`Data          : ${hex(header.dataOffset)}`);
  console.log(`Record length : ${header.recordLenBytes} bytes (${header.recordLenBits} max bit index)`);
  console.log(`Records       : ${header.currentRecords} used / ${header.maxRecords} allocated`);
  console.log(`Fields        : ${header.fieldCount}\n`);

  // --- Bit tiling assertion -------------------------------------------------
  // The strongest structural check we have: fields must cover a contiguous bit
  // range with no overlaps and fit inside the record.
  const capacity = header.recordLenBytes * 8;
  const problems: string[] = [];
  let cursor = 0;
  for (const f of fields) {
    if (f.bitOffset < cursor) {
      problems.push(`${f.name} overlaps previous field (starts at bit ${f.bitOffset}, cursor ${cursor})`);
    } else if (f.bitOffset > cursor) {
      problems.push(`Gap of ${f.bitOffset - cursor} bits before ${f.name} (bit ${cursor}..${f.bitOffset - 1})`);
    }
    cursor = f.bitOffset + f.bits;
  }
  if (cursor > capacity) {
    problems.push(`Fields need ${cursor} bits but record holds only ${capacity}`);
  }

  if (problems.length) {
    console.error(`BIT TILING FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`Bit tiling OK: bits 0..${cursor - 1} covered, ${capacity - cursor} bits padding\n`);

  // --- Schema artifact ------------------------------------------------------
  const schema = {
    table: 'PLAY',
    generatedFrom: 'BASLUS-21459DDyn1 descriptor block (do not hand-edit)',
    tableHeaderOffsetHex: hex(entry.realOffset),
    fieldsOffsetHex: hex(header.fieldsOffset),
    dataOffsetHex: hex(header.dataOffset),
    recordLenBytes: header.recordLenBytes,
    recordBitsUsed: cursor,
    maxRecords: header.maxRecords,
    currentRecords: header.currentRecords,
    fieldCount: header.fieldCount,
    fields: fields.map((f, i) => ({
      index: i,
      name: f.name,
      bitOffset: f.bitOffset,
      bitEnd: f.bitOffset + f.bits - 1,
      bits: f.bits,
      type: f.type,
      signed: f.type === FIELD_TYPE_SIGNED,
      typeUnreliable: f.typeUnreliable,
    })),
  };
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  console.log(`Wrote schema : ${schemaPath}`);

  // --- CSV ------------------------------------------------------------------
  // Decoded name, team and position are prepended as convenience columns; the
  // raw field values are still emitted so the dump stays lossless.
  const records = readRecords(buf, header, fields);
  const names = fields.map((f) => f.name);
  // Ratings are stored as a 5-bit index; emit the 0-99 value the game shows
  // alongside the raw field so the dump stays lossless.
  const ratingCols = RATING_FIELDS.filter((f) => names.includes(f));
  const lines = [
    [
      'firstName', 'lastName', 'TGID', 'rosterSlot', 'position', 'classYear',
      ...ratingCols.map((f) => `${f.slice(1)}_display`),
      ...names,
    ].join(','),
  ];
  for (const rec of records) {
    const n = playerName(rec);
    const pgid = Number(rec.PGID);
    lines.push(
      [
        n.first,
        n.last,
        playerTeam(pgid),
        playerRosterSlot(pgid),
        PLAYER_POSITIONS[Number(rec.PPOS)] ?? rec.PPOS,
        PLAYER_YEARS[Number(rec.PYER)] ?? rec.PYER,
        ...ratingCols.map((f) => ratingToDisplay(Number(rec[f]))),
        ...names.map((k) => rec[k]),
      ].join(','),
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(csvPath, lines.join('\n') + '\n');
  console.log(
    `Wrote CSV    : ${csvPath} ` +
      `(${names.length + 6 + ratingCols.length} columns x ${records.length} rows)`,
  );

  console.log(
    `\nSpot check   : ` +
      records
        .slice(0, 3)
        .map((r) => {
          const n = playerName(r);
          return (
            `${n.first} ${n.last} ${PLAYER_POSITIONS[Number(r.PPOS)]} #${r.PJEN} ` +
            `OVR ${ratingToDisplay(Number(r.POVR))}`
          );
        })
        .join(' | '),
  );

  console.table(
    fields.map((f, i) => ({
      '#': i + 1,
      field: f.name,
      bits: `${f.bitOffset}-${f.bitOffset + f.bits - 1}`,
      w: f.bits,
      type: f.typeUnreliable ? `${f.type}?` : f.type,
    })),
  );
}

main();

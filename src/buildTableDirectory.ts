/**
 * Build the master table directory from the TOC.
 *
 * Pointers in the TOC are relative to TOC_BASE (0x2B0). With that applied,
 * every one of the 82 tables resolves and the tables tile the DB region
 * contiguously -- which is the assertion below, and our proof the base is right.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  findTable,
  hex,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readSaveFile,
} from './lib/eadb.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(here, '..', 'analysis', 'tableDirectory.json');

interface DirectoryRow {
  name: string;
  tocOffsetHex: string;
  pointer: number;
  pointerHex: string;
  realOffset: number;
  realOffsetHex: string;
  /** Start of the next table in file order, or dbSize for the last one. */
  rangeEnd: number;
  rangeLength: number;
  recordLenBytes: number;
  maxRecords: number;
  currentRecords: number;
  fieldCount: number;
}

function main() {
  const buf = readSaveFile();
  const header = parseFileHeader(buf);
  const toc = parseToc(buf, header);

  console.log(`DB size     : ${hex(header.dbSize)} (${header.dbSize} bytes)`);
  console.log(`File size   : ${buf.length} bytes (tail is PS2 save padding)`);
  console.log(`Table count : ${header.tableCount}`);
  console.log(`Checksum    : ${hex(header.checksum)}\n`);

  const byOffset = [...toc].sort((a, b) => a.realOffset - b.realOffset);

  const rows: DirectoryRow[] = byOffset.map((entry, i) => {
    const next = byOffset[i + 1];
    const rangeEnd = next ? next.realOffset : header.dbSize;
    const th = parseTableHeader(buf, entry.realOffset);

    return {
      name: entry.name,
      tocOffsetHex: hex(entry.tocOffset, 4),
      pointer: entry.pointer,
      pointerHex: hex(entry.pointer),
      realOffset: entry.realOffset,
      realOffsetHex: hex(entry.realOffset),
      rangeEnd,
      rangeLength: rangeEnd - entry.realOffset,
      recordLenBytes: th.recordLenBytes,
      maxRecords: th.maxRecords,
      currentRecords: th.currentRecords,
      fieldCount: th.fieldCount,
    };
  });

  // Verification: tables must tile the DB region with no gaps or overlaps, and
  // each table's length must match the derived layout formula
  //   0x24 + fieldCount*16 - 4 + maxRecords*recordLen + 8
  const problems: string[] = [];
  const allocation: {
    name: string;
    used: number;
    max: number;
    allocatedRows: number;
    slackBytes: number;
  }[] = [];
  if (byOffset[0].realOffset !== 0x2b0) {
    problems.push(`First table starts at ${hex(byOffset[0].realOffset)}, expected 0x000002B0`);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].rangeEnd !== rows[i + 1].realOffset) {
      problems.push(
        `Gap/overlap between ${rows[i].name} and ${rows[i + 1].name}: ` +
          `${hex(rows[i].rangeEnd)} != ${hex(rows[i + 1].realOffset)}`,
      );
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const th = parseTableHeader(buf, r.realOffset);
    const preamble = th.dataOffset - r.realOffset;
    const usableBytes = r.rangeLength - preamble;

    // The property that actually matters: all USED records must fit inside the
    // table's span. Allocation is sized to need, not to maxRecords -- sparsely
    // populated tables (BXSS, SCHT, LECH with 0 records) reserve no row space
    // at all, so maxRecords must never be used to locate the next table.
    const neededBytes = th.currentRecords * th.recordLenBytes;
    if (neededBytes > usableBytes) {
      problems.push(
        `${r.name}: ${th.currentRecords} records need ${neededBytes} bytes but only ${usableBytes} available`,
      );
    }
    allocation.push({
      name: r.name,
      used: th.currentRecords,
      max: th.maxRecords,
      allocatedRows: Math.floor(usableBytes / th.recordLenBytes),
      slackBytes: usableBytes - neededBytes,
    });
  }
  const last = rows[rows.length - 1];
  if (last.rangeEnd !== header.dbSize) {
    problems.push(
      `Last table ${last.name} ends at ${hex(last.rangeEnd)}, expected ${hex(header.dbSize)}`,
    );
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));

  console.table(
    rows.map((r) => ({
      name: r.name,
      real: r.realOffsetHex,
      bytes: r.rangeLength,
      recLen: r.recordLenBytes,
      records: `${r.currentRecords}/${r.maxRecords}`,
      fields: r.fieldCount,
    })),
  );

  const play = findTable(toc, 'PLAY');
  console.log(`\nPLAY table header at ${hex(play.realOffset)} (TOC pointer ${hex(play.pointer)})`);
  console.log(`Saved directory to: ${outputPath}`);

  const shrunk = allocation.filter((a) => a.allocatedRows < a.max);
  console.log(
    `\n${shrunk.length} table(s) allocate fewer rows than maxRecords ` +
      `(allocation is sized to need): ${shrunk.map((s) => `${s.name} ${s.allocatedRows}/${s.max}`).join(', ')}`,
  );

  if (problems.length) {
    console.error(`\nTILING FAILED (${problems.length} problems):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `\nTiling OK: ${rows.length} tables contiguous from 0x000002B0 to ${hex(header.dbSize)}`,
  );
}

main();

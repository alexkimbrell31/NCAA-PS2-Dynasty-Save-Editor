/**
 * Generic single-table inspector.
 *
 * Usage: node src/experiments/inspectTable.ts CONF [convention] [rows]
 *
 * Used to sanity-check the descriptor interpretation against tables whose
 * contents are easy to recognise by eye (stadium capacities, conference counts,
 * schedule weeks) rather than PLAY, whose 98 fields are all opaque small ints.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readField,
  readSaveFile,
} from '../lib/eadb.ts';

function main() {
  const table = process.argv[2] ?? 'CONF';
  const rows = Number(process.argv[3] ?? 8);

  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);
  const entry = findTable(toc, table);
  const header = parseTableHeader(buf, entry.realOffset);
  const fields = parseFieldDescriptors(buf, header);

  console.log(`=== ${table} @ 0x${entry.realOffset.toString(16)} ===`);
  console.log(
    `recLen=${header.recordLenBytes}B records=${header.currentRecords}/${header.maxRecords} fields=${header.fieldCount} data=0x${header.dataOffset.toString(16)}`,
  );

  // Tiling report
  let cursor = 0;
  const gaps: string[] = [];
  for (const f of fields) {
    if (f.bitOffset !== cursor) gaps.push(`${f.name}: expected ${cursor}, got ${f.bitOffset}`);
    cursor = f.bitOffset + f.bits;
  }
  console.log(
    `schema: ${fields.map((f) => `${f.name}@${f.bitOffset}/${f.bits}`).join(' ')}`,
  );
  console.log(
    gaps.length
      ? `TILING GAPS: ${gaps.join('; ')}`
      : `tiling OK (0..${cursor - 1} of ${header.recordLenBytes * 8})`,
  );

  const n = Math.min(rows, header.currentRecords);
  const out: Record<string, number | string>[] = [];
  for (let i = 0; i < n; i++) {
    const base = header.dataOffset + i * header.recordLenBytes;
    const r: Record<string, number | string> = {};
    for (const f of fields) r[f.name] = readField(buf, base, f);
    out.push(r);
  }
  console.table(out);

  // Per-field ranges over the whole table.
  const stats = fields.map((f) => {
    let min = Infinity;
    let max = -Infinity;
    const distinct = new Set<number | string>();
    for (let i = 0; i < header.currentRecords; i++) {
      const base = header.dataOffset + i * header.recordLenBytes;
      const v = readField(buf, base, f);
      distinct.add(v);
      if (typeof v === 'number') {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return {
      field: f.name,
      bits: f.bits,
      kind: f.isString ? 'str' : f.type === 2 ? 'int(s)' : 'int',
      min: f.isString ? '' : min,
      max: f.isString ? '' : max,
      distinct: distinct.size,
    };
  });
  console.table(stats);
}

main();

/**
 * Find team boundaries from gaps in the PGID sequence.
 *
 * DCHT turned out to be sorted by PGID, so PGID ordering is meaningful.
 * If each team owns a contiguous block of PGIDs with unused slots between
 * teams, the gaps in the sorted PGID sequence mark team boundaries -- no
 * assumption about a power-of-two block size required.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { entry: e, header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const fileHeader = parseFileHeader(buf);
  const toc = parseToc(buf, fileHeader);

  // --- Inventory: which tables could be a roster link? ---------------------
  console.log('=== All tables (name, records, fields) ===');
  const rows = toc
    .map((e) => {
      const h = parseTableHeader(buf, e.realOffset);
      const f = parseFieldDescriptors(buf, h);
      return {
        name: e.name,
        records: h.currentRecords,
        fields: f.map((x) => x.name).join(' '),
      };
    })
    .filter((r) => r.records > 0)
    .sort((a, b) => b.records - a.records);
  for (const r of rows.slice(0, 20)) {
    console.log(`  ${r.name.padEnd(5)} ${String(r.records).padStart(5)}  ${r.fields.slice(0, 90)}`);
  }

  // --- PGID gap analysis ---------------------------------------------------
  const play = load(buf, toc, 'PLAY');
  const ids = play.records.map((r) => num(r.PGID)).sort((a, b) => a - b);

  const runs: { start: number; end: number; count: number }[] = [];
  let runStart = ids[0];
  let prev = ids[0];
  let count = 1;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] - prev > 1) {
      runs.push({ start: runStart, end: prev, count });
      runStart = ids[i];
      count = 0;
    }
    prev = ids[i];
    count++;
  }
  runs.push({ start: runStart, end: prev, count });

  console.log(`\n=== Contiguous PGID runs: ${runs.length} ===`);
  const runLens = runs.map((r) => r.count).sort((a, b) => a - b);
  console.log(
    `  run length: min=${runLens[0]} median=${runLens[Math.floor(runLens.length / 2)]} max=${runLens[runLens.length - 1]}`,
  );
  console.log('  first 15 runs:');
  for (const r of runs.slice(0, 15)) {
    console.log(
      `    PGID ${String(r.start).padStart(6)}..${String(r.end).padStart(6)}  ${String(r.count).padStart(4)} players  (gap before next)`,
    );
  }

  // Distribution of gap sizes between runs.
  const gaps: number[] = [];
  for (let i = 1; i < runs.length; i++) gaps.push(runs[i].start - runs[i - 1].end - 1);
  const gapCounts = new Map<number, number>();
  for (const g of gaps) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
  console.log(
    `\n  gap sizes between runs: ` +
      [...gapCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, v]) => `${k}(x${v})`)
        .join(' '),
  );

  // --- Roster size per run -------------------------------------------------
  // If runs are teams, every run should hold a full complement of positions.
  const byId = new Map(play.records.map((r) => [num(r.PGID), r]));
  console.log('\n  position coverage of the first 5 runs:');
  for (const r of runs.slice(0, 5)) {
    const positions = new Map<number, number>();
    for (let id = r.start; id <= r.end; id++) {
      const p = byId.get(id);
      if (p) positions.set(num(p.PPOS), (positions.get(num(p.PPOS)) ?? 0) + 1);
    }
    console.log(
      `    run ${r.start}..${r.end} (${r.count}): ${positions.size} distinct positions, ` +
        `QB-ish(0)=${positions.get(0) ?? 0}`,
    );
  }
}

main();

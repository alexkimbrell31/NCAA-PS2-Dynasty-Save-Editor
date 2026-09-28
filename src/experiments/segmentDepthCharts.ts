/**
 * Determine the player->team relationship empirically.
 *
 * Caution: matching PGID>>7 group ids against TEAM.TGID "looks" right because
 * TGID happens to be alphabetical, so ANY small integer id appears to line up.
 * That test is vacuous. We need co-occurrence evidence instead.
 *
 * DCHT holds one depth chart per team, stored contiguously. If we segment it
 * into teams, every player in a segment must belong to the same team. That
 * gives us ground-truth player groupings with no assumption about PGID's
 * internal structure -- which we can then test PGID against.
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

  const play = load(buf, toc, 'PLAY');
  const dcht = load(buf, toc, 'DCHT');
  const team = load(buf, toc, 'TEAM');

  // --- Segment DCHT into per-team depth charts -----------------------------
  // A new team's chart starts when (PPOS, ddep) restarts at the top.
  const segments: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 1; i < dcht.records.length; i++) {
    const prev = dcht.records[i - 1];
    const cur = dcht.records[i];
    // A restart: position index goes backwards AND depth resets to 0.
    if (num(cur.PPOS) < num(prev.PPOS) && num(cur.ddep) === 0) {
      segments.push({ start, end: i });
      start = i;
    }
  }
  segments.push({ start, end: dcht.records.length });

  const sizes = segments.map((s) => s.end - s.start);
  console.log(`DCHT segmented into ${segments.length} depth charts`);
  console.log(
    `  segment size: min=${Math.min(...sizes)} max=${Math.max(...sizes)} ` +
      `mean=${(sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1)}`,
  );

  // --- For each segment, what PGID range do its players span? --------------
  console.log('\nFirst 12 segments: PGID range of the players they reference');
  for (const s of segments.slice(0, 12)) {
    const ids = dcht.records.slice(s.start, s.end).map((r) => num(r.PGID));
    const lo = Math.min(...ids);
    const hi = Math.max(...ids);
    console.log(
      `  rows ${String(s.start).padStart(5)}..${String(s.end).padStart(5)} ` +
        `(${String(s.end - s.start).padStart(3)} entries): PGID ${lo}..${hi} ` +
        `span=${hi - lo + 1} distinctPlayers=${new Set(ids).size}`,
    );
  }

  // --- Does a fixed block size explain PGID? -------------------------------
  // If PGID = teamIndex*B + slot, then within a segment all ids share the same
  // floor(PGID / B). Find B values for which that holds across all segments.
  console.log('\n=== Block sizes B for which every segment has a single floor(PGID/B) ===');
  for (let B = 16; B <= 512; B *= 2) {
    let coherent = 0;
    for (const s of segments) {
      const blocks = new Set(
        dcht.records.slice(s.start, s.end).map((r) => Math.floor(num(r.PGID) / B)),
      );
      if (blocks.size === 1) coherent++;
    }
    console.log(
      `  B=${String(B).padStart(3)}: ${coherent}/${segments.length} segments map to a single block`,
    );
  }

  // --- Reverse: how many PLAY players fall in each block, for the best B ----
  for (const B of [64, 128]) {
    const blocks = new Map<number, number>();
    for (const r of play.records) {
      const b = Math.floor(num(r.PGID) / B);
      blocks.set(b, (blocks.get(b) ?? 0) + 1);
    }
    const counts = [...blocks.values()].sort((a, b) => a - b);
    console.log(
      `\nPLAY grouped by floor(PGID/${B}): ${blocks.size} blocks, ` +
        `sizes min=${counts[0]} median=${counts[Math.floor(counts.length / 2)]} max=${counts[counts.length - 1]}`,
    );
  }

  // --- TEAM composition -----------------------------------------------------
  const lgidCounts = new Map<number, number>();
  for (const r of team.records) lgidCounts.set(num(r.LGID), (lgidCounts.get(num(r.LGID)) ?? 0) + 1);
  console.log(
    `\nTEAM.LGID distribution: ` +
      [...lgidCounts.entries()].map(([k, v]) => `${k}:${v}`).join(' '),
  );
  const tgids = team.records.map((r) => num(r.TGID)).sort((a, b) => a - b);
  console.log(`TEAM.TGID: ${tgids.length} teams, range ${tgids[0]}..${tgids[tgids.length - 1]}`);
}

main();

/**
 * The season-stat block. PSOF/PSDE should hold real per-player statistics; if
 * PLAC's As** columns are season totals they must appear there verbatim.
 */

import {
  PLAYER_POSITIONS,
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

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) };
  };

  for (const tag of ['PSOF', 'PSDE', 'WQTS']) {
    const t = load(tag);
    console.log(
      `\n=== ${tag}  ${t.h.currentRecords}/${t.h.maxRecords} records, ` +
        `${t.f.length} fields, ${t.h.recordLenBytes}B each ===`,
    );
    const sorted = [...t.f].sort((a, b) => a.bitOffset - b.bitOffset);
    for (const f of sorted) {
      const vals = t.rows.map((r) => num(r[f.name]));
      if (!vals.length) {
        console.log(`  ${f.name.padEnd(6)} x${f.bits} (no rows)`);
        continue;
      }
      console.log(
        `  ${f.name.padEnd(6)} bit ${String(f.bitOffset).padStart(4)} x${String(f.bits).padStart(3)} ` +
          `type ${f.type}  ${String(new Set(vals).size).padStart(4)} distinct  ` +
          `${Math.min(...vals)}..${Math.max(...vals)}  ${vals.filter((v) => v === 0).length} zero`,
      );
    }
  }

  // Does PLAC's As** appear verbatim in PSOF/PSDE for the same player?
  const plac = load('PLAC');
  const play = load('PLAY');
  const byPgid = new Map(play.rows.map((p) => [num(p.PGID), p]));

  for (const tag of ['PSOF', 'PSDE']) {
    const t = load(tag);
    if (!t.rows.length || !('PGID' in t.rows[0])) {
      console.log(`\n${tag}: no rows or no PGID, cannot cross-check`);
      continue;
    }
    const idx = new Map(t.rows.map((r) => [num(r.PGID), r]));
    const overlap = plac.rows.filter((r) => idx.has(num(r.PGID)));
    console.log(`\n${tag}: ${overlap.length}/${plac.rows.length} PLAC rows have a ${tag} row`);
    if (!overlap.length) continue;

    const statNames = t.f.map((f) => f.name).filter((n) => n !== 'PGID');
    for (const pc of ['PAcC', 'PAsC', 'PAcS', 'PAsS', 'PAcV', 'PAsV']) {
      for (const sn of statNames) {
        const agree = overlap.filter((r) => num(r[pc]) === num(idx.get(num(r.PGID))![sn])).length;
        if (agree / overlap.length >= 0.9) {
          console.log(
            `  PLAC.${pc} == ${tag}.${sn} on ${agree}/${overlap.length} ` +
              `(${((agree / overlap.length) * 100).toFixed(0)}%)`,
          );
        }
      }
    }
  }

  // Sanity: are PSOF/PSDE actually populated, or is this a preseason save with
  // empty stat tables?
  for (const tag of ['PSOF', 'PSDE']) {
    const t = load(tag);
    const nonZero = t.rows.filter((r) =>
      Object.entries(r).some(([k, v]) => k !== 'PGID' && typeof v === 'number' && v !== 0),
    ).length;
    console.log(`\n${tag}: ${nonZero}/${t.rows.length} rows have any non-zero stat`);
    for (const r of t.rows.slice(0, 5)) {
      const p = byPgid.get(num(r.PGID));
      const nm = p ? playerName(p) : null;
      console.log(
        `  ${(nm ? `${nm.first} ${nm.last}` : `PGID ${num(r.PGID)}`).padEnd(22)} ` +
          `${(p ? PLAYER_POSITIONS[num(p.PPOS)] : '?').padEnd(4)} ` +
          Object.entries(r)
            .filter(([k]) => k !== 'PGID')
            .map(([k, v]) => `${k}=${v}`)
            .join(' '),
      );
    }
  }
}

main();

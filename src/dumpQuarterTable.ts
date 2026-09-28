/** Decode WQTS (quarter-by-quarter line scores) to CSV. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QUARTERS_PER_GAME,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (t: string) => {
    const e = findTable(toc, t);
    const h = parseTableHeader(buf, e.realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { e, h, f, rows: readRecords(buf, h, f) };
  };

  const wqts = load('WQTS');
  const schd = load('SCHD');
  const team = load('TEAM');
  const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));

  console.log(
    `WQTS @ 0x${wqts.e.realOffset.toString(16).padStart(8, '0')}\n` +
      `  ${wqts.h.currentRecords}/${wqts.h.maxRecords} records, ` +
      `${wqts.f.length} fields, ${wqts.h.recordLenBytes}B each`,
  );

  const sorted = [...wqts.f].sort((a, b) => a.bitOffset - b.bitOffset);
  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  writeFileSync(
    join(root, 'analysis', 'quarter_schema.json'),
    JSON.stringify(
      {
        table: 'WQTS',
        offset: wqts.e.realOffset,
        recordLenBytes: wqts.h.recordLenBytes,
        records: wqts.h.currentRecords,
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

  const games = new Map<string, Array<Record<string, number | string>>>();
  for (const r of wqts.rows) {
    const k = `${n(r.SEWN)}|${n(r.SGNM)}`;
    if (!games.has(k)) games.set(k, []);
    games.get(k)!.push(r);
  }
  const schdBy = new Map(schd.rows.map((g) => [`${n(g.SEWN)}|${n(g.SGNM)}`, g]));

  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const head = ['week', 'game', 'away', 'home'];
  for (let q = 1; q <= QUARTERS_PER_GAME; q++) head.push(`awayQ${q}`, `homeQ${q}`);
  head.push('awayFinal', 'homeFinal', 'schdAway', 'schdHome');
  const out: string[] = [head.join(',')];

  for (const [k, qs] of [...games].sort(
    (a, b) => n(a[1][0].SGNM) - n(b[1][0].SGNM),
  )) {
    const g = schdBy.get(k)!;
    const ord = qs.slice().sort((a, b) => n(a.GQTR) - n(b.GQTR));
    const cells: Array<string | number> = [
      n(g.SEWN),
      n(g.SGNM),
      tn.get(n(g.GATG)) ?? '',
      tn.get(n(g.GHTG)) ?? '',
    ];
    for (const q of ord) cells.push(n(q.GASC), n(q.GHSC));
    cells.push(
      ord.reduce((a, q) => a + n(q.GASC), 0),
      ord.reduce((a, q) => a + n(q.GHSC), 0),
      n(g.GASC),
      n(g.GHSC),
    );
    out.push(cells.map(esc).join(','));
  }

  const csv = join(root, 'out', 'WQTS.csv');
  writeFileSync(csv, out.join('\n') + '\n');
  console.log(`  wrote ${csv} (${head.length} columns x ${games.size} games)`);

  const wk0 = schd.rows.filter((g) => n(g.SEWN) === 0);
  const unplayed = wk0.filter((g) => !games.has(`${n(g.SEWN)}|${n(g.SGNM)}`));
  console.log(
    `\n${games.size} of week 0's ${wk0.length} games have been played. Still to come:`,
  );
  for (const g of unplayed) {
    console.log(
      `  ${(tn.get(n(g.GATG)) ?? '?').padEnd(18)} at ${(tn.get(n(g.GHTG)) ?? '?').padEnd(18)}` +
        `${n(g.GFHU) || n(g.GFFU) ? '   <-- user game' : ''}`,
    );
  }

  console.log('\nBiggest margins:');
  const margins = [...games.values()]
    .map((qs) => {
      const g = schdBy.get(`${n(qs[0].SEWN)}|${n(qs[0].SGNM)}`)!;
      return { g, m: Math.abs(n(g.GHSC) - n(g.GASC)) };
    })
    .sort((a, b) => b.m - a.m)
    .slice(0, 5);
  for (const { g, m } of margins) {
    console.log(
      `  ${String(m).padStart(3)}  ${(tn.get(n(g.GATG)) ?? '?').padEnd(18)} ` +
        `${String(n(g.GASC)).padStart(3)} - ${String(n(g.GHSC)).padEnd(3)} ` +
        `${tn.get(n(g.GHTG)) ?? '?'}`,
    );
  }
}

main();

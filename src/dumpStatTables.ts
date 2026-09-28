/** Decode PSOF and PSDE (per-game statistic lines) to CSV. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFENSIVE_FIELDS,
  PASSING_FIELDS,
  PLAYER_POSITIONS,
  RECEIVING_FIELDS,
  RUSHING_FIELDS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
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

  const psof = load('PSOF');
  const psde = load('PSDE');
  const play = load('PLAY');
  const team = load('TEAM');
  const schd = load('SCHD');
  const byP = new Map(play.rows.map((p) => [n(p.PGID), p]));
  const tn = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));

  const opponent = new Map<number, string>();
  for (const g of schd.rows) {
    if (n(g.SEWN) !== 0) continue;
    opponent.set(n(g.GHTG), tn.get(n(g.GATG)) ?? '');
    opponent.set(n(g.GATG), `at ${tn.get(n(g.GHTG)) ?? ''}`);
  }

  mkdirSync(join(root, 'analysis'), { recursive: true });
  mkdirSync(join(root, 'out'), { recursive: true });
  const esc = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') ? `"${s.replaceAll('"', '""')}"` : s;
  };

  for (const [tag, t] of [
    ['PSOF', psof],
    ['PSDE', psde],
  ] as const) {
    const sorted = [...t.f].sort((a, b) => a.bitOffset - b.bitOffset);
    console.log(
      `${tag} @ 0x${t.e.realOffset.toString(16).padStart(8, '0')}  ` +
        `${t.h.currentRecords}/${t.h.maxRecords} records, ${t.f.length} fields, ` +
        `${t.h.recordLenBytes}B each`,
    );
    writeFileSync(
      join(root, 'analysis', `${tag.toLowerCase()}_schema.json`),
      JSON.stringify(
        {
          table: tag,
          offset: t.e.realOffset,
          recordLenBytes: t.h.recordLenBytes,
          records: t.h.currentRecords,
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

    const labels =
      tag === 'PSOF'
        ? { ...PASSING_FIELDS, ...RECEIVING_FIELDS, ...RUSHING_FIELDS }
        : DEFENSIVE_FIELDS;
    const inverse = new Map(Object.entries(labels).map(([k, v]) => [v as string, k]));
    const raw = sorted.map((f) => f.name);
    const head = ['player', 'position', 'team', 'opponent'].concat(
      raw.map((r) => inverse.get(r) ?? r),
    );
    const out: string[] = [head.join(',')];
    for (const r of t.rows) {
      const p = byP.get(n(r.PGID))!;
      const nm = playerName(p);
      const tg = playerTeam(n(r.PGID));
      const cells: Array<string | number> = [
        `${nm.first} ${nm.last}`,
        PLAYER_POSITIONS[n(p.PPOS)] ?? '?',
        tn.get(tg) ?? '',
        opponent.get(tg) ?? '',
      ];
      for (const name of raw) cells.push(r[name]);
      out.push(cells.map(esc).join(','));
    }
    const csv = join(root, 'out', `${tag}.csv`);
    writeFileSync(csv, out.join('\n') + '\n');
    console.log(`  wrote ${csv} (${head.length} columns x ${t.rows.length} rows)`);
  }

  // Leaderboards as a readability check.
  const top = (
    rows: Array<Record<string, number | string>>,
    field: string,
    label: string,
    extra: (r: Record<string, number | string>) => string,
  ) => {
    console.log(`\n${label}:`);
    for (const r of [...rows].sort((a, b) => n(b[field]) - n(a[field])).slice(0, 5)) {
      const p = byP.get(n(r.PGID))!;
      const nm = playerName(p);
      console.log(
        `  ${String(n(r[field])).padStart(4)}  ${`${nm.first} ${nm.last}`.padEnd(22)} ` +
          `${(PLAYER_POSITIONS[n(p.PPOS)] ?? '').padEnd(4)} ` +
          `${(tn.get(playerTeam(n(r.PGID))) ?? '').padEnd(18)} ${extra(r)}`,
      );
    }
  };

  top(psof.rows, PASSING_FIELDS.yards, 'Passing yards', (r) =>
    `${n(r[PASSING_FIELDS.completions])}/${n(r[PASSING_FIELDS.attempts])}, ` +
      `${n(r[PASSING_FIELDS.touchdowns])} TD, ${n(r[PASSING_FIELDS.interceptions])} INT`);
  top(psof.rows, RUSHING_FIELDS.yards, 'Rushing yards', (r) =>
    `${n(r[RUSHING_FIELDS.carries])} car, ${n(r[RUSHING_FIELDS.touchdowns])} TD, ` +
      `long ${n(r[RUSHING_FIELDS.longest])}`);
  top(psof.rows, RECEIVING_FIELDS.yards, 'Receiving yards', (r) =>
    `${n(r[RECEIVING_FIELDS.catches])} rec, ${n(r[RECEIVING_FIELDS.touchdowns])} TD`);
  top(psde.rows, DEFENSIVE_FIELDS.tackles, 'Tackles', (r) =>
    `${n(r[DEFENSIVE_FIELDS.tacklesForLoss])} TFL, ${n(r[DEFENSIVE_FIELDS.sacks])} sacks`);
}

main();

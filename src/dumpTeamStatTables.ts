/**
 * Dump TSSE (team season stats), PSKI (kicking/punting) and PSKP (returns)
 * to CSV, plus a few readable leaderboards.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FG_BUCKETS,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
  signed16,
} from './lib/eadb.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'out');
const n = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const load = (tag: string) => {
    const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
    const f = parseFieldDescriptors(buf, h);
    return { h, f, rows: readRecords(buf, h, f) as Record<string, number | string>[] };
  };

  const tsse = load('TSSE');
  const pski = load('PSKI');
  const pskp = load('PSKP');
  const team = load('TEAM');
  const play = load('PLAY');

  const teamName = new Map(team.rows.map((t) => [n(t.TGID), String(t.TDNA)]));
  const nameOf = new Map(
    play.rows.map((p) => {
      const { first, last } = playerName(p);
      return [n(p.PGID), `${first} ${last}`.trim()];
    }),
  );

  mkdirSync(outDir, { recursive: true });

  const SIGNED_TSSE = new Set(['tsop', 'tsor', 'tsoy', 'tsdp', 'tsdy', 'tsTy']);

  const writeCsv = (
    file: string,
    fields: { name: string }[],
    rows: Record<string, number | string>[],
    extra: { header: string[]; row: (r: Record<string, number | string>) => (string | number)[] },
  ) => {
    const header = [...extra.header, ...fields.map((f) => f.name)];
    const lines = [header.join(',')];
    for (const r of rows) {
      const cells = [
        ...extra.row(r),
        ...fields.map((f) => {
          const v = r[f.name];
          if (typeof v === 'string') return `"${v.replace(/"/g, '""')}"`;
          return SIGNED_TSSE.has(f.name) ? signed16(v) : v;
        }),
      ];
      lines.push(cells.join(','));
    }
    const path = resolve(outDir, file);
    writeFileSync(path, lines.join('\n') + '\n', 'latin1');
    console.log(`wrote ${path}  (${header.length} cols x ${rows.length} rows)`);
  };

  writeCsv('TSSE.csv', tsse.f, tsse.rows, {
    header: ['team'],
    row: (r) => [`"${teamName.get(n(r.TGID)) ?? '?'}"`],
  });
  writeCsv('PSKI.csv', pski.f, pski.rows, {
    header: ['player', 'team'],
    row: (r) => [
      `"${nameOf.get(n(r.PGID)) ?? '?'}"`,
      `"${teamName.get(playerTeam(n(r.PGID))) ?? '?'}"`,
    ],
  });
  writeCsv('PSKP.csv', pskp.f, pskp.rows, {
    header: ['player', 'team'],
    row: (r) => [
      `"${nameOf.get(n(r.PGID)) ?? '?'}"`,
      `"${teamName.get(playerTeam(n(r.PGID))) ?? '?'}"`,
    ],
  });

  const label = (r: Record<string, number | string>) =>
    `${nameOf.get(n(r.PGID)) ?? '?'} (${teamName.get(playerTeam(n(r.PGID))) ?? '?'})`;

  console.log('\n--- total offense, week 0 ---');
  [...tsse.rows]
    .sort((a, b) => signed16(n(b.tsoy)) - signed16(n(a.tsoy)))
    .slice(0, 8)
    .forEach((r) =>
      console.log(
        `  ${String(teamName.get(n(r.TGID))).padEnd(22)} ${String(signed16(n(r.tsoy))).padStart(4)} yds ` +
          `(${signed16(n(r.tsop))} pass, ${signed16(n(r.tsor))} rush)  ` +
          `${r.ts3c}/${r.ts3d} on third down`,
      ),
    );

  console.log('\n--- longest field goals ---');
  [...pski.rows]
    .sort((a, b) => n(b.skfL) - n(a.skfL))
    .slice(0, 6)
    .forEach((r) => console.log(`  ${String(label(r)).padEnd(34)} ${r.skfL} yds, ${r.skfm}/${r.skfa} on the day`));

  console.log('\n--- field goal accuracy by distance, league-wide ---');
  FG_BUCKETS.forEach((b) => {
    const att = pski.rows.reduce((s, r) => s + n(r[b.att]), 0);
    const made = pski.rows.reduce((s, r) => s + n(r[b.made]), 0);
    console.log(
      `  ${b.label.padEnd(9)} ${String(made).padStart(3)}/${String(att).padEnd(3)} ` +
        `${att ? ((100 * made) / att).toFixed(0).padStart(3) : '  -'}%`,
    );
  });

  console.log('\n--- best punting days (net average) ---');
  [...pski.rows]
    .filter((r) => n(r.spat) >= 4)
    .sort((a, b) => n(b.spny) / n(b.spat) - n(a.spny) / n(a.spat))
    .slice(0, 6)
    .forEach((r) =>
      console.log(
        `  ${String(label(r)).padEnd(34)} ${r.spat} punts, ` +
          `${(n(r.spny) / n(r.spat)).toFixed(1)} net avg, long ${r.splN}, ${r.sppt} inside 20`,
      ),
    );

  console.log('\n--- return leaders ---');
  [...pskp.rows]
    .sort((a, b) => n(b.srky) + n(b.srpy) - (n(a.srky) + n(a.srpy)))
    .slice(0, 6)
    .forEach((r) =>
      console.log(
        `  ${String(label(r)).padEnd(34)} ${n(r.srky) + n(r.srpy)} yds ` +
          `(${r.srka} KR for ${r.srky}, ${r.srpa} PR for ${r.srpy})` +
          (n(r.srkt) + n(r.srpt) > 0 ? `  ${n(r.srkt) + n(r.srpt)} TD` : ''),
      ),
    );
}

main();

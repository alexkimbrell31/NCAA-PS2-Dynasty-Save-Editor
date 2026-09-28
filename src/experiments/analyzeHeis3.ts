/**
 * HEIS, third pass. The PA** columns look like a shared "player award" struct
 * rather than anything Heisman-specific. Find every other table that carries
 * the same field names -- if the block is shared, that is the identification.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerName,
  playerTeam,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);

function main() {
  const buf = readSaveFile();
  const header = parseFileHeader(buf);
  const toc = parseToc(buf, header);

  const heisH = parseTableHeader(buf, findTable(toc, 'HEIS').realOffset);
  const heisF = parseFieldDescriptors(buf, heisH);
  const heis = readRecords(buf, heisH, heisF);
  const target = heisF.map((f) => f.name);

  console.log('Which other tables carry HEIS\'s field names?');
  const sharers: Array<{ tag: string; shared: string[]; rows: number }> = [];
  for (const e of toc) {
    if (e.name === 'HEIS') continue;
    let h;
    try {
      h = parseTableHeader(buf, e.realOffset);
    } catch {
      continue;
    }
    const names = parseFieldDescriptors(buf, h).map((f) => f.name);
    const shared = target.filter((t) => names.includes(t));
    if (shared.length >= 3) sharers.push({ tag: e.name, shared, rows: h.currentRecords });
  }
  for (const s of sharers.sort((a, b) => b.shared.length - a.shared.length)) {
    console.log(
      `  ${s.tag}  ${String(s.rows).padStart(5)} rows  ` +
        `${s.shared.length}/${target.length} shared: ${s.shared.join(' ')}`,
    );
  }

  // Compare HEIS's PA** values for a player against the same player's row in
  // any sharing table that also has PGID.
  const playH = parseTableHeader(buf, findTable(toc, 'PLAY').realOffset);
  const play = readRecords(buf, playH, parseFieldDescriptors(buf, playH));
  const byPgid = new Map(play.map((p) => [num(p.PGID), p]));

  for (const s of sharers) {
    if (!s.shared.includes('PGID') || !s.rows) continue;
    const h = parseTableHeader(buf, findTable(toc, s.tag).realOffset);
    const rows = readRecords(buf, h, parseFieldDescriptors(buf, h));
    const idx = new Map(rows.map((r) => [num(r.PGID), r]));
    const common = s.shared.filter((n) => n !== 'PGID');
    let matched = 0;
    let compared = 0;
    const diffs: string[] = [];
    for (const hr of heis) {
      const other = idx.get(num(hr.PGID));
      if (!other) continue;
      matched++;
      for (const c of common) {
        compared++;
        if (num(hr[c]) !== num(other[c])) {
          const p = byPgid.get(num(hr.PGID))!;
          const nm = playerName(p);
          diffs.push(`${nm.first} ${nm.last} ${c}: HEIS ${num(hr[c])} vs ${s.tag} ${num(other[c])}`);
        }
      }
    }
    if (matched) {
      console.log(
        `\n${s.tag}: ${matched}/10 HEIS candidates present; ` +
          `${compared - diffs.length}/${compared} field values agree`,
      );
      for (const d of diffs.slice(0, 10)) console.log(`    ${d}`);
    }
  }

  // CAN0: 7 distinct values in 18..104 over 10 rows. What is it?
  console.log('\nCAN0 values with duplicates:');
  const byCan: Map<number, number[]> = new Map();
  for (const r of heis) {
    const c = num(r.CAN0);
    if (!byCan.has(c)) byCan.set(c, []);
    byCan.get(c)!.push(num(r.HPRK));
  }
  for (const [c, ranks] of [...byCan].sort((a, b) => a[0] - b[0])) {
    const names = ranks.map((rk) => {
      const r = heis.find((x) => num(x.HPRK) === rk)!;
      const p = byPgid.get(num(r.PGID))!;
      const nm = playerName(p);
      return `${nm.first} ${nm.last}`;
    });
    console.log(`  ${String(c).padStart(4)}: ranks ${ranks.join(',')}  ${names.join(' / ')}`);
  }

  // Do PAty groups share anything?
  console.log('\nPAty groups:');
  const byTy: Map<number, string[]> = new Map();
  for (const r of heis) {
    const t = num(r.PAty);
    const p = byPgid.get(num(r.PGID))!;
    const nm = playerName(p);
    if (!byTy.has(t)) byTy.set(t, []);
    byTy.get(t)!.push(`${nm.first} ${nm.last} (${p.PPOS})`);
  }
  for (const [t, names] of [...byTy].sort((a, b) => a[0] - b[0])) {
    console.log(`  PAty ${String(t).padStart(2)}: ${names.join(', ')}`);
  }
}

main();

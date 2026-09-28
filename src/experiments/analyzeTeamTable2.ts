/**
 * Second pass on TEAM: prestige, coaching, stadium and the non-string fields.
 *
 * The first pass identified identity, conference, ratings and capacity. What
 * remains is to find the prestige rating (the 1-6 star value the game shows),
 * work out what JJNM/TPIP actually hold, and check the remaining links.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  ratingToDisplay,
  readBitsLE,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

/** Blue bloods: should sit at or near the top of any prestige field. */
const POWERS = ['Ohio State', 'Michigan', 'Texas', 'USC', 'Oklahoma', 'Florida', 'LSU', 'Notre Dame', 'Miami', 'Tennessee'];
/** Historically weak FBS programs in 2006: should sit at the bottom. */
const BOTTOM = ['Duke', 'Temple', 'Buffalo', 'Idaho', 'Utah State', 'Eastern Michigan', 'Florida Atlantic', 'UL Monroe'];

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { entry: e, header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const team = load(buf, toc, 'TEAM');
  const play = load(buf, toc, 'PLAY');
  const recs = team.records;

  const rosterTop = new Map<number, number>();
  const byTeam = new Map<number, number[]>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(ratingToDisplay(num(p.POVR)));
  }
  for (const [t, l] of byTeam) {
    const top = [...l].sort((a, b) => b - a).slice(0, 25);
    rosterTop.set(t, top.reduce((s, v) => s + v, 0) / top.length);
  }
  const fbs = recs.filter((r) => rosterTop.has(num(r.TGID)));

  // --- 1. Hunt for prestige -------------------------------------------------
  // A prestige field should rank blue bloods above bottom-feeders. Score every
  // small-range field by the gap between the two groups.
  console.log('=== Prestige hunt (mean value: powers vs weak programs) ===');
  const smallFields = team.fields.filter((f) => f.bits <= 10 && !f.isString);
  const rows = smallFields
    .map((f) => {
      const vals = fbs.map((r) => num(r[f.name])).filter(Number.isFinite);
      const distinct = new Set(vals).size;
      if (distinct < 3 || distinct > 12) return null;
      const mean = (names: string[]) => {
        const v = fbs.filter((r) => names.includes(str(r.TDNA))).map((r) => num(r[f.name]));
        return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
      };
      const hi = mean(POWERS);
      const lo = mean(BOTTOM);
      return { field: f.name, bits: f.bits, distinct, powers: hi, weak: lo, gap: hi - lo };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && Number.isFinite(x.gap))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  console.table(
    rows.slice(0, 10).map((r) => ({
      field: r.field,
      bits: r.bits,
      distinct: r.distinct,
      powersMean: r.powers.toFixed(2),
      weakMean: r.weak.toFixed(2),
      gap: r.gap.toFixed(2),
    })),
  );

  // Show the leader's full distribution against named teams.
  const bestField = rows[0]?.field;
  if (bestField) {
    console.log(`\n=== ${bestField} by value ===`);
    const groups = new Map<number, string[]>();
    for (const r of fbs) {
      const v = num(r[bestField]);
      if (!groups.has(v)) groups.set(v, []);
      groups.get(v)!.push(str(r.TDNA));
    }
    for (const [v, names] of [...groups.entries()].sort((a, b) => b[0] - a[0])) {
      console.log(`  ${v} (${String(names.length).padStart(3)}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? '...' : ''}`);
    }
  }

  // --- 2. What are JJNM and TPIP? ------------------------------------------
  // JJNM is 104 bits and non-empty for exactly the 119 FBS teams, which is a
  // strong hint it is FBS-only content rather than text.
  console.log('\n=== JJNM / TPIP ===');
  const jjnmFbs = recs.filter((r) => str(r.JJNM).length > 0 && rosterTop.has(num(r.TGID))).length;
  const jjnmFcs = recs.filter((r) => str(r.JJNM).length > 0 && !rosterTop.has(num(r.TGID))).length;
  console.log(`  JJNM non-empty: ${jjnmFbs} FBS, ${jjnmFcs} FCS`);

  // Re-read JJNM as raw bytes for a couple of teams to see the real content.
  const jf = team.fields.find((f) => f.name === 'JJNM')!;
  const tf = team.fields.find((f) => f.name === 'TPIP')!;
  console.log(`  JJNM at bit ${jf.bitOffset} (${jf.bits} bits = ${jf.bits / 8} bytes), type ${jf.type}`);
  console.log(`  TPIP at bit ${tf.bitOffset} (${tf.bits} bits = ${tf.bits / 8} bytes), type ${tf.type}`);

  for (const name of ['Air Force', 'Alabama', 'Ohio State']) {
    const idx = recs.findIndex((r) => str(r.TDNA) === name);
    if (idx < 0) continue;
    const base = team.header.dataOffset + idx * team.header.recordLenBytes;
    const bytes: number[] = [];
    for (let i = 0; i < jf.bits / 8; i++) {
      bytes.push(readBitsLE(buf, base, jf.bitOffset + i * 8, 8));
    }
    console.log(`  ${name.padEnd(12)} JJNM bytes: ${bytes.map((b) => String(b).padStart(3)).join(' ')}`);
  }

  // --- 3. Coaching / schedule links ----------------------------------------
  console.log('\n=== Cross-table links ===');
  for (const [tableName, keyField] of [['COCH', 'TGID'], ['STAD', 'SGID'], ['STTM', 'TGID']] as const) {
    try {
      const other = load(buf, toc, tableName);
      const keys = new Set(other.records.map((r) => num(r[keyField])).filter(Number.isFinite));
      if (keys.size === 0) {
        console.log(`  ${tableName}: no ${keyField} column`);
        continue;
      }
      const teamKeys = new Set(recs.map((r) => num(r[keyField])));
      const hits = [...keys].filter((k) => teamKeys.has(k)).length;
      console.log(
        `  ${tableName}.${keyField}: ${other.records.length} rows, ${keys.size} distinct, ` +
          `${hits}/${keys.size} resolve into TEAM.${keyField}`,
      );
    } catch {
      console.log(`  ${tableName}: not found`);
    }
  }

  // Does TEAM.SGID point at a stadium?
  try {
    const stad = load(buf, toc, 'STAD');
    const stadKey = stad.fields.find((f) => /SGID|STID/.test(f.name));
    if (stadKey) {
      const ids = new Set(stad.records.map((r) => num(r[stadKey.name])));
      const resolved = fbs.filter((r) => ids.has(num(r.SGID))).length;
      console.log(`  TEAM.SGID -> STAD.${stadKey.name}: ${resolved}/${fbs.length} FBS teams resolve`);
      const nameField = stad.fields.find((f) => f.isString);
      if (nameField) {
        console.log(
          `  sample stadiums: ` +
            stad.records.slice(0, 5).map((r) => `${str(r[nameField.name])}`).join(', '),
        );
      }
    }
  } catch { /* ignore */ }

  // --- 4. Rivalries? --------------------------------------------------------
  // TMRV spans 2..230, the TGID range -- likely a rival team pointer.
  console.log('\n=== TMRV as a team pointer ===');
  const nameByTgid = new Map(recs.map((r) => [num(r.TGID), str(r.TDNA)]));
  const resolves = recs.filter((r) => nameByTgid.has(num(r.TMRV))).length;
  console.log(`  ${resolves}/${recs.length} TMRV values resolve to a TGID`);
  console.log(
    '  samples: ' +
      fbs.slice(0, 8).map((r) => `${str(r.TDNA)}->${nameByTgid.get(num(r.TMRV)) ?? '?'}`).join(', '),
  );
  const mutual = recs.filter((r) => {
    const other = recs.find((o) => num(o.TGID) === num(r.TMRV));
    return other && num(other.TMRV) === num(r.TGID);
  }).length;
  console.log(`  mutual pairs: ${mutual} (a true rivalry field should be largely symmetric)`);
}

main();

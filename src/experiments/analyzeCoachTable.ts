/**
 * Semantic analysis of the COCH table.
 *
 * First impressions: 213 rows but only 121 distinct TGID, generic last names
 * ("AF Coach"), empty first names, and a large block of all-zero fields.
 * The questions are: what is the extra ~94 rows, what does TGID=511 mean, and
 * which fields carry real data in a fresh dynasty.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  ratingToDisplay,
  readRecords,
  readSaveFile,
  teamName,
} from '../lib/eadb.ts';

const num = (v: number | string) => (typeof v === 'number' ? v : NaN);
const str = (v: number | string) => (typeof v === 'string' ? v : '');

function load(buf: Buffer, toc: ReturnType<typeof parseToc>, name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { entry: e, header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const coch = load(buf, toc, 'COCH');
  const team = load(buf, toc, 'TEAM');
  const play = load(buf, toc, 'PLAY');
  const recs = coch.records;

  console.log(`COCH: ${recs.length} records, ${coch.fields.length} fields\n`);

  // --- 1. Which fields actually carry data? ---------------------------------
  // A fresh dynasty has no accumulated history, so constant fields are
  // expected. Separating live from dormant tells us what this save can teach.
  const live: string[] = [];
  const dead: string[] = [];
  for (const f of coch.fields) {
    const vals = new Set(recs.map((r) => r[f.name]));
    (vals.size > 1 ? live : dead).push(`${f.name}(${vals.size})`);
  }
  console.log(`=== ${live.length} varying fields ===`);
  console.log('  ' + live.join(' '));
  console.log(`\n=== ${dead.length} constant fields (no history in a preseason save) ===`);
  console.log('  ' + dead.join(' '));

  // --- 2. Names -------------------------------------------------------------
  console.log('\n=== Names ===');
  const lastNames = recs.map((r) => str(r.CLLN));
  const firstNames = recs.map((r) => str(r.CLFN));
  console.log(`  CLFN non-empty: ${firstNames.filter((v) => v).length}/${recs.length}`);
  console.log(`  CLLN non-empty: ${lastNames.filter((v) => v).length}/${recs.length}`);
  const generic = lastNames.filter((v) => /Coach$/.test(v)).length;
  console.log(`  last names ending in "Coach": ${generic}/${recs.length} (generic placeholders)`);
  console.log(`  samples: ${lastNames.slice(0, 6).map((v) => JSON.stringify(v)).join(', ')}`);
  console.log(`  non-generic: ${[...new Set(lastNames.filter((v) => v && !/Coach$/.test(v)))].slice(0, 10).join(', ')}`);

  // --- 3. Team assignment ---------------------------------------------------
  console.log('\n=== TGID assignment ===');
  const tgidCounts = new Map<number, number>();
  for (const r of recs) {
    const t = num(r.TGID);
    tgidCounts.set(t, (tgidCounts.get(t) ?? 0) + 1);
  }
  const teamByTgid = new Map(team.records.map((t) => [num(t.TGID), teamName(t)]));
  const sentinel = [...tgidCounts.entries()].filter(([t]) => !teamByTgid.has(t));
  console.log(`  ${tgidCounts.size} distinct TGID values`);
  console.log(`  unresolvable: ${sentinel.map(([t, c]) => `${t} (${c} coaches)`).join(', ')}`);
  const resolved = recs.filter((r) => teamByTgid.has(num(r.TGID)));
  console.log(`  ${resolved.length} coaches attached to a real team`);

  const multi = [...tgidCounts.entries()].filter(([t, c]) => teamByTgid.has(t) && c > 1);
  console.log(`  teams with more than one coach: ${multi.length}`);
  for (const [t, c] of multi.slice(0, 5)) {
    console.log(`    ${teamByTgid.get(t)}: ${c}`);
  }

  // Do the attached coaches cover exactly the FBS teams?
  const rostered = new Set(play.records.map((p) => playerTeam(num(p.PGID))));
  const attachedTgids = new Set(resolved.map((r) => num(r.TGID)));
  const fbsWithCoach = [...rostered].filter((t) => attachedTgids.has(t)).length;
  const nonFbsWithCoach = [...attachedTgids].filter((t) => !rostered.has(t)).length;
  console.log(`  FBS teams with a coach: ${fbsWithCoach}/${rostered.size}`);
  console.log(`  non-FBS teams with a coach: ${nonFbsWithCoach}`);

  // --- 4. The unattached coaches --------------------------------------------
  console.log('\n=== Unattached coaches (free agents?) ===');
  const free = recs.filter((r) => !teamByTgid.has(num(r.TGID)));
  console.log(`  count: ${free.length}`);
  console.log(`  sample names: ${free.slice(0, 8).map((r) => str(r.CLLN)).join(', ')}`);
  for (const f of ['CPRE', 'CTOP', 'CHAR', 'CSKI', 'CCFY', 'CBSZ', 'COTY']) {
    const att = resolved.map((r) => num(r[f]));
    const un = free.map((r) => num(r[f]));
    const mean = (a: number[]) => (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2);
    console.log(`  ${f}: attached mean ${mean(att)}, unattached mean ${mean(un)}`);
  }

  // --- 5. Coach prestige vs team ---------------------------------------------
  console.log('\n=== CPRE (coach prestige) vs team prestige ===');
  const rows = resolved
    .filter((r) => rostered.has(num(r.TGID)))
    .map((r) => {
      const t = team.records.find((x) => num(x.TGID) === num(r.TGID))!;
      return { cpre: num(r.CPRE), tmpr: num(t.TMPR), trov: num(t.TROV), name: teamName(t) };
    });
  const corr = (xs: number[], ys: number[]) => {
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  };
  console.log(`  n=${rows.length}`);
  console.log(`  corr(CPRE, team prestige TMPR) = ${corr(rows.map((r) => r.cpre), rows.map((r) => r.tmpr)).toFixed(3)}`);
  console.log(`  corr(CPRE, team overall TROV)  = ${corr(rows.map((r) => r.cpre), rows.map((r) => r.trov)).toFixed(3)}`);
  const byPre = new Map<number, string[]>();
  for (const r of rows) {
    if (!byPre.has(r.cpre)) byPre.set(r.cpre, []);
    byPre.get(r.cpre)!.push(r.name.split(' ')[0]);
  }
  for (const [p, names] of [...byPre.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`    CPRE ${p} (${String(names.length).padStart(3)}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? '...' : ''}`);
  }

  // --- 6. Tendency / style fields -------------------------------------------
  console.log('\n=== Style fields ===');
  for (const f of ['CDTA', 'COTA', 'CDTR', 'COTR', 'CDTS', 'COTS', 'CDPC', 'CRPC', 'CTPC', 'CTOP', 'CHAR', 'CSKI', 'CDST', 'COST', 'COHT', 'COFS', 'CThg', 'CFEX']) {
    const vals = recs.map((r) => num(r[f]));
    const dist = new Map<number, number>();
    for (const v of vals) dist.set(v, (dist.get(v) ?? 0) + 1);
    const top = [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    console.log(
      `  ${f}: ${Math.min(...vals)}..${Math.max(...vals)} (${dist.size} distinct)  ` +
        top.map(([v, c]) => `${v}x${c}`).join(' '),
    );
  }

  // --- 7. The CDID/CPID oddity ----------------------------------------------
  // TEAM had the same shape: TDPB 125..129 and TOPB 0..124. Two tables sharing
  // a quirk suggests a shared meaning rather than a decode artifact.
  console.log('\n=== CDID / CPID (mirrors TEAM.TDPB / TOPB) ===');
  const cdid = recs.map((r) => num(r.CDID));
  const cpid = recs.map((r) => num(r.CPID));
  console.log(`  CDID ${Math.min(...cdid)}..${Math.max(...cdid)}, ${new Set(cdid).size} distinct`);
  console.log(`  CPID ${Math.min(...cpid)}..${Math.max(...cpid)}, ${new Set(cpid).size} distinct`);
  console.log(`  CPID unique: ${new Set(cpid).size === recs.length}`);
  console.log(
    `  first 12 rows (CCID, TGID, CDID, CPID): ` +
      recs.slice(0, 12).map((r) => `[${num(r.CCID)},${num(r.TGID)},${num(r.CDID)},${num(r.CPID)}]`).join(' '),
  );
}

main();

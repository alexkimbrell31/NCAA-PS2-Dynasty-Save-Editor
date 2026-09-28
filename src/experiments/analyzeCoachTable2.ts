/**
 * Second pass on COCH.
 *
 * Two hypotheses to test:
 *  1. CPRE is not merely correlated with TEAM.TMPR -- it may be identical.
 *  2. CDID(125..129) / CPID(0..124) mirror TEAM.TDPB / TOPB. Five defensive
 *     values and ~one offensive value per team is exactly the shape of
 *     playbooks: everyone runs one of a handful of defensive fronts, but each
 *     school has its own offensive playbook.
 */

import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
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
  return { header: h, fields: f, records: readRecords(buf, h, f) };
}

function main() {
  const buf = readSaveFile();
  const toc = parseToc(buf, parseFileHeader(buf));
  const coch = load(buf, toc, 'COCH');
  const team = load(buf, toc, 'TEAM');
  const play = load(buf, toc, 'PLAY');

  const teamByTgid = new Map(team.records.map((t) => [num(t.TGID), t]));
  const attached = coch.records.filter((r) => teamByTgid.has(num(r.TGID)));
  const rostered = new Set(play.records.map((p) => playerTeam(num(p.PGID))));

  // --- 1. Is CPRE literally TMPR? ------------------------------------------
  console.log('=== CPRE vs TEAM.TMPR ===');
  const identical = attached.filter(
    (r) => num(r.CPRE) === num(teamByTgid.get(num(r.TGID))!.TMPR),
  ).length;
  console.log(
    `  ${identical}/${attached.length} coaches have CPRE exactly equal to their team's TMPR` +
      (identical === attached.length ? '  -> IDENTICAL, not merely correlated' : ''),
  );

  // --- 2. Playbooks ---------------------------------------------------------
  console.log('\n=== CDID/CPID vs TEAM.TDPB/TOPB (playbook hypothesis) ===');
  const dMatch = attached.filter(
    (r) => num(r.CDID) === num(teamByTgid.get(num(r.TGID))!.TDPB),
  ).length;
  const oMatch = attached.filter(
    (r) => num(r.CPID) === num(teamByTgid.get(num(r.TGID))!.TOPB),
  ).length;
  console.log(`  CDID == TEAM.TDPB: ${dMatch}/${attached.length}`);
  console.log(`  CPID == TEAM.TOPB: ${oMatch}/${attached.length}`);

  console.log('\n  Defensive playbook distribution (CDID):');
  const dDist = new Map<number, string[]>();
  for (const r of attached) {
    const d = num(r.CDID);
    if (!dDist.has(d)) dDist.set(d, []);
    dDist.get(d)!.push(str(teamByTgid.get(num(r.TGID))!.TDNA));
  }
  for (const [d, names] of [...dDist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    ${d} (${String(names.length).padStart(3)}): ${names.slice(0, 10).join(', ')}${names.length > 10 ? '...' : ''}`);
  }

  // If CPID is a per-school offensive playbook it should be near-unique among
  // the 119 FBS teams.
  const fbsAttached = attached.filter((r) => rostered.has(num(r.TGID)));
  const oIds = fbsAttached.map((r) => num(r.CPID));
  console.log(
    `\n  Offensive playbook (CPID) across ${fbsAttached.length} FBS teams: ` +
      `${new Set(oIds).size} distinct, range ${Math.min(...oIds)}..${Math.max(...oIds)}`,
  );
  const dupes = [...new Map<number, number>(
    oIds.map((v) => [v, oIds.filter((x) => x === v).length]),
  ).entries()].filter(([, c]) => c > 1);
  console.log(`  shared offensive playbooks: ${dupes.length}`);

  // --- 3. The one non-FBS team with a coach --------------------------------
  console.log('\n=== The odd non-FBS coach ===');
  for (const r of attached) {
    if (!rostered.has(num(r.TGID))) {
      const t = teamByTgid.get(num(r.TGID))!;
      console.log(`  ${str(r.CLLN)} -> ${teamName(t)} (TGID ${num(t.TGID)}, TTYP ${num(t.TTYP)})`);
    }
  }

  // --- 4. Unattached coaches ------------------------------------------------
  // 93 rows with TGID=511. Their names mirror FCS schools, so they are likely
  // placeholder coaches for the 84 FCS teams plus spares.
  console.log('\n=== Unattached (TGID=511) ===');
  const free = coch.records.filter((r) => !teamByTgid.has(num(r.TGID)));
  const fcsNames = new Set(
    team.records.filter((t) => num(t.TTYP) === 1).map((t) => str(t.TSNA)),
  );
  const matchesFcs = free.filter((r) => {
    const base = str(r.CLLN).replace(/ Coach$/, '');
    return fcsNames.has(base);
  }).length;
  console.log(`  ${free.length} unattached; ${matchesFcs} have a name matching an FCS team's short name`);
  console.log(`  all have CPRE=0: ${free.every((r) => num(r.CPRE) === 0)}`);
  console.log(`  all have CTOP=0: ${free.every((r) => num(r.CTOP) === 0)}`);

  // --- 5. Coaching style, only for real (attached) coaches ------------------
  console.log('\n=== Style of attached coaches ===');
  const styleFields = ['CDTA', 'COTA', 'CDTR', 'COTR', 'CDTS', 'COTS', 'CTOP', 'CHAR', 'CThg', 'CFEX', 'CDST', 'COST'];
  for (const f of styleFields) {
    const vals = attached.map((r) => num(r[f]));
    const dist = new Map<number, number>();
    for (const v of vals) dist.set(v, (dist.get(v) ?? 0) + 1);
    console.log(
      `  ${f}: ${Math.min(...vals)}..${Math.max(...vals)}  ` +
        [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join(' '),
    );
  }

  // Do offensive tendencies track the roster? A pass-heavy coach should have a
  // better QB corps than a run-heavy one.
  console.log('\n=== Does COTA track roster composition? ===');
  const qbStr = new Map<number, number>();
  const rbStr = new Map<number, number>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    const pos = num(p.PPOS);
    const ovr = num(p.POVR);
    if (pos === 0) qbStr.set(t, Math.max(qbStr.get(t) ?? 0, ovr));
    if (pos === 1) rbStr.set(t, Math.max(rbStr.get(t) ?? 0, ovr));
  }
  const pairs = fbsAttached
    .map((r) => ({
      cota: num(r.COTA),
      diff: (qbStr.get(num(r.TGID)) ?? 0) - (rbStr.get(num(r.TGID)) ?? 0),
    }));
  const mx = pairs.reduce((s, p) => s + p.cota, 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p.diff, 0) / pairs.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pairs) {
    sxy += (p.cota - mx) * (p.diff - my);
    sxx += (p.cota - mx) ** 2;
    syy += (p.diff - my) ** 2;
  }
  console.log(
    `  corr(COTA, bestQB - bestRB) = ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)} over ${pairs.length} teams`,
  );
}

main();

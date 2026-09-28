/**
 * Third pass: the CDID mismatches, and what the tendency fields mean.
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

  // --- 1. Where do CDID and TDPB disagree? ---------------------------------
  console.log('=== CDID vs TEAM.TDPB mismatches ===');
  const mism = attached.filter(
    (r) => num(r.CDID) !== num(teamByTgid.get(num(r.TGID))!.TDPB),
  );
  for (const r of mism) {
    const t = teamByTgid.get(num(r.TGID))!;
    console.log(
      `  ${str(t.TDNA).padEnd(20)} coach CDID=${num(r.CDID)}  team TDPB=${num(t.TDPB)}  TTYP=${num(t.TTYP)}`,
    );
  }
  console.log(`  ${mism.length} mismatches of ${attached.length}`);

  // --- 2. Playbook usage across ALL teams (not just coached ones) -----------
  console.log('\n=== TEAM.TDPB across all 203 teams ===');
  const dist = new Map<number, number>();
  for (const t of team.records) {
    const v = num(t.TDPB);
    dist.set(v, (dist.get(v) ?? 0) + 1);
  }
  for (const [v, c] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  TDPB ${v}: ${c} teams`);
  }

  // --- 3. Do defensive playbooks track roster shape? -----------------------
  // A 3-4 defense carries more linebackers and fewer down linemen than a 4-3.
  // If CDID is really a defensive scheme, roster composition should shift.
  console.log('\n=== Roster shape by defensive playbook ===');
  const rostered = new Map<number, Array<Record<string, number | string>>>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    if (!rostered.has(t)) rostered.set(t, []);
    rostered.get(t)!.push(p);
  }
  const byPlaybook = new Map<number, { teams: number; dl: number; lb: number }>();
  for (const r of attached) {
    const tg = num(r.TGID);
    const roster = rostered.get(tg);
    if (!roster) continue;
    const d = num(r.CDID);
    if (!byPlaybook.has(d)) byPlaybook.set(d, { teams: 0, dl: 0, lb: 0 });
    const e = byPlaybook.get(d)!;
    e.teams++;
    // DL = LE(10), RE(11), DT(12); LB = LOLB(13), MLB(14), ROLB(15)
    e.dl += roster.filter((p) => [10, 11, 12].includes(num(p.PPOS))).length;
    e.lb += roster.filter((p) => [13, 14, 15].includes(num(p.PPOS))).length;
  }
  console.table(
    [...byPlaybook.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, e]) => ({
        CDID: d,
        teams: e.teams,
        dlPerTeam: (e.dl / e.teams).toFixed(2),
        lbPerTeam: (e.lb / e.teams).toFixed(2),
        ratio: (e.dl / e.lb).toFixed(2),
      })),
  );

  // --- 4. Tendency fields: sliders or ratings? ------------------------------
  // Values that are all multiples of 5 look like user-facing sliders; finer
  // values look like generated ratings.
  console.log('\n=== Granularity of tendency fields ===');
  for (const f of ['CDTA', 'COTA', 'CDTR', 'COTR', 'CDTS', 'COTS', 'CDPC', 'CRPC', 'CTPC']) {
    const vals = attached.map((r) => num(r[f]));
    const mult5 = vals.filter((v) => v % 5 === 0).length;
    console.log(
      `  ${f}: ${((mult5 / vals.length) * 100).toFixed(0)}% are multiples of 5  ` +
        `(range ${Math.min(...vals)}..${Math.max(...vals)}, ${new Set(vals).size} distinct)`,
    );
  }

  // --- 5. Do the CxPC fields sum to something meaningful? ------------------
  // CDPC/CRPC/CTPC all sit in the 25..40 band, which smells like a three-way
  // split of recruiting effort or practice time.
  console.log('\n=== CDPC + CRPC + CTPC ===');
  const sums = attached.map((r) => num(r.CDPC) + num(r.CRPC) + num(r.CTPC));
  const sumDist = new Map<number, number>();
  for (const s of sums) sumDist.set(s, (sumDist.get(s) ?? 0) + 1);
  console.log(
    `  sum range ${Math.min(...sums)}..${Math.max(...sums)}; ` +
      `distribution: ${[...sumDist.entries()].sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}:${c}`).join(' ')}`,
  );

  // --- 6. Free-agent coach pool --------------------------------------------
  console.log('\n=== Unattached coach pool ===');
  const free = coch.records.filter((r) => !teamByTgid.has(num(r.TGID)));
  const fcsShort = new Map(
    team.records.filter((t) => num(t.TTYP) === 1).map((t) => [str(t.TSNA), str(t.TDNA)]),
  );
  const matched = free.filter((r) => fcsShort.has(str(r.CLLN).replace(/ Coach$/, '')));
  const unmatched = free.filter((r) => !fcsShort.has(str(r.CLLN).replace(/ Coach$/, '')));
  console.log(`  ${matched.length} map to an FCS school, ${unmatched.length} do not`);
  console.log(`  unmatched: ${unmatched.map((r) => str(r.CLLN)).join(', ')}`);
}

main();

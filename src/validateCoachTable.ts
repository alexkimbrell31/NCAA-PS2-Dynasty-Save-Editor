/**
 * Validate the decoded COCH table.
 *
 * COCH is harder to validate than TEAM because this save ships with generic
 * placeholder coaches ("Bama Coach") and a fresh dynasty has no accumulated
 * history -- 52 of the 84 fields hold a single constant value. The checks
 * below therefore lean on structural invariants and cross-table agreement
 * rather than on recognisable real-world names.
 */

import {
  NO_TEAM,
  DEFENSIVE_PLAYBOOK_MAX,
  DEFENSIVE_PLAYBOOK_MIN,
  TEAM_PRESTIGE_MAX,
  TEAM_PRESTIGE_MIN,
  coachName,
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  playerTeam,
  readRecords,
  readSaveFile,
} from './lib/eadb.ts';

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string) =>
  checks.push({ name, pass, detail });

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
  const recs = coch.records;

  console.log(`COCH: ${recs.length} records, ${coch.fields.length} fields\n`);

  const teamByTgid = new Map(team.records.map((t) => [num(t.TGID), t]));
  const employed = recs.filter((r) => num(r.TGID) !== NO_TEAM);
  const free = recs.filter((r) => num(r.TGID) === NO_TEAM);
  const rostered = new Set(play.records.map((p) => playerTeam(num(p.PGID))));

  // --- Structure ------------------------------------------------------------
  const sorted = [...coch.fields].sort((a, b) => a.bitOffset - b.bitOffset);
  let cursor = 0;
  let gaps = 0;
  for (const f of sorted) {
    if (f.bitOffset !== cursor) gaps++;
    cursor += f.bits;
  }
  check(
    'fields tile the record with no gaps or overlaps',
    gaps === 0,
    `bits 0..${cursor - 1} of ${coch.header.recordLenBytes * 8}`,
  );

  check(
    'CCID is a primary key',
    new Set(recs.map((r) => num(r.CCID))).size === recs.length,
    `${new Set(recs.map((r) => num(r.CCID))).size} distinct across ${recs.length} rows`,
  );
  check(
    'every coach has a last name',
    recs.every((r) => str(r.CLLN).length > 0),
    `${recs.filter((r) => str(r.CLFN).length > 0).length}/${recs.length} also have a first name ` +
      `(this save uses generic placeholders)`,
  );

  // --- Employment -----------------------------------------------------------
  check(
    'TGID is either a real team or the 511 free-agent sentinel',
    recs.every((r) => teamByTgid.has(num(r.TGID)) || num(r.TGID) === NO_TEAM),
    `${employed.length} employed, ${free.length} free agents`,
  );

  const coachedTeams = new Map<number, number>();
  for (const r of employed) {
    coachedTeams.set(num(r.TGID), (coachedTeams.get(num(r.TGID)) ?? 0) + 1);
  }
  check(
    'no team has more than one coach',
    [...coachedTeams.values()].every((c) => c === 1),
    `${coachedTeams.size} teams have exactly one coach`,
  );
  check(
    'every FBS team has a head coach',
    [...rostered].every((t) => coachedTeams.has(t)),
    `${[...rostered].filter((t) => coachedTeams.has(t)).length}/${rostered.size} FBS teams covered`,
  );

  // --- Cross-table agreement with TEAM --------------------------------------
  // A coach's prestige mirrors his program's. This is the single strongest
  // signal that COCH.TGID is decoded correctly: 119 independent agreements.
  const prestigeMatch = employed.filter(
    (r) => num(r.CPRE) === num(teamByTgid.get(num(r.TGID))!.TMPR),
  ).length;
  check(
    'CPRE mirrors the team prestige in TEAM.TMPR',
    prestigeMatch / employed.length > 0.98,
    `${prestigeMatch}/${employed.length} exact matches`,
  );
  // Scoped to FBS: the lone coach attached to an FCS team (E Washington) sits
  // outside the prestige system entirely and carries CPRE=0, same as a free agent.
  const fbsCoaches = employed.filter((r) => rostered.has(num(r.TGID)));
  check(
    'CPRE is within the 1-6 prestige range for FBS head coaches',
    fbsCoaches.every((r) => num(r.CPRE) >= TEAM_PRESTIGE_MIN && num(r.CPRE) <= TEAM_PRESTIGE_MAX),
    `range ${Math.min(...fbsCoaches.map((r) => num(r.CPRE)))}..` +
      `${Math.max(...fbsCoaches.map((r) => num(r.CPRE)))} across ${fbsCoaches.length} FBS coaches; ` +
      `the ${employed.length - fbsCoaches.length} non-FBS employed coach has CPRE=0`,
  );
  check(
    'free agents carry no prestige',
    free.every((r) => num(r.CPRE) === 0),
    `all ${free.length} unattached coaches have CPRE=0`,
  );

  // --- Playbooks ------------------------------------------------------------
  const offMatch = employed.filter(
    (r) => num(r.CPID) === num(teamByTgid.get(num(r.TGID))!.TOPB),
  ).length;
  check(
    'CPID is the offensive playbook, matching TEAM.TOPB',
    offMatch / employed.length > 0.98,
    `${offMatch}/${employed.length} exact matches`,
  );

  const fbsEmployed = fbsCoaches;
  const offIds = fbsEmployed.map((r) => num(r.CPID));
  check(
    'each FBS school has its own offensive playbook',
    new Set(offIds).size === fbsEmployed.length,
    `${new Set(offIds).size} distinct across ${fbsEmployed.length} FBS teams ` +
      `(range ${Math.min(...offIds)}..${Math.max(...offIds)})`,
  );

  const defIds = recs.map((r) => num(r.CDID));
  check(
    'CDID is a defensive playbook in the 125-129 band',
    defIds.every((v) => v >= DEFENSIVE_PLAYBOOK_MIN && v <= DEFENSIVE_PLAYBOOK_MAX),
    `${new Set(defIds).size} distinct schemes; most common is ` +
      `${[...new Map(defIds.map((v) => [v, defIds.filter((x) => x === v).length])).entries()]
        .sort((a, b) => b[1] - a[1])[0]
        .join(' used by ')} coaches`,
  );

  // Defensive scheme should shape the roster: fewer down linemen relative to
  // linebackers in a 3-4 style front than in a 4-3.
  const shape = new Map<number, { dl: number; lb: number }>();
  const rosterByTeam = new Map<number, Array<Record<string, number | string>>>();
  for (const p of play.records) {
    const t = playerTeam(num(p.PGID));
    if (!rosterByTeam.has(t)) rosterByTeam.set(t, []);
    rosterByTeam.get(t)!.push(p);
  }
  for (const r of fbsEmployed) {
    const roster = rosterByTeam.get(num(r.TGID))!;
    const d = num(r.CDID);
    if (!shape.has(d)) shape.set(d, { dl: 0, lb: 0 });
    const e = shape.get(d)!;
    e.dl += roster.filter((p) => [10, 11, 12].includes(num(p.PPOS))).length;
    e.lb += roster.filter((p) => [13, 14, 15].includes(num(p.PPOS))).length;
  }
  const ratios = new Map([...shape.entries()].map(([d, e]) => [d, e.dl / e.lb]));
  check(
    'defensive playbook correlates with roster DL/LB balance',
    (ratios.get(128) ?? 0) > (ratios.get(125) ?? 99),
    `DL:LB ratio by scheme -> ` +
      [...ratios.entries()].sort((a, b) => a[0] - b[0]).map(([d, r]) => `${d}:${r.toFixed(2)}`).join(' '),
  );

  // --- Focus allocation -----------------------------------------------------
  // CDPC/CRPC/CTPC are a three-way percentage split. Summing to exactly 100
  // for every employed coach is decisive -- it cannot happen by chance.
  const sums = employed.map((r) => num(r.CDPC) + num(r.CRPC) + num(r.CTPC));
  check(
    'CDPC + CRPC + CTPC is a percentage split summing to 100',
    sums.every((s) => s === 100),
    `all ${sums.length} employed coaches sum to exactly 100`,
  );

  // --- Slider fields --------------------------------------------------------
  for (const [field, label] of [['CDTA', 'CDTA'], ['CDTS', 'CDTS']] as const) {
    const vals = employed.map((r) => num(r[field]));
    check(
      `${label} is a slider (multiples of 5)`,
      vals.every((v) => v % 5 === 0),
      `range ${Math.min(...vals)}..${Math.max(...vals)}, ${new Set(vals).size} settings`,
    );
  }

  console.log('=== CHECKS ===');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.');

  // Context that is informative but not a pass/fail assertion.
  const constant = coch.fields.filter(
    (f) => new Set(recs.map((r) => r[f.name])).size === 1,
  ).length;
  console.log(
    `\nNote: ${constant}/${coch.fields.length} fields hold a single constant value. ` +
      `This is a preseason save, so career history (wins, titles, tenure) is all zero.`,
  );
  console.log(`Sample: ${recs.slice(0, 4).map((r) => coachName(r)).join(', ')}`);

  if (failed) process.exit(1);
}

main();

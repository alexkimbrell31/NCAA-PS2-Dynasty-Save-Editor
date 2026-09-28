/**
 * BOWL pass 2.
 *
 * Pass 1 left three fields open:
 *   UTID  -- resolves 34/34 as a TEAM.TGID, but TGID 1..80 is dense, so
 *            "it resolves" is not evidence (lesson 5). What are the teams?
 *   BMFD  -- sits in the same numeric range as SGID and equals SGID+1 on 22 of
 *            34 rows, but resolves to the *wrong* stadium when it resolves at
 *            all. Search every other table for a field that contains it.
 *   BLGO / BPLO -- two parallel 0..34 orderings. Print them together.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
  teamName,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { fields: f, recs: readRecords(buf, h, f) };
};

const bowl = load('BOWL').recs;
const team = load('TEAM').recs;
const stad = load('STAD').recs;
const teamByGid = new Map(team.map((t) => [num(t.TGID), t]));
const stadByGid = new Map(stad.map((s) => [num(s.SGID), s]));

// --- UTID: which team? -----------------------------------------------------
console.log('=== UTID resolved through TEAM.TGID, next to the venue ===');
for (const b of [...bowl].sort((a, c) => num(a.UTID) - num(c.UTID))) {
  const t = teamByGid.get(num(b.UTID));
  const s = stadByGid.get(num(b.SGID));
  console.log(
    `  UTID=${String(num(b.UTID)).padStart(2)} ${String(t ? teamName(t) : '?').padEnd(22)}` +
      `${String(b.BNME).padEnd(24)} @ ${s ? `${String(s.SCIT)}, ${String(s.SSTA)}` : '?'}`,
  );
}

// --- BMFD: does any table contain these values? ----------------------------
console.log('\n=== which (table, field) pairs contain every BMFD value? ===');
const wanted = new Set(bowl.map((b) => num(b.BMFD)));
for (const entry of toc) {
  let t;
  try {
    t = load(entry.name);
  } catch {
    continue;
  }
  if (t.recs.length === 0) continue;
  for (const f of t.fields) {
    const vals = new Set<number>();
    for (const r of t.recs) {
      const v = r[f.name];
      if (typeof v === 'number') vals.add(v);
    }
    if (vals.size === 0) continue;
    const hit = [...wanted].filter((w) => vals.has(w)).length;
    if (hit === wanted.size && entry.name !== 'BOWL') {
      console.log(`  ${entry.name}.${f.name} contains all ${wanted.size} BMFD values (${vals.size} distinct)`);
    }
  }
}

// --- BLGO / BPLO orderings -------------------------------------------------
console.log('\n=== BLGO order            | BPLO order ===');
const byLgo = [...bowl].sort((a, c) => num(a.BLGO) - num(c.BLGO));
const byPlo = [...bowl].sort((a, c) => num(a.BPLO) - num(c.BPLO));
for (let i = 0; i < bowl.length; i++) {
  console.log(
    `  ${String(num(byLgo[i].BLGO)).padStart(2)} ${String(byLgo[i].BNME).padEnd(24)}` +
      `| ${String(num(byPlo[i].BPLO)).padStart(2)} ${String(byPlo[i].BNME)}`,
  );
}
const lgo = new Set(bowl.map((b) => num(b.BLGO)));
const plo = new Set(bowl.map((b) => num(b.BPLO)));
console.log(
  `\nBLGO gaps in 0..34: ${[...Array(35).keys()].filter((i) => !lgo.has(i)).join(',')}` +
    `   BPLO gaps: ${[...Array(35).keys()].filter((i) => !plo.has(i)).join(',')}`,
);

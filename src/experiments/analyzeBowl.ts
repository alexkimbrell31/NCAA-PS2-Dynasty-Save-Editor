/**
 * BOWL pass 1 -- identify the five fields whose meaning is not obvious from the
 * mnemonic: BMFD, BLGO, BPLO, UTID and BIDX.
 *
 * Every one of them has exactly 34 distinct values across 34 records, so each
 * is *some* kind of per-bowl unique id. Distinctness alone therefore tells us
 * nothing (lesson 6) -- what discriminates is whether a field resolves against
 * another table, and whether its ordering means something.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));
const load = (name: string) => {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
};

const bowl = load('BOWL');
const stad = load('STAD');
const stadByGid = new Map(stad.map((r) => [num(r.SGID), r]));

// --- BMFD vs SGID ----------------------------------------------------------
console.log('=== BMFD compared with SGID ===');
const deltas = new Map<number, number>();
for (const b of bowl) {
  const d = num(b.BMFD) - num(b.SGID);
  deltas.set(d, (deltas.get(d) ?? 0) + 1);
}
console.log(
  `BMFD - SGID: ${[...deltas].sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d}x${c}`).join(' ')}`,
);
console.log('\nrows where BMFD - SGID != 1, and the 2 bowls whose SGID misses STAD:');
for (const b of bowl) {
  const st = stadByGid.get(num(b.SGID));
  if (num(b.BMFD) - num(b.SGID) !== 1 || !st) {
    console.log(
      `  ${String(b.BNME).padEnd(24)} SGID=${String(num(b.SGID)).padStart(3)} ` +
        `BMFD=${String(num(b.BMFD)).padStart(3)} -> ${st ? String(st.SNAM) : 'NO STAD ROW'}` +
        `   BMFD resolves? ${stadByGid.has(num(b.BMFD)) ? String(stadByGid.get(num(b.BMFD))!.SNAM) : 'no'}`,
    );
  }
}

// --- the index-like fields -------------------------------------------------
console.log('\n=== index-like fields, ordered by BIDX ===');
console.log('BIDX BLGO BPLO UTID SGNM SEWN  name');
for (const b of [...bowl].sort((a, c) => num(a.BIDX) - num(c.BIDX))) {
  console.log(
    `${String(num(b.BIDX)).padStart(4)} ${String(num(b.BLGO)).padStart(4)} ` +
      `${String(num(b.BPLO)).padStart(4)} ${String(num(b.UTID)).padStart(4)} ` +
      `${String(num(b.SGNM)).padStart(4)} ${String(num(b.SEWN)).padStart(4)}  ${String(b.BNME)}`,
  );
}

// --- do BLGO / BPLO / UTID track BIDX? -------------------------------------
console.log('\n=== relationships between the index-like fields ===');
const byIdx = [...bowl].sort((a, c) => num(a.BIDX) - num(c.BIDX));
for (const f of ['BLGO', 'BPLO', 'UTID', 'BMFD', 'SGID'] as const) {
  const vals = byIdx.map((b) => num(b[f]));
  const monotonic = vals.every((v, i) => i === 0 || v > vals[i - 1]);
  const contiguous =
    Math.max(...vals) - Math.min(...vals) === vals.length - 1;
  console.log(
    `${f}: monotonic-in-BIDX=${monotonic} contiguous-range=${contiguous} ` +
      `range=${Math.min(...vals)}..${Math.max(...vals)}  first8=${vals.slice(0, 8).join(',')}`,
  );
}

// --- UTID: is it a team id? ------------------------------------------------
// The name suggests "user team id", but every record has a different value and
// the range 1..80 is far too small for TGID. Check both readings.
const team = load('TEAM');
const tgids = new Set(team.map((t) => num(t.TGID)));
const utidResolves = bowl.filter((b) => tgids.has(num(b.UTID))).length;
console.log(
  `\nUTID values that exist as a TEAM.TGID: ${utidResolves}/34 ` +
    `(range ${Math.min(...bowl.map((b) => num(b.UTID)))}..${Math.max(...bowl.map((b) => num(b.UTID)))}, all distinct)`,
);

/**
 * PSKI (kicking/punting) + PSKP (returns), and the last TSSE field tsty.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam, PLAYER_POSITIONS,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { f, rows: readRecords(buf, h, f) as any[] };
};
const pski = load('PSKI').rows, pskp = load('PSKP').rows;
const psde = load('PSDE').rows;
const play = load('PLAY').rows;
const T = load('TSSE'); const tsse = T.rows;
const team = load('TEAM').rows;
const nameOf = new Map(team.map(t => [t.TGID, t.TDNA]));
const posOf = new Map(play.map(p => [p.PGID, PLAYER_POSITIONS[p.PPOS]]));
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);

const chk = (label: string, rows: any[], f: (r: any) => boolean, filter?: (r: any) => boolean) => {
  const set = filter ? rows.filter(filter) : rows;
  let ok = 0; for (const r of set) if (f(r)) ok++;
  console.log(`${ok === set.length ? 'PASS' : '    '} ${label}: ${ok}/${set.length}`);
};

console.log('=== PSKI: field goal buckets ===');
const aBk = ['skaa', 'skab', 'skac', 'skad', 'skae'];
const mBk = ['skma', 'skmb', 'skmc', 'skmd', 'skme'];
chk('skfa == sum of 5 attempt buckets', pski, r => r.skfa === aBk.reduce((s, k) => s + r[k], 0));
chk('skfm == sum of 5 made buckets', pski, r => r.skfm === mBk.reduce((s, k) => s + r[k], 0));
chk('made <= att per bucket', pski, r => aBk.every((k, i) => r[mBk[i]] <= r[k]));
chk('skfm <= skfa', pski, r => r.skfm <= r.skfa);
chk('skem <= skea (XP)', pski, r => r.skem <= r.skea);
chk('skfL>0 requires a made FG', pski, r => (r.skfL > 0) === (r.skfm > 0));

console.log('\n--- does skfL land in the top nonzero bucket? (pins bucket ORDER) ---');
// bucket a..e = increasing distance? then long FG should be in highest made bucket
const ranges = [[17, 29], [30, 39], [40, 49], [50, 59], [60, 99]];
for (const [i, lo] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] as any) {
  let consistent = 0, tot = 0;
  for (const r of pski) {
    if (r.skfm === 0) continue;
    let top = -1;
    for (let b = 0; b < 5; b++) if (r[mBk[b]] > 0) top = b;
    if (top !== i) continue;
    tot++;
    const [lo2, hi2] = ranges[i];
    if (r.skfL >= lo2 && r.skfL <= hi2) consistent++;
  }
  if (tot) console.log(`  top made bucket ${'abcde'[i]} -> long FG in ${ranges[i][0]}-${ranges[i][1]}: ${consistent}/${tot}`);
}

console.log('\n--- punting ---');
chk('spya >= spny (gross >= net)', pski, r => r.spya >= r.spny, r => r.spat > 0);
chk('spat>0 iff spya>0', pski, r => (r.spat > 0) === (r.spya > 0));
chk('splN <= spya', pski, r => r.splN <= r.spya, r => r.spat > 0);
chk('avg punt 25-55 yds', pski, r => r.spya / r.spat >= 25 && r.spya / r.spat <= 55, r => r.spat > 0);
chk('sptb (TB) <= spat', pski, r => r.sptb <= r.spat);
chk('sppt (in20) <= spat', pski, r => r.sppt <= r.spat);
chk('sktb <= sknk (KO touchbacks)', pski, r => r.sktb <= r.sknk);

console.log('\n--- PSKI positions ---');
const kpos = (key: string) => {
  const m = new Map<string, number>();
  for (const r of pski) if (r[key] > 0) { const p = posOf.get(r.PGID) ?? '?'; m.set(p, (m.get(p) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join(' ');
};
console.log('  FG attempts (skfa):', kpos('skfa'));
console.log('  punts (spat):      ', kpos('spat'));
console.log('  kickoffs (sknk):   ', kpos('sknk'));

console.log('\n=== PSKP: returns ===');
chk('srky>0 requires srka>0 (kick)', pskp, r => !(r.srky > 0 && r.srka === 0));
chk('srpy>0 requires srpa>0 (punt)', pskp, r => !(r.srpy > 0 && r.srpa === 0));
chk('srkL <= srky', pskp, r => r.srkL <= r.srky, r => r.srka > 0);
chk('srpL <= srpy', pskp, r => r.srpL <= r.srpy, r => r.srpa > 0);
chk('srkt (TD) <= srka', pskp, r => r.srkt <= r.srka);
chk('srpt (TD) <= srpa', pskp, r => r.srpt <= r.srpa);
const rpos = new Map<string, number>();
for (const r of pskp) if (r.srka + r.srpa > 0) { const p = posOf.get(r.PGID) ?? '?'; rpos.set(p, (rpos.get(p) ?? 0) + 1); }
console.log('  returner positions:', [...rpos.entries()].sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p}:${n}`).join(' '));

console.log('\n=== TSSE.tsty ===');
const sum = (rows: any[], key: (r: any) => number) => {
  const m = new Map<number, number>();
  for (const r of rows) { const t = playerTeam(r.PGID); m.set(t, (m.get(t) ?? 0) + key(r)); }
  return m;
};
const parts: Record<string, Map<number, number>> = {
  kickRet: sum(pskp, r => r.srky), puntRet: sum(pskp, r => r.srpy),
  intRet: sum(psde, r => r.ssiy), fumRet: sum(psde, r => r.slfy),
  puntGross: sum(pski, r => r.spya), puntNet: sum(pski, r => r.spny),
};
const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;
const fbs = tsse.filter(r => sum(load('PSOF').rows, x => 1).has(r.TGID));
const keys = Object.keys(parts);
for (let mask = 1; mask < (1 << keys.length); mask++) {
  const used = keys.filter((_, i) => mask & (1 << i));
  let ok = 0;
  for (const r of fbs) {
    const v = used.reduce((s, k) => s + g0(parts[k], r.TGID), 0);
    if (v === r.tsty) ok++;
  }
  if (ok >= fbs.length * 0.9) console.log(`  tsty == ${used.join(' + ')}: ${ok}/${fbs.length}`);
}
console.log('  (no line above => tsty is NOT any subset-sum of those)');

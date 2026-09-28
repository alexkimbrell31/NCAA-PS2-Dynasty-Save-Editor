import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, playerTeam,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const load = (tag: string) => {
  const h = parseTableHeader(buf, findTable(toc, tag).realOffset);
  const f = parseFieldDescriptors(buf, h);
  return { f, rows: readRecords(buf, h, f) as any[] };
};
const pski = load('PSKI').rows, pskp = load('PSKP').rows, psde = load('PSDE').rows;
const tsse = load('TSSE').rows, psof = load('PSOF').rows;
const s16 = (v: number) => (v >= 32768 ? v - 65536 : v);

const aBk = ['skaa', 'skab', 'skac', 'skad', 'skae'];
const mBk = ['skma', 'skmb', 'skmc', 'skmd', 'skme'];

console.log('=== derive FG bucket ranges empirically ===');
console.log('For kickers whose ONLY made FG bucket is X, what long-FG values occur?');
for (let b = 0; b < 5; b++) {
  const vals: number[] = [];
  for (const r of pski) {
    if (r.skfm === 0) continue;
    const made = mBk.map(k => r[k]);
    const nonzero = made.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0);
    if (nonzero.length === 1 && nonzero[0] === b && made[b] === 1) vals.push(r.skfL);
  }
  if (vals.length) {
    console.log(`  bucket ${'abcde'[b]} (exactly one made): n=${vals.length} longFG values ${[...new Set(vals)].sort((x, y) => x - y).join(',')}`);
  } else {
    console.log(`  bucket ${'abcde'[b]}: no isolated single-make sample`);
  }
}

console.log('\n--- distance bucket totals across the league ---');
for (let b = 0; b < 5; b++) {
  const att = pski.reduce((s, r) => s + r[aBk[b]], 0);
  const made = pski.reduce((s, r) => s + r[mBk[b]], 0);
  console.log(`  ${'abcde'[b]}: ${made}/${att} = ${att ? (100 * made / att).toFixed(0) : '-'}%`);
}

console.log('\n=== CONTROL for tsty ===');
const sum = (rows: any[], key: (r: any) => number) => {
  const m = new Map<number, number>();
  for (const r of rows) { const t = playerTeam(r.PGID); m.set(t, (m.get(t) ?? 0) + key(r)); }
  return m;
};
const kickRet = sum(pskp, r => r.srky), puntRet = sum(pskp, r => r.srpy);
const g0 = (m: Map<number, number>, t: number) => m.get(t) ?? 0;
const withStats = sum(psof, () => 1);
const fbs = tsse.filter(r => withStats.has(r.TGID));
let real = 0, ctrl = 0;
for (let i = 0; i < fbs.length; i++) {
  const r = fbs[i];
  if (r.tsty === g0(kickRet, r.TGID) + g0(puntRet, r.TGID)) real++;
  const wrong = fbs[(i + 1) % fbs.length].TGID;
  if (r.tsty === g0(kickRet, wrong) + g0(puntRet, wrong)) ctrl++;
}
console.log(`  tsty == kickRet+puntRet, TRUE team: ${real}/${fbs.length}`);
console.log(`  CONTROL shifted team:               ${ctrl}/${fbs.length}`);

console.log('\n=== TSSE remaining unknown fields: value ranges ===');
const known = new Set(['tsop', 'tsor', 'tsoy', 'tsdp', 'tsdy', 'tsTy', 'tsty', 'tsPy', 'tspe', 'tssk', 'tsDi', 'tspi', 'tsfr', 'TGID', 'tsPi', 'tspd']);
for (const f of load('TSSE').f as any[]) {
  if (known.has(f.name)) continue;
  const vals = tsse.map(r => r[f.name]);
  const nz = vals.filter(v => v !== 0).length;
  console.log(`  ${f.name.padEnd(5)} (${String(f.bits).padStart(2)}b) nonzero ${String(nz).padStart(3)}/109 range ${Math.min(...vals)}..${Math.max(...vals)}`);
}

console.log('\n--- test third/fourth down conversions ---');
const chk = (l: string, f: (r: any) => boolean) => {
  let ok = 0; for (const r of tsse) if (f(r)) ok++;
  console.log(`${ok === tsse.length ? 'PASS' : '    '} ${l}: ${ok}/${tsse.length}`);
};
chk('ts3c <= ts3d (3rd conv <= 3rd att)', r => r.ts3c <= r.ts3d);
chk('ts4c <= ts4d (4th conv <= 4th att)', r => r.ts4c <= r.ts4d);
chk('ts2c <= ts2a (2pt)', r => r.ts2c <= r.ts2a);
chk('ts3d in 5..25 (3rd downs per game)', r => r.ts3d >= 5 && r.ts3d <= 25);
chk('ts1d in 5..40 (first downs)', r => r.ts1d >= 5 && r.ts1d <= 40);
chk('tsfl <= tsof? (fumbles lost)', r => r.tsfl <= r.tsof + r.tsfl);

console.log('\n--- fumbles: tsof/tsdf/tsfl/tsfr/tsdr ---');
const ff = sum(psde, r => r.slff), fr = sum(psde, r => r.slfr);
let a = 0, b2 = 0, c = 0;
for (const r of fbs) {
  if (r.tsfr === g0(fr, r.TGID)) a++;
  if (r.tsdf === g0(ff, r.TGID)) b2++;
  if (r.tsdr === g0(fr, r.TGID)) c++;
}
console.log(`  tsfr == fum recovered: ${a}/${fbs.length}`);
console.log(`  tsdf == forced fumbles: ${b2}/${fbs.length}`);
console.log(`  tsdr == fum recovered: ${c}/${fbs.length}`);

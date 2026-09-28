/**
 * BOWL gives a real calendar date (BMON/BDAY) for all 34 postseason slots, and
 * those slots join 34/34 to SCHD rows on (SEWN, SGNM). That makes BOWL an
 * independent witness for SCHD.GDAT -- which was previously anchored on a
 * single observation (the eight week-20 games carry GDAT=0, and Jan 1 2007 was
 * a Monday).
 *
 * One observation is not a fit. Here we check every bowl.
 */
import {
  findTable,
  parseFieldDescriptors,
  parseFileHeader,
  parseTableHeader,
  parseToc,
  NO_TEAM,
  readRecords,
  readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const header = parseFileHeader(buf);
const toc = parseToc(buf, header);
const num = (v: number | string) => (typeof v === 'number' ? v : Number(v));

function load(name: string) {
  const e = findTable(toc, name);
  const h = parseTableHeader(buf, e.realOffset);
  const f = parseFieldDescriptors(buf, h);
  return readRecords(buf, h, f);
}

const schd = load('SCHD');
const bowl = load('BOWL');

const schdByKey = new Map(
  schd
    .filter((r) => num(r.GHTG) === NO_TEAM && num(r.GATG) === NO_TEAM)
    .map((r) => [`${num(r.SEWN)}:${num(r.SGNM)}`, r]),
);

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// JS getDay(): 0 = Sunday. Convert to Monday-based.
const mondayBased = (d: Date) => (d.getDay() + 6) % 7;

let agree = 0;
let disagree = 0;
const offsets = new Map<number, number>();

console.log('bowl                      BOWL date   real day   GDAT  reads as');
for (const b of bowl) {
  const s = schdByKey.get(`${num(b.SEWN)}:${num(b.SGNM)}`);
  if (!s) continue;
  const mon = num(b.BMON);
  const day = num(b.BDAY);
  // Bowl season straddles the new year: Dec 2006, Jan 2007.
  const year = mon >= 7 ? 2006 : 2007;
  const real = mondayBased(new Date(year, mon - 1, day));
  const gdat = num(s.GDAT);
  const off = (gdat - real + 7) % 7;
  offsets.set(off, (offsets.get(off) ?? 0) + 1);
  if (off === 0) agree++;
  else disagree++;
  console.log(
    `  ${String(b.BNME).padEnd(24)} ${String(mon).padStart(2)}/${String(day).padStart(2)}/${year}  ` +
      `${DAYS[real].padEnd(9)} ${String(gdat).padStart(4)}  ${DAYS[gdat] ?? '?'}` +
      `${off === 0 ? '' : `   <-- off by ${off}`}`,
  );
}

console.log(`\nagree ${agree} / disagree ${disagree}`);
console.log(
  `offset histogram: ${[...offsets]
    .sort((a, b) => a[0] - b[0])
    .map(([o, c]) => `+${o}: ${c}`)
    .join('  ')}`,
);

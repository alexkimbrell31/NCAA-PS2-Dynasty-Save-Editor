import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const buffer = fs.readFileSync(filePath);

// Confirmed structure from manual hex inspection:
// record = 68 bytes: [4B header][4B val-pair][2B 0xFFFF sentinel][10B FirstName][13B LastName][35B packed binary]
const RECORD_START0 = 0x169E28;
const RECORD_BYTES = 68;
const NAME_OFFSET = 10; // firstname starts at relative offset 10
const FIRSTNAME_LEN = 10;
const LASTNAME_LEN = 13;
const BINARY_OFFSET = NAME_OFFSET + FIRSTNAME_LEN + LASTNAME_LEN; // 33
const BINARY_LEN = RECORD_BYTES - BINARY_OFFSET; // 35

function readCString(buf: Buffer, offset: number, maxLen: number): string {
  let end = offset;
  while (end < offset + maxLen && buf[end] !== 0) end++;
  return buf.toString('ascii', offset, end);
}

function isPlausibleName(s: string): boolean {
  return /^[A-Za-z.' -]{2,}$/.test(s);
}

interface Rec {
  index: number;
  start: number;
  first: string;
  last: string;
  binary: Buffer;
}

const records: Rec[] = [];
for (let i = 0; i < 200; i++) {
  const start = RECORD_START0 + i * RECORD_BYTES;
  if (start + RECORD_BYTES > buffer.length) break;
  const first = readCString(buffer, start + NAME_OFFSET, FIRSTNAME_LEN);
  const last = readCString(buffer, start + NAME_OFFSET + FIRSTNAME_LEN, LASTNAME_LEN);
  if (!isPlausibleName(first) || first.length === 0) break;
  const binary = buffer.subarray(start + BINARY_OFFSET, start + BINARY_OFFSET + BINARY_LEN);
  records.push({ index: i, start, first, last, binary });
}

console.log(`Total contiguous plausible records found: ${records.length}`);
console.log('Names:', records.map(r => `${r.first} ${r.last}`).join(', '));

// MSB-first bit reader over the 35-byte binary blob
function readBits(buf: Buffer, startBit: number, width: number): number {
  let value = 0;
  for (let i = 0; i < width; i++) {
    const bitIndex = startBit + i;
    const byteIndex = bitIndex >> 3;
    if (byteIndex >= buf.length) return NaN;
    const bitInByte = bitIndex & 7;
    const bit = (buf[byteIndex] >> (7 - bitInByte)) & 1;
    value = (value << 1) | bit;
  }
  return value >>> 0;
}

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map(x => (x - m) ** 2)));
}

const BINARY_BITS = BINARY_LEN * 8; // 280 bits
const candidates: { startBit: number; width: number; mean: number; stddev: number; min: number; max: number; inRangeFrac: number }[] = [];

for (let width = 5; width <= 8; width++) {
  const maxVal = 2 ** width - 1;
  for (let startBit = 0; startBit + width <= BINARY_BITS; startBit++) {
    const values = records.map(r => readBits(r.binary, startBit, width));
    if (values.some(v => Number.isNaN(v))) continue;
    const inRange = values.filter(v => v >= 30 && v <= Math.min(99, maxVal)).length / values.length;
    const sd = stddev(values);
    if (inRange > 0.85 && sd > 3) {
      candidates.push({
        startBit,
        width,
        mean: mean(values),
        stddev: sd,
        min: Math.min(...values),
        max: Math.max(...values),
        inRangeFrac: inRange
      });
    }
  }
}

candidates.sort((a, b) => (b.inRangeFrac * b.stddev) - (a.inRangeFrac * a.stddev));

console.log(`\nCandidate rating-like fields (bounded 30-99, stddev>3): ${candidates.length}`);
console.table(candidates.slice(0, 15).map(c => ({
  startBit: c.startBit,
  byteOffset: (BINARY_OFFSET + Math.floor(c.startBit / 8)).toString(16),
  width: c.width,
  mean: c.mean.toFixed(1),
  stddev: c.stddev.toFixed(1),
  min: c.min,
  max: c.max,
  inRangeFrac: c.inRangeFrac.toFixed(2)
})));

// Re-rank favoring PERFECT range compliance (inRangeFrac === 1) over raw stddev,
// since out-of-range outliers indicate a misaligned/wrong field, not real signal.
const perfect = candidates.filter(c => c.inRangeFrac === 1).sort((a, b) => b.stddev - a.stddev);
console.log(`\nCandidates with perfect 30-99 range compliance: ${perfect.length}`);
console.table(perfect.map(c => ({
  startBit: c.startBit,
  byteOffset: (BINARY_OFFSET + Math.floor(c.startBit / 8)).toString(16),
  width: c.width,
  mean: c.mean.toFixed(1),
  stddev: c.stddev.toFixed(1),
  min: c.min,
  max: c.max
})));

for (const top of perfect.slice(0, 3)) {
  console.log(`\n=== Field startBit=${top.startBit}, width=${top.width} (byteOffset 0x${(BINARY_OFFSET + Math.floor(top.startBit / 8)).toString(16)}) ===`);
  console.table(records.map(r => ({
    name: `${r.first} ${r.last}`,
    value: readBits(r.binary, top.startBit, top.width)
  })));
}

// ---- Position field sweep ----
// Positions are a small, low-cardinality enum (~10-25 distinct values, range 0-31),
// unlike the continuous rating field. Sweep small widths (3-6 bits) for fields with
// a plausible enum-like distribution: several distinct values, none dominating >90%,
// and not overlapping the already-identified rating field bits.
const RATING_START_BIT = 57;
const RATING_WIDTH = 7;

interface PosCandidate {
  startBit: number;
  width: number;
  distinct: number;
  min: number;
  max: number;
  maxFrac: number; // fraction of records taking the most common value
}

const posCandidates: PosCandidate[] = [];
for (let width = 3; width <= 6; width++) {
  const maxVal = 2 ** width - 1;
  for (let startBit = 0; startBit + width <= BINARY_BITS; startBit++) {
    // skip bits overlapping the confirmed rating field
    if (startBit + width > RATING_START_BIT && startBit < RATING_START_BIT + RATING_WIDTH) continue;
    const values = records.map(r => readBits(r.binary, startBit, width));
    if (values.some(v => Number.isNaN(v))) continue;
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    const distinct = counts.size;
    const maxFrac = Math.max(...counts.values()) / values.length;
    if (distinct >= 6 && distinct <= 26 && maxFrac < 0.5) {
      posCandidates.push({
        startBit,
        width,
        distinct,
        min: Math.min(...values),
        max: Math.max(...values),
        maxFrac
      });
    }
  }
}

// Prefer more distinct values (closer to real position-count diversity) with a low
// "most common value" fraction (i.e., not dominated by one repeated value/padding).
posCandidates.sort((a, b) => (b.distinct - a.distinct) || (a.maxFrac - b.maxFrac));

console.log(`\nCandidate position-like fields (6-26 distinct values, no value >50% dominant): ${posCandidates.length}`);
console.table(posCandidates.slice(0, 15).map(c => ({
  startBit: c.startBit,
  byteOffset: (BINARY_OFFSET + Math.floor(c.startBit / 8)).toString(16),
  width: c.width,
  distinct: c.distinct,
  min: c.min,
  max: c.max,
  maxFrac: c.maxFrac.toFixed(2)
})));

if (posCandidates.length > 0) {
  const topPos = posCandidates[0];
  console.log(`\n=== Top position candidate: startBit=${topPos.startBit}, width=${topPos.width} (byteOffset 0x${(BINARY_OFFSET + Math.floor(topPos.startBit / 8)).toString(16)}) ===`);
  console.table(records.map(r => ({
    name: `${r.first} ${r.last}`,
    rating: readBits(r.binary, RATING_START_BIT, RATING_WIDTH),
    positionCode: readBits(r.binary, topPos.startBit, topPos.width)
  })));

  // Also inspect the cleanest width=5 (0-31 range) candidates, since NCAA position
  // enums typically fit in 5 bits (~20-25 distinct positions) without gaps.
  const width5Clean = posCandidates.filter(c => c.width === 5 && c.min === 0 && c.max === 31);
  for (const c of width5Clean.slice(0, 3)) {
    console.log(`\n--- width=5 candidate startBit=${c.startBit} (byteOffset 0x${(BINARY_OFFSET + Math.floor(c.startBit / 8)).toString(16)}) ---`);
    console.table(records.map(r => ({
      name: `${r.first} ${r.last}`,
      rating: readBits(r.binary, RATING_START_BIT, RATING_WIDTH),
      positionCode: readBits(r.binary, c.startBit, c.width)
    })));
  }
}

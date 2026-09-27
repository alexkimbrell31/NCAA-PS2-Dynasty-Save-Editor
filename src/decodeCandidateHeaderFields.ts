import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const buffer = fs.readFileSync(filePath);

// Candidate header found by findTableHeader.ts
const HEADER_OFFSET = 0x136771;
const TABLE_HEADER_SIZE = 40;
const TABLE_FIELD_SIZE = 16;
const NUM_FIELDS = 74;
const FIELD_START = HEADER_OFFSET + TABLE_HEADER_SIZE; // 0x136C39... but let's read fresh

console.log(`Header offset: 0x${HEADER_OFFSET.toString(16).toUpperCase()}`);
console.log(`Field start:   0x${(HEADER_OFFSET + TABLE_HEADER_SIZE).toString(16).toUpperCase()}`);

// Try OUR layout: [4-char name @0][4 unknown @4][4-byte typeFlag LE @8][4-byte bitOffset LE @12]
console.log('\n=== Interpretation A: name@0, typeFlag@8, bitOffset@12 (our own convention) ===');
{
  const fieldStart = HEADER_OFFSET + TABLE_HEADER_SIZE;
  for (let i = 0; i < NUM_FIELDS; i++) {
    const o = fieldStart + i * TABLE_FIELD_SIZE;
    const name = buffer.toString('ascii', o, o + 4);
    const typeFlag = buffer.readUInt32LE(o + 8);
    const bitOffset = buffer.readUInt32LE(o + 12);
    console.log(`  [${i}] name="${name}" typeFlag=${typeFlag} bitOffset=${bitOffset}`);
  }
}

// Try MADDEN layout: [3 reserved][4-byte type @3][4-byte bitOffset @7][4-char name @11][1-byte bits @15]
console.log('\n=== Interpretation B: type@3, bitOffset@7, name@11, bits(byte)@15 (madden-db-editor convention) ===');
{
  const fieldStart = HEADER_OFFSET + TABLE_HEADER_SIZE;
  for (let i = 0; i < NUM_FIELDS; i++) {
    const o = fieldStart + i * TABLE_FIELD_SIZE;
    const type = buffer.readUInt32LE(o + 3);
    const bitOffset = buffer.readUInt32LE(o + 7);
    const name = buffer.toString('ascii', o + 11, o + 15);
    const bits = buffer[o + 15];
    console.log(`  [${i}] name="${name}" type=${type} bitOffset=${bitOffset} bits=${bits}`);
  }
}

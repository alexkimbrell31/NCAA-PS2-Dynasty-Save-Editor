import * as fs from 'fs';
import * as path from 'path';

interface PlayField {
  index: number;
  fieldName: string;
  fieldOffsetHex: string;
  bitOffset: number;
  typeFlag: number;
  bitWidth: number;
}

const saveFilePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const schemaFilePath = path.join(__dirname, '..', 'play_schema.json');

/**
 * Reads specified bits from a buffer in Big-Endian bit order (MSB first)
 */
function readBits(buffer: Buffer, startBitOffset: number, bitWidth: number): number {
  let value = 0;
  for (let i = 0; i < bitWidth; i++) {
    const currentBit = startBitOffset + i;
    const byteIndex = Math.floor(currentBit / 8);
    const bitInByte = 7 - (currentBit % 8);
    const bit = (buffer[byteIndex] >> bitInByte) & 1;
    value = (value << 1) | bit;
  }
  return value;
}

function decodePlayerRecords(recordCountToRead: number = 10) {
  if (!fs.existsSync(saveFilePath) || !fs.existsSync(schemaFilePath)) {
    console.error('Save file or play_schema.json not found.');
    return;
  }

  const buffer = fs.readFileSync(saveFilePath);
  const schema: PlayField[] = JSON.parse(fs.readFileSync(schemaFilePath, 'utf-8'));

  const RECORD_BIT_SIZE = 366;
  const RECORD_BYTE_SIZE = Math.ceil(RECORD_BIT_SIZE / 8); // 46 bytes

  // Locate data region start (immediately following the last schema field header at 0x018A8C)
  // EA DB aligns data blocks to paragraph boundaries (typically 16 or 64 byte alignment)
  let dataStartOffset = 0x018A8C + 16;
  while (dataStartOffset % 16 !== 0) {
    dataStartOffset++;
  }

  console.log(`\n========================================`);
  console.log(`Decoding First ${recordCountToRead} Player Records`);
  console.log(`Data Block Offset: 0x${dataStartOffset.toString(16).toUpperCase()}`);
  console.log(`Record Length: ${RECORD_BIT_SIZE} bits (${RECORD_BYTE_SIZE} bytes)`);
  console.log(`========================================\n`);

  const decodedRecords: Array<Record<string, number>> = [];

  for (let r = 0; r < recordCountToRead; r++) {
    const recordStartBit = (dataStartOffset * 8) + (r * RECORD_BIT_SIZE);
    const playerRecord: Record<string, number> = { _recordIndex: r };

    for (const field of schema) {
      const fieldBitOffset = recordStartBit + field.bitOffset;
      const rawValue = readBits(buffer, fieldBitOffset, field.bitWidth);
      playerRecord[field.fieldName] = rawValue;
    }

    decodedRecords.push(playerRecord);
  }

  console.table(
    decodedRecords.map(r => ({
      Idx: r._recordIndex,
      Pos: r.PPOS,
      Ovr: r.POVR,
      Spd: r.PPSP,
      FirstNameID: r.FSPN,
      LastNameID: r.LSPN,
      WeightGroup: r.WGTS
    }))
  );
}

decodePlayerRecords(10);
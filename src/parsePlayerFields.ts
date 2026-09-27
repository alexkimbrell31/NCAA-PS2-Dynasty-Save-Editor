import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

export interface PlayField {
  index: number;
  fieldName: string;
  fieldOffsetHex: string;
  bitOffset: number;
  typeFlag: number;
  bitWidth: number;
}

function parseAndDecodePlayTable() {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    return;
  }

  const buffer = fs.readFileSync(filePath);

  // 1. Locate PLAY schema block
  const povrOffset = 0x018A5C;
  let startOffset = povrOffset;

  // Walk backward to first field descriptor
  while (startOffset > 0x018000) {
    const code = buffer.toString('ascii', startOffset - 16, startOffset - 12);
    const typeFlag = buffer.readUInt32LE(startOffset - 8);
    const bitOffset = buffer.readUInt32LE(startOffset - 4);

    if (/^[A-Za-z0-9_]{4}$/.test(code) && typeFlag <= 5 && bitOffset < 1000) {
      startOffset -= 16;
    } else {
      break;
    }
  }

  // Walk forward to last field descriptor
  let endOffset = povrOffset;
  while (endOffset < 0x019000) {
    const code = buffer.toString('ascii', endOffset, endOffset + 4);
    const typeFlag = buffer.readUInt32LE(endOffset + 8);
    const bitOffset = buffer.readUInt32LE(endOffset + 12);

    if (/^[A-Za-z0-9_]{4}$/.test(code) && typeFlag <= 5 && bitOffset < 1000) {
      endOffset += 16;
    } else {
      break;
    }
  }

  const rawFields: Omit<PlayField, 'index' | 'bitWidth'>[] = [];
  for (let offset = startOffset; offset < endOffset; offset += 16) {
    const fieldName = buffer.toString('ascii', offset, offset + 4);
    const typeFlag = buffer.readUInt32LE(offset + 8);
    const bitOffset = buffer.readUInt32LE(offset + 12);

    rawFields.push({
      fieldName,
      fieldOffsetHex: `0x${offset.toString(16).toUpperCase().padStart(6, '0')}`,
      bitOffset,
      typeFlag
    });
  }

  // Sort sequentially by bitOffset
  rawFields.sort((a, b) => a.bitOffset - b.bitOffset);

  // Total record bit length is 366 bits
  const TOTAL_RECORD_BITS = 366;

  const schema: PlayField[] = rawFields.map((field, idx) => {
    let bitWidth = 0;
    if (idx < rawFields.length - 1) {
      bitWidth = rawFields[idx + 1].bitOffset - field.bitOffset;
    } else {
      bitWidth = TOTAL_RECORD_BITS - field.bitOffset; // WGTS = 7 bits (359..365)
    }

    return {
      index: idx,
      ...field,
      bitWidth
    };
  });

  console.log(`\n========================================`);
  console.log(`PLAY Table Schema Successfully Resolved (${schema.length} Fields)`);
  console.log(`========================================\n`);
  console.table(schema);

  // Save finalized JSON schema
  const schemaPath = path.join(__dirname, '..', 'play_schema.json');
  fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2));
  console.log(`\nSaved updated schema definition to: ${schemaPath}`);
}

parseAndDecodePlayTable();
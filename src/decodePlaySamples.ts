import * as fs from 'fs';
import * as path from 'path';
import { readBits } from './scoreRecordAlignment';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const schemaRunsPath = path.join(__dirname, '..', 'analysis', 'schemaDescriptorRuns.json');

interface RawField {
  fieldName: string;
  typeFlag: number;
  bitOffset: number;
}
interface SchemaRun {
  startOffsetHex: string;
  fields: RawField[];
}

const buffer = fs.readFileSync(filePath);
const runs: SchemaRun[] = JSON.parse(fs.readFileSync(schemaRunsPath, 'utf8'));
const run61 = runs.find(r => r.startOffsetHex === '0x0EEBA0');
if (!run61) throw new Error('run61 not found');

const sorted = [...run61.fields].sort((a, b) => a.bitOffset - b.bitOffset);
const RECORD_BYTES = 56;
const RECORD_BITS = RECORD_BYTES * 8;
const withWidth = sorted.map((f, i) => {
  const next = sorted[i + 1];
  const width = next ? next.bitOffset - f.bitOffset : RECORD_BITS - f.bitOffset;
  return { ...f, width };
});

const DATA_START = 0x0EF1B7;
const NUM_RECORDS = 15;

const showFields = ['RCHD', 'PGID', 'POVR', 'PSTR', 'PAWR', 'PHGT', 'PWGT', 'PPOS', 'PCAR', 'PYER', 'PJEN', 'PTEN'];

for (let r = 0; r < NUM_RECORDS; r++) {
  const recordStart = DATA_START + r * RECORD_BYTES;
  const row: Record<string, number> = {};
  for (const f of withWidth) {
    if (!showFields.includes(f.fieldName)) continue;
    row[f.fieldName] = readBits(buffer, recordStart * 8 + f.bitOffset, f.width);
  }
  console.log(`record ${r} @ 0x${recordStart.toString(16)}:`, row);
}

import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const tableDirectoryPath = path.join(__dirname, '..', 'analysis', 'tableDirectory.json');
const schemaRunsPath = path.join(__dirname, '..', 'analysis', 'schemaDescriptorRuns.json');
const outputPath = path.join(__dirname, '..', 'analysis', 'pnluDump.json');

interface TableDirectoryEntry {
  name: string;
  pointer: number;
  pointerHex: string;
  rangeEnd: number | null;
  rangeLength: number | null;
  isValidPointer: boolean;
}

interface SchemaRun {
  runIndex: number;
  startOffset: number;
  startOffsetHex: string;
  endOffset: number;
  fieldCount: number;
  fields: Array<{ fieldName: string; typeFlag: number; bitOffset: number }>;
}

function main() {
  if (!fs.existsSync(filePath)) throw new Error(`Save file not found at ${filePath}`);
  if (!fs.existsSync(tableDirectoryPath)) throw new Error(`Missing ${tableDirectoryPath} — run buildTableDirectory.ts first`);
  if (!fs.existsSync(schemaRunsPath)) throw new Error(`Missing ${schemaRunsPath} — run scanSchemaDescriptors.ts first`);

  const buffer = fs.readFileSync(filePath);
  const toc: TableDirectoryEntry[] = JSON.parse(fs.readFileSync(tableDirectoryPath, 'utf8'));
  const runs: SchemaRun[] = JSON.parse(fs.readFileSync(schemaRunsPath, 'utf8'));

  const pnlu = toc.find(t => t.name === 'PNLU');
  if (!pnlu) {
    console.log('PNLU not found in tableDirectory.json');
    return;
  }

  console.log('=== PNLU table directory entry ===');
  console.log(pnlu);

  const dumpEnd = pnlu.rangeEnd ?? pnlu.pointer + 512;
  const dumpLength = Math.min(dumpEnd - pnlu.pointer, 1024);
  const region = buffer.subarray(pnlu.pointer, pnlu.pointer + dumpLength);

  console.log(`\n=== Raw bytes at PNLU pointer (${pnlu.pointerHex}), ${dumpLength} bytes ===`);
  const hexLines: string[] = [];
  for (let i = 0; i < region.length; i += 16) {
    const chunk = region.subarray(i, i + 16);
    const hex = chunk.toString('hex').match(/.{1,2}/g)?.join(' ') ?? '';
    const ascii = chunk.toString('ascii').replace(/[^\x20-\x7e]/g, '.');
    const line = `0x${(pnlu.pointer + i).toString(16).toUpperCase().padStart(6, '0')}: ${hex.padEnd(47)}  ${ascii}`;
    console.log(line);
    hexLines.push(line);
  }

  // Also check every 4-byte-uint32 word for plausible values (e.g. counts)
  console.log('\n=== Nonzero uint32 words in PNLU region ===');
  const words: Array<{ offsetHex: string; value: number }> = [];
  for (let off = pnlu.pointer; off + 4 <= pnlu.pointer + dumpLength; off += 4) {
    const val = buffer.readUInt32LE(off);
    if (val !== 0) {
      const offsetHex = `0x${off.toString(16).toUpperCase().padStart(6, '0')}`;
      words.push({ offsetHex, value: val });
      console.log(offsetHex, val, `0x${val.toString(16).toUpperCase()}`);
    }
  }

  // Check whether any known schema run starts inside or near PNLU's declared range
  const nearbyRuns = runs.filter(r => r.startOffset >= pnlu.pointer - 256 && r.startOffset <= dumpEnd + 256);
  console.log(`\n=== Schema runs starting near PNLU's range (±256 bytes) ===`);
  console.log(nearbyRuns.map(r => ({
    runIndex: r.runIndex,
    startOffsetHex: r.startOffsetHex,
    fieldCount: r.fieldCount,
    firstField: r.fields[0]?.fieldName,
    lastField: r.fields[r.fields.length - 1]?.fieldName
  })));

  const result = {
    pnlu,
    dumpLength,
    hexDump: hexLines,
    nonzeroWords: words,
    nearbySchemaRuns: nearbyRuns.map(r => ({
      runIndex: r.runIndex,
      startOffsetHex: r.startOffsetHex,
      fieldCount: r.fieldCount,
      fields: r.fields.map(f => f.fieldName)
    }))
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nSaved PNLU dump to: ${outputPath}`);
}

main();

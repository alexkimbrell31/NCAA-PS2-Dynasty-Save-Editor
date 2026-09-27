import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

interface FieldCandidate {
  name: string;
  headerOffset: string;
  metadataHex: string;
}

function inspectSchemaHeader() {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    return;
  }

  const buffer = fs.readFileSync(filePath);

  console.log(`\n========================================`);
  console.log(`Inspecting EA DB Schema Header Block`);
  console.log(`========================================\n`);

  // Schema definitions start after table directory (~0x02B0) up to table data offsets
  const schemaBlock = buffer.subarray(0x02b0, 0x5000);
  const foundFields: FieldCandidate[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < schemaBlock.length - 12; i++) {
    const candidate = schemaBlock.toString('ascii', i, i + 4);

    // EA DB field tags consist of 4 uppercase alphanumeric characters
    if (/^[A-Z0-9]{4}$/.test(candidate)) {
      // Focus on player field codes starting with 'P' (e.g. PSPD, POVR, PFNA, PLNA, PTID)
      if (candidate.startsWith('P') && !seenNames.has(candidate)) {
        seenNames.add(candidate);
        const fileOffset = 0x02b0 + i;
        const metadata = schemaBlock.subarray(i + 4, i + 12).toString('hex');

        foundFields.push({
          name: candidate,
          headerOffset: `0x${fileOffset.toString(16).toUpperCase().padStart(4, '0')}`,
          metadataHex: metadata
        });
      }
    }
  }

  console.log(`Found ${foundFields.length} unique player field codes in schema:\n`);
  console.table(foundFields);
}

inspectSchemaHeader();
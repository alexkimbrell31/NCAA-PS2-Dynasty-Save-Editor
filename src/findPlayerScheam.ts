import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

function findSchemaDefinitions() {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    return;
  }

  const buffer = fs.readFileSync(filePath);

  console.log(`\n========================================`);
  console.log(`Scanning Save File for Field Descriptors`);
  console.log(`========================================\n`);

  // 1. Search for known NCAA attribute tags across the entire header region (0x0000 - 0xEE8C8)
  const knownTags = ['PSPD', 'POVR', 'PSTR', 'PAWR', 'PPOS', 'PFNA', 'PLNA', 'PTID', 'PGID', 'PYYR'];
  console.log('--- Search for Known Player Attribute Tags ---');

  for (const tag of knownTags) {
    let index = buffer.indexOf(tag, 0);
    const occurrences: string[] = [];

    while (index !== -1 && index < 0xEE8C8) {
      occurrences.push(`0x${index.toString(16).toUpperCase().padStart(6, '0')}`);
      index = buffer.indexOf(tag, index + 1);
    }

    if (occurrences.length > 0) {
      console.log(`Tag '${tag}' found at offsets: ${occurrences.join(', ')}`);
    } else {
      console.log(`Tag '${tag}' not found in header region.`);
    }
  }

  // 2. Scan the schema definition block (0x02B0 to 0x10000) for all 4-character uppercase ASCII tags
  console.log('\n--- General Schema Block Scan (0x02B0 - 0x8000) ---');
  const schemaBlock = buffer.subarray(0x02b0, 0x8000);
  const detectedTags: Map<string, string> = new Map();

  for (let i = 0; i < schemaBlock.length - 8; i += 4) {
    const code = schemaBlock.toString('ascii', i, i + 4);
    
    // Check if code consists of 4 valid uppercase letters or digits
    if (/^[A-Z0-9]{4}$/.test(code)) {
      const fileOffset = 0x02b0 + i;
      const metadata = schemaBlock.subarray(i + 4, i + 12).toString('hex');
      
      if (!detectedTags.has(code)) {
        detectedTags.set(code, `Offset: 0x${fileOffset.toString(16).toUpperCase().padStart(4, '0')} | Meta: ${metadata}`);
      }
    }
  }

  console.log(`Total unique 4-character field tags found: ${detectedTags.size}\n`);
  
  // Print first 30 field tags found in the schema section
  let count = 0;
  for (const [tag, info] of detectedTags.entries()) {
    if (count >= 30) break;
    console.log(`Tag: [ ${tag} ] -> ${info}`);
    count++;
  }
}

findSchemaDefinitions();
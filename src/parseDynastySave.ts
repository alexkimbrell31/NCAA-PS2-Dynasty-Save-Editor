import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

interface TableEntry {
  index: number;
  name: string;
  headerOffset: string;
  pointerData: string;
}

function parseEADatabase() {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    return;
  }

  const buffer = fs.readFileSync(filePath);

  // Check magic 'DB' signature at offset 0x00
  const magic = buffer.toString('ascii', 0, 2);
  if (magic !== 'DB') {
    console.error('Invalid file format: Expected "DB" magic signature.');
    return;
  }

  console.log(`\nFile loaded successfully (${buffer.length} bytes)`);

  const tables: TableEntry[] = [];
  
  // Table directory runs from offset 0x10 up to 0x2B0 in 8-byte steps
  let offset = 0x10;
  let tableIndex = 0;

  while (offset < 0x2b0) {
    // Read 4-byte ASCII name
    const rawName = buffer.subarray(offset, offset + 4).toString('ascii');
    // Strip null characters and non-printable bytes
    const cleanName = rawName.replace(/[^A-Za-z0-9]/g, '').trim();

    if (cleanName.length > 0) {
      // Next 4 bytes hold table metadata/pointers
      const pointer = buffer.subarray(offset + 4, offset + 8).toString('hex');

      tables.push({
        index: tableIndex++,
        name: cleanName,
        headerOffset: `0x${offset.toString(16).toUpperCase().padStart(4, '0')}`,
        pointerData: pointer
      });
    }

    offset += 8; // Advance to next 8-byte directory block
  }

  console.log(`\nFound ${tables.length} tables in EA DB header:`);
  console.table(tables);
}

parseEADatabase();
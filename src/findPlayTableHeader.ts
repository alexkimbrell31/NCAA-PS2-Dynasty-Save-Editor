import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

function scanForPlayHeader() {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found at ${filePath}`);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  console.log(`File Size: ${buffer.length} bytes (0x${buffer.length.toString(16).toUpperCase()})`);

  const matches: number[] = [];

  // Search entire buffer for ASCII 'PLAY'
  for (let offset = 0; offset < buffer.length - 4; offset++) {
    if (buffer.toString('ascii', offset, offset + 4) === 'PLAY') {
      matches.push(offset);
    }
  }

  console.log(`\nFound ${matches.length} occurrence(s) of 'PLAY':\n`);

  for (const matchOffset of matches) {
    console.log(`----------------------------------------`);
    console.log(`Match at Offset: 0x${matchOffset.toString(16).toUpperCase()} (${matchOffset})`);
    
    // Dump 48 bytes starting from the match
    const slice = buffer.subarray(matchOffset, Math.min(matchOffset + 48, buffer.length));
    console.log(`Hex: ${slice.toString('hex').match(/../g)?.join(' ')}`);

    // Parse next 5 32-bit uints in LE and BE
    if (matchOffset + 24 <= buffer.length) {
      console.log('Integers (Little-Endian):', [
        buffer.readUInt32LE(matchOffset + 4),
        buffer.readUInt32LE(matchOffset + 8),
        buffer.readUInt32LE(matchOffset + 12),
        buffer.readUInt32LE(matchOffset + 16),
        buffer.readUInt32LE(matchOffset + 20),
      ]);
      console.log('Integers (Big-Endian):   ', [
        buffer.readUInt32BE(matchOffset + 4),
        buffer.readUInt32BE(matchOffset + 8),
        buffer.readUInt32BE(matchOffset + 12),
        buffer.readUInt32BE(matchOffset + 16),
        buffer.readUInt32BE(matchOffset + 20),
      ]);
    }
  }
}

scanForPlayHeader();
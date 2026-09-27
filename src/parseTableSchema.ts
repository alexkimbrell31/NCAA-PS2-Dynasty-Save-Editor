import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

function parseTableSchema(tableName: string, headerOffsetHex: string, pointerHex: string) {
  const buffer = fs.readFileSync(filePath);

  // Convert 4-byte Little-Endian hex string to file offset integer
  // e.g. "c8e80e00" -> Buffer [0xc8, 0xe8, 0x0e, 0x00] -> readUInt32LE
  const pointerBuffer = Buffer.from(pointerHex, 'hex');
  const dataOffset = pointerBuffer.readUInt32LE(0);

  console.log(`\n========================================`);
  console.log(`Target Table : ${tableName}`);
  console.log(`Header Offset: ${headerOffsetHex}`);
  console.log(`Data Offset  : 0x${dataOffset.toString(16).toUpperCase()} (${dataOffset} bytes)`);
  console.log(`========================================`);

  if (dataOffset >= buffer.length) {
    console.error('Data offset lies outside the file boundary.');
    return;
  }

  // Read the sub-header at the table payload offset
  // First 4 bytes at payload location often mirror the table name ASCII
  const tableTag = buffer.toString('ascii', dataOffset, dataOffset + 4);
  console.log(`Table Tag at Data Offset: "${tableTag}"`);

  // Print a 64-byte hex dump surrounding the table data start
  const snippet = buffer.subarray(dataOffset, dataOffset + 64);
  console.log('\nPayload Hex Snippet:');
  console.log(snippet.toString('hex').match(/.{1,32}/g)?.join('\n'));

  // Print printable ASCII characters to check for field names (e.g., PSPD, POVR)
  const asciiPreview = snippet.toString('ascii').replace(/[^a-zA-Z0-9_]/g, '.');
  console.log(`\nASCII Preview: ${asciiPreview}`);
}

function inspectPlayData() {
  const buffer = fs.readFileSync(filePath);

  // Little-Endian pointer for PLAY: 0x000EE8C8
  const playOffset = 0x000EE8C8;

  // PLAY table extends from 0x000EE8C8 up to the next table (AAPL at 0x00162BE0)
  const nextTableOffset = 0x00162BE0; 
  const playDataLength = nextTableOffset - playOffset;

  console.log(`PLAY Table Payload Range: 0x${playOffset.toString(16).toUpperCase()} - 0x${nextTableOffset.toString(16).toUpperCase()}`);
  console.log(`Total PLAY Payload Size : ${playDataLength} bytes`);

  // Search for the first non-zero byte in the PLAY table payload
  let firstDataByte = -1;
  for (let i = playOffset; i < nextTableOffset; i++) {
    if (buffer[i] !== 0) {
      firstDataByte = i;
      break;
    }
  }

  if (firstDataByte !== -1) {
    const zeroPaddingLength = firstDataByte - playOffset;
    console.log(`\nInitial Zero-Padding Length: ${zeroPaddingLength} bytes`);
    console.log(`First Non-Zero Byte Found At: 0x${firstDataByte.toString(16).toUpperCase()}`);

    // Print a 64-byte snippet of real player bit data
    const realDataSnippet = buffer.subarray(firstDataByte, firstDataByte + 64);
    console.log('\nReal Player Data Hex Snippet:');
    console.log(realDataSnippet.toString('hex').match(/.{1,32}/g)?.join('\n'));
  } else {
    console.log('No non-zero data found in PLAY range.');
  }
}

// Target the 'PLAY' table (Index 73: headerOffset = 0x0258, pointerData = c8e80e00)
parseTableSchema('PLAY', '0x0258', 'c8e80e00');

inspectPlayData();
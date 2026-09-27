const fs = require('fs');
const path = require('path');

const savePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const buffer = fs.readFileSync(savePath);
const entries = [];

for (let off = 0x10; off < 0x2B0; off += 8) {
  const nameBytes = buffer.subarray(off, off + 4);
  const name = nameBytes.toString('ascii').replace(/[^A-Za-z0-9]/g, '').trim();
  if (!name) continue;

  const pointer = buffer.readUInt32LE(off + 4);
  entries.push({
    dirOffset: off,
    name,
    pointer,
    pointerHex: '0x' + pointer.toString(16).toUpperCase().padStart(8, '0')
  });
}

console.log('TOTAL_TABLES=' + entries.length);
for (const entry of entries) {
  console.log(`${entry.name} @ ${entry.pointerHex} (dirOff=0x${entry.dirOffset.toString(16).toUpperCase().padStart(4, '0')})`);
}

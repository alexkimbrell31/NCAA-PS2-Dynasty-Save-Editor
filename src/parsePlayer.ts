import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');

// BitStream Reader for handling bit-packed EA fields
class BitReader {
  private buffer: Buffer;
  private currentBitOffset: number;

  constructor(buffer: Buffer, startByteOffset: number = 0) {
    this.buffer = buffer;
    this.currentBitOffset = startByteOffset * 8;
  }

  /**
   * Reads 'bitLength' bits starting at 'globalBitOffset' or current position
   */
  public readBitsAt(globalBitOffset: number, bitLength: number): number {
    let result = 0;
    
    for (let i = 0; i < bitLength; i++) {
      const targetBit = globalBitOffset + i;
      const byteIndex = Math.floor(targetBit / 8);
      const bitInByte = 7 - (targetBit % 8); // Big-Endian bit ordering

      const bitValue = (this.buffer[byteIndex] >> bitInByte) & 1;
      result = (result << 1) | bitValue;
    }

    return result;
  }
}

function parseFirstPlayer() {
  const buffer = fs.readFileSync(filePath);

  // Player 1 starts at 0xEE9D0 and spans 264 bytes (2112 bits)
  const player1StartByte = 0xEE9D0;
  const RECORD_SIZE_BYTES = 264;

  const playerBuffer = buffer.subarray(player1StartByte, player1StartByte + RECORD_SIZE_BYTES);
  const bitReader = new BitReader(playerBuffer);

  console.log(`\n========================================`);
  console.log(`Parsing Player Record #1 (Offset 0x${player1StartByte.toString(16).toUpperCase()})`);
  console.log(`========================================`);

  // Sample raw bit extractions from the 2112-bit player block
  console.log(`Bits [0..15]   (Raw ID / Flags) : ${bitReader.readBitsAt(0, 16)}`);
  console.log(`Bits [16..31]  (Raw Flags)      : ${bitReader.readBitsAt(16, 16)}`);
  console.log(`Bits [32..63]  (Raw Bit Block)  : 0x${bitReader.readBitsAt(32, 32).toString(16)}`);

  // Calculate total players in file
  const PLAY_TABLE_START = 0xEE8C8;
  const PLAY_TABLE_END = 0x162BE0;
  const totalPlayBytes = PLAY_TABLE_END - PLAY_TABLE_START;
  const totalPlayers = Math.floor(totalPlayBytes / RECORD_SIZE_BYTES);

  console.log(`\nTotal Player Records in Save: ${totalPlayers} players (${totalPlayers - 1} active players)`);
}

parseFirstPlayer();
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(__dirname, '..', 'DynastySaveFiles', 'BASLUS-21459DDyn1');
const outputPath = path.join(__dirname, '..', 'analysis', 'stringCandidates.json');

export type StringConfidence = 'high' | 'medium' | 'low';

export interface StringCandidate {
  offset: number;
  offsetHex: string;
  length: number;
  text: string;
  confidence: StringConfidence;
  reason: string;
}

const MIN_RUN_LENGTH = 4;

function isPrintable(byte: number): boolean {
  return byte >= 0x20 && byte <= 0x7e;
}

/**
 * Classify a printable-ASCII run. Structural FourCC/field codes in this file are
 * always ALL-CAPS letters/digits (e.g. "PLAY", "PGID"). Real human names would be
 * mixed-case or Title Case (e.g. "Bush", "Young"), which random bit-packed bytes are
 * very unlikely to produce by chance across multiple consecutive bytes. So mixed/
 * Title Case is treated as much higher-confidence evidence of real string data.
 */
function classify(text: string): { confidence: StringConfidence; reason: string } {
  const words = text.split(/[^A-Za-z']+/).filter(Boolean);
  const allWordsTitleCase = words.length > 0 && words.every(w => /^[A-Z][a-z']+$/.test(w));

  if (allWordsTitleCase && words.length >= 2) {
    return { confidence: 'high', reason: 'multi-word Title Case (looks like "First Last")' };
  }
  if (allWordsTitleCase) {
    return { confidence: 'high', reason: 'single Title Case word (looks like a name)' };
  }
  if (/^[A-Z0-9_]+$/.test(text)) {
    return { confidence: 'low', reason: 'all-caps/digits, likely a FourCC or field code' };
  }
  if (/[a-z]/.test(text) && /[A-Z]/.test(text)) {
    return { confidence: 'medium', reason: 'mixed case, but not clean Title Case words' };
  }
  if (/^[a-z\s]+$/.test(text)) {
    return { confidence: 'medium', reason: 'all lowercase text' };
  }
  return { confidence: 'low', reason: 'no strong case signal' };
}

function scanPrintableStrings(buffer: Buffer): StringCandidate[] {
  const candidates: StringCandidate[] = [];
  let runStart = -1;

  const flush = (end: number) => {
    if (runStart === -1) return;
    const length = end - runStart;
    if (length >= MIN_RUN_LENGTH) {
      const text = buffer.toString('ascii', runStart, end);
      const { confidence, reason } = classify(text);
      candidates.push({
        offset: runStart,
        offsetHex: `0x${runStart.toString(16).toUpperCase().padStart(6, '0')}`,
        length,
        text,
        confidence,
        reason
      });
    }
    runStart = -1;
  };

  for (let i = 0; i < buffer.length; i++) {
    if (isPrintable(buffer[i])) {
      if (runStart === -1) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(buffer.length);

  return candidates;
}

function main() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Save file not found at ${filePath}`);
  }

  const buffer = fs.readFileSync(filePath);
  console.log(`File size: ${buffer.length} bytes`);

  const candidates = scanPrintableStrings(buffer);
  console.log(`Total printable-ASCII runs (length >= ${MIN_RUN_LENGTH}): ${candidates.length}`);

  const byConfidence = {
    high: candidates.filter(c => c.confidence === 'high'),
    medium: candidates.filter(c => c.confidence === 'medium'),
    low: candidates.filter(c => c.confidence === 'low')
  };
  console.log(`  high:   ${byConfidence.high.length}`);
  console.log(`  medium: ${byConfidence.medium.length}`);
  console.log(`  low:    ${byConfidence.low.length}`);

  console.log(`\n--- Top ${Math.min(80, byConfidence.high.length)} HIGH-confidence candidates ---`);
  console.table(byConfidence.high.slice(0, 80).map(c => ({
    offset: c.offsetHex,
    text: c.text,
    reason: c.reason
  })));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(candidates, null, 2));
  console.log(`\nSaved ${candidates.length} string candidates to: ${outputPath}`);
}

main();

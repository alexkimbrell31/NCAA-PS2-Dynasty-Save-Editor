/**
 * The honest denominator: of the fields in tables we call "solved", how many
 * are actually IDENTIFIED? A solved table can still contain columns we only
 * know the shape of. Lists below come from the per-table docs.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));

// Fields documented as UNIDENTIFIED / UNPROVEN / constant-and-uninformative.
const UNIDENTIFIED: Record<string, string[]> = {
  PLAY: ['RCHD', 'PFMP', 'PRST', 'PLSY', 'PRG1', 'PRG2', 'PRG3', 'PRG4', 'PRG5',
         'PRG6', 'PRG7', 'PRG8', 'PRG9', 'POVR', 'PAWR', 'PSTA', 'PINJ'],
  TEAM: ['JJNM', 'TPIP', 'TCHS', 'TCHT', 'TCHW', 'TCHL', 'TMIA', 'LGID', 'TBRK',
         'TBPR', 'TOVR', 'TSDS', 'tscs', 'tsns', 'TMGC', 'SDUR', 'SNCT', 'tmsg',
         'TSCS', 'TEZ1', 'TEZ2'],
  COCH: ['CFEX', 'CTOP', 'CHAR', 'CSKI', 'CThg', 'CDST', 'COST', 'COHT', 'COFS',
         'CCPO', 'COTY', 'CFUC', 'CCTF', 'PTID', 'CCFY', 'CBSZ', 'CTgw', 'CPRE',
         'CPID', 'CDPC', 'CRPC', 'CTPC'],
  SCHD: ['GFOT'],
  STAD: ['SWFP', 'STDR', 'STwp', 'STfw', 'STCA', 'MPTH', 'SORI', 'SUTf', 'SIOT',
         'STHS', 'SGPT', 'SBST', 'Stlc', 'STrf', 'STri', 'STcl', 'STRr', 'STlr'],
  BOWL: ['BMFD', 'BLGO', 'BPLO', 'UTID'],
  PLGA: ['PGPI', 'PGSI', 'PSNP', 'PGCI', 'PGYI', 'PSBD'],
  AAPL: ['ARET'],
  PSOF: ['scyc', 'subt', 'suyh'],
  TSSE: ['tsga', 'tsta', 'tsdf', 'tsof', 'tsdr', 'tsdt', 'tsot', 'tsoz', 'tspd', 'tsPi'],
  PLAC: ['PAcC', 'PAsC', 'PAcS', 'PAsS', 'PAcV', 'PAsV'],
  MCOV: ['CAN0', 'MTTN', 'CID0', 'HID0', 'MBK0', 'CEM0', 'CTY0', 'MLAY'],
  MOIN: ['MIMI', 'MCSA', 'MPSA', 'MCST', 'MPST', 'MNTI', 'MTYP', 'MSTY'],
  CONF: [], DIVI: [], WQTS: [], PSDE: [], PSKI: [], PSKP: [],
};

const SOLVED = Object.keys(UNIDENTIFIED);
let totalFields = 0, identified = 0, unknownFields = 0;
const perTable: [string, number, number][] = [];

for (const name of SOLVED) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  const unk = new Set(UNIDENTIFIED[name]);
  const present = f.filter((x: any) => unk.has(x.name)).length;
  totalFields += f.length;
  unknownFields += present;
  identified += f.length - present;
  perTable.push([name, f.length - present, f.length]);
}

console.log('=== field-level coverage INSIDE the 19 solved tables ===');
for (const [n, id, tot] of perTable.sort((a, b) => b[2] - a[2])) {
  console.log(`  ${n.padEnd(6)} ${String(id).padStart(3)}/${String(tot).padEnd(3)} ` +
    `${(100 * id / tot).toFixed(0).padStart(3)}%`);
}
console.log(`\n  TOTAL ${identified}/${totalFields} = ${(100 * identified / totalFields).toFixed(1)}% ` +
  `(${unknownFields} documented as unidentified)`);

// weight by live bytes
let wId = 0, wTot = 0;
for (const name of SOLVED) {
  const h = parseTableHeader(buf, findTable(toc, name).realOffset);
  const f = parseFieldDescriptors(buf, h);
  const unk = new Set(UNIDENTIFIED[name]);
  const bits = f.reduce((s: number, x: any) => s + x.bits, 0);
  const unkBits = f.filter((x: any) => unk.has(x.name)).reduce((s: number, x: any) => s + x.bits, 0);
  wTot += bits * h.currentRecords;
  wId += (bits - unkBits) * h.currentRecords;
}
console.log(`  weighted by live BITS: ${(100 * wId / wTot).toFixed(1)}% of solved-table payload identified`);

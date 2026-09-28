/**
 * Least-squares fit of POVR from the other ratings, per position.
 * If POVR is a derived value, a linear model should fit almost exactly.
 * If residuals are large, POVR is stored independently and a bulk edit must
 * set it explicitly.
 */
import {
  findTable, parseFieldDescriptors, parseFileHeader, parseTableHeader,
  parseToc, readRecords, readSaveFile, RATING_FIELDS, PLAYER_POSITIONS,
  ratingToDisplay,
} from '../lib/eadb.ts';

const buf = readSaveFile();
const toc = parseToc(buf, parseFileHeader(buf));
const h = parseTableHeader(buf, findTable(toc, 'PLAY').realOffset);
const f = parseFieldDescriptors(buf, h);
const play = readRecords(buf, h, f) as any[];

const inputs = RATING_FIELDS.filter((r: string) => r !== 'POVR');

// solve normal equations via Gaussian elimination
function lstsq(X: number[][], y: number[]): number[] {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) for (const [k, row] of X.entries()) A[i][j] += row[i] * row[j];
    for (const [k, row] of X.entries()) A[i][n] += row[i] * y[k];
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-9) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const fac = A[r][c] / A[c][c];
      for (let j = c; j <= n; j++) A[r][j] -= fac * A[c][j];
    }
  }
  return A.map((row, i) => (Math.abs(row[i]) < 1e-9 ? 0 : row[i][0] ?? row[n] / row[i]));
}

console.log('pos    n   R^2    maxErr  meanAbsErr   verdict');
for (let pos = 0; pos < 21; pos++) {
  const ps = play.filter(p => p.PPOS === pos);
  if (ps.length < 50) continue;
  const X = ps.map(p => [...inputs.map((rn: string) => ratingToDisplay(p[rn])), 1]);
  const y = ps.map(p => ratingToDisplay(p.POVR));
  const beta = lstsq(X, y);
  const pred = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const errs = pred.map((v, i) => Math.abs(v - y[i]));
  const my = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const ssRes = errs.reduce((s, e) => s + e * e, 0);
  const r2 = 1 - ssRes / ssTot;
  const maxErr = Math.max(...errs);
  const mae = errs.reduce((s, e) => s + e, 0) / errs.length;
  const verdict = r2 > 0.99 && maxErr < 2 ? 'DERIVED' : r2 > 0.9 ? 'close, not exact' : 'INDEPENDENT';
  console.log(`${PLAYER_POSITIONS[pos].padEnd(4)} ${String(ps.length).padStart(4)}  ` +
    `${r2.toFixed(3)}  ${maxErr.toFixed(1).padStart(6)}  ${mae.toFixed(2).padStart(9)}   ${verdict}`);
}

console.log('\nIf no position reports DERIVED, POVR is stored INDEPENDENTLY:');
console.log('a bulk roster edit must write POVR explicitly rather than expect');
console.log('the game to recompute it.');

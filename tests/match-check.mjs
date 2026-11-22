// Checks the receipt matcher against a receipt whose true barcodes are known.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const [respFile, truthFile] = process.argv.slice(2);
execFileSync('npx', ['esbuild', 'src/logic.ts', '--bundle', '--format=esm', '--outfile=/tmp/kniyot-logic.mjs', '--log-level=error']);
const { matchLine } = await import('/tmp/kniyot-logic.mjs');
const rows = JSON.parse(readFileSync('public/data/ashdod/catalog.json', 'utf8'));
const resp = JSON.parse(readFileSync(respFile, 'utf8')), truth = JSON.parse(readFileSync(truthFile, 'utf8'));
let ok = 0, sure = 0, wrongSure = 0;
resp.lines.forEach((l, k) => {
  const m = matchLine(l.name, l.qty, l.unit_price, rows, l.barcode);
  const hit = m.row && m.row[0] === truth[k]?.code;
  if (hit) ok++; if (m.sure) sure++; if (m.sure && !hit) wrongSure++;
  if (!hit) console.log('  miss:', l.name, '=>', m.row?.[1], '| truth:', truth[k]?.name, m.score.toFixed(2));
});
console.log(`lines ${resp.lines.length}/${truth.length}, correct ${ok}, marked sure ${sure}, sure-but-wrong ${wrongSure}, total ${resp.total}`);

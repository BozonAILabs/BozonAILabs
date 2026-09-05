/** Opt-in live provider test using wholly synthetic data. Never uses client documents. */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { combine, extract } from '../supabase/functions/_shared/extraction.ts';
import { assertEquals } from '@std/assert';
import { checkStatement } from '../shared/statement.ts';
const key = Deno.env.get('MISTRAL_API_KEY');
if (!key) throw new Error('Set MISTRAL_API_KEY in the process environment.');
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
[
  'SYNTHETIC TEST DOCUMENT - NOT A REAL BANK STATEMENT',
  'NatWest',
  'GBP Current Account | Account: 12345678',
  'Statement period: 01 January 2026 to 31 January 2026',
  'Opening balance: GBP 1,000.00',
  'Date              Description                      Money in        Money out        Balance',
  '02 Jan 2026    Invoice 1                         100.00                                 1,100.00',
  '03 Jan 2026    Rent                                                     102.00                 998.00',
  'Closing balance: GBP 998.00',
].forEach((text, i) =>
  page.drawText(text, { x: 35, y: 790 - i * 35, size: i === 0 ? 10 : 12, font })
);
const bytes = await pdf.save();
let raw = '';
for (const b of bytes) raw += String.fromCharCode(b);
const chunk = await extract('data:application/pdf;base64,' + btoa(raw), 0, 1, key);
const result = combine([chunk], 1);
assertEquals(result.transactions.map((t) => [t.date, t.amount]), [['2026-01-02', 10000], [
  '2026-01-03',
  -10200,
]]);
assertEquals(result.opening, 100000);
assertEquals(result.closing, 99800);
assertEquals(checkStatement(result).balance, 'matches');
console.log(
  'Live Mistral OCR synthetic smoke passed: two exact transactions and balances. This does not validate a real bank format.',
);
if (Deno.args.includes('--boundary')) {
  const multi = await PDFDocument.create();
  const font = await multi.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 8; i++) {
    const p = multi.addPage([595, 842]);
    const lines = [
      'SYNTHETIC TEST - NOT A REAL BANK STATEMENT',
      'NatWest | GBP Current Account 12345678',
      `Page ${i + 1} of 8 | 01 January 2026 to 31 January 2026`,
    ];
    if (i === 0) lines.push('Opening balance: GBP 1,000.00');
    if (i < 5) lines.push('No transactions on this page.');
    if (i === 5) {
      lines.push(
        'Date | Description | Money in | Money out | Balance',
        '02 Jan 2026 | Client invoice reference | 100.00 | - | 1,100.00',
      );
    }
    if (i === 6) {
      lines.push(
        '(description continued from previous page): PROJECT ALPHA',
        '03 Jan 2026 | Office rent | - | 102.00 | 998.00',
        'Closing balance: GBP 998.00',
      );
    }
    lines.forEach((text, n) => p.drawText(text, { x: 35, y: 790 - n * 35, size: 11, font }));
  }
  const bytes = await multi.save();
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  const url = 'data:application/pdf;base64,' + btoa(raw);
  const chunks = [await extract(url, 0, 8, key), await extract(url, 6, 8, key)];
  const s = combine(chunks, 8);
  assertEquals(s.transactions.map((t) => [t.date, t.amount, t.page]), [['2026-01-02', 10000, 6], [
    '2026-01-03',
    -10200,
    7,
  ]]);
  assertEquals(s.transactions[0].description.includes('PROJECT ALPHA'), true);
  assertEquals(checkStatement(s).balance, 'matches');
  console.log(
    'Live Mistral boundary smoke passed: two chunks, no missing/extra rows, continuation joined across pages 6/7.',
  );
}

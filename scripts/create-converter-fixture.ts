/** Synthetic multi-page PDF for full browser -> worker -> provider verification. */
import { PDFDocument, StandardFonts } from 'pdf-lib';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const count = Deno.args.includes('--boundary') ? 8 : 1;
for (let i = 0; i < count; i++) {
  const page = pdf.addPage([595, 842]);
  const lines = [
    'SYNTHETIC TEST - NOT A REAL BANK STATEMENT',
    'NatWest | GBP Current Account 12345678',
    `Page ${i + 1} of ${count} | 01 January 2026 to 31 January 2026`,
  ];
  if (i === 0) lines.push('Opening balance: GBP 1,000.00');
  if (count === 1) {
    lines.push(
      'Date | Description | Money in | Money out | Balance',
      '02 Jan 2026 | Client invoice | 100.00 | - | 1,100.00',
      '03 Jan 2026 | Office rent | - | 102.00 | 998.00',
      'Closing balance: GBP 998.00',
    );
  } else if (i === 5) {
    lines.push(
      'Date | Description | Money in | Money out | Balance',
      '02 Jan 2026 | Client invoice reference | 100.00 | - | 1,100.00',
    );
  } else if (i === 6) {
    lines.push(
      '(description continued from previous page): PROJECT ALPHA',
      '03 Jan 2026 | Office rent | - | 102.00 | 998.00',
      'Closing balance: GBP 998.00',
    );
  } else lines.push('No transactions on this page.');
  lines.forEach((line, n) => page.drawText(line, { x: 35, y: 790 - n * 35, size: 11, font }));
}
await Deno.mkdir('.local', { recursive: true });
await Deno.writeFile('.local/statement-test.pdf', await pdf.save());
console.log(`Created synthetic ${count}-page fixture at .local/statement-test.pdf`);

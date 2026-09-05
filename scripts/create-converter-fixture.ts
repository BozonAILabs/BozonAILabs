/** Synthetic multi-page PDF for full browser -> worker -> provider verification. */
import { PDFDocument, StandardFonts } from 'pdf-lib';
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const count = Deno.args.includes('--boundary') ? 8 : 1;
const bank = Deno.args.includes('--unknown-bank') ? 'Example Community Bank' : 'NatWest';
const currency = Deno.args.includes('--non-gbp') ? 'EUR' : 'GBP';
const partial = Deno.args.includes('--partial');
for (let i = 0; i < count; i++) {
  const page = pdf.addPage([595, 842]);
  const lines = [
    'SYNTHETIC TEST - NOT A REAL BANK STATEMENT',
    `${bank} | ${currency} Current Account 12345678`,
    `Page ${i + 1} of ${count} | 01 January 2026 to 31 January 2026`,
  ];
  if (i === 0) lines.push(`Opening balance: ${currency} 1,000.00`);
  if (count === 1) {
    lines.push(
      'Date | Description | Money in | Money out | Balance',
      '02 Jan 2026 | Client invoice | 100.00 | - | 1,100.00',
      partial
        ? '03 Jan 2026 | Office rent | - | [amount unreadable] | [balance unreadable]'
        : '03 Jan 2026 | Office rent | - | 102.00 | 998.00',
      `Closing balance: ${currency} 998.00`,
    );
  } else if (i === 5) {
    lines.push(
      'Date | Description | Money in | Money out | Balance',
      '02 Jan 2026 | Client invoice reference | 100.00 | - | 1,100.00',
    );
  } else if (i === 6) {
    lines.push(
      '(description continued from previous page): PROJECT ALPHA',
      partial
        ? '03 Jan 2026 | Office rent | - | [amount unreadable] | [balance unreadable]'
        : '03 Jan 2026 | Office rent | - | 102.00 | 998.00',
      `Closing balance: ${currency} 998.00`,
    );
  } else lines.push('No transactions on this page.');
  lines.forEach((line, n) => page.drawText(line, { x: 35, y: 790 - n * 35, size: 11, font }));
}
await Deno.mkdir('.local', { recursive: true });
await Deno.writeFile('.local/statement-test.pdf', await pdf.save());
if (Deno.args.includes('--scanned')) {
  // Rasterise only this synthetic fixture, then embed pixels in a PDF with no text layer.
  const rendered = await new Deno.Command('pdftoppm', {
    args: ['-png', '-r', '120', '.local/statement-test.pdf', '.local/fixture-scan'],
    stdout: 'null', stderr: 'piped',
  }).output();
  if (!rendered.success) throw new Error('Synthetic scan rendering failed; install Poppler/pdftoppm.');
  const scan = await PDFDocument.create();
  for (let i = 1; i <= count; i++) {
    const image = await scan.embedPng(await Deno.readFile(`.local/fixture-scan-${i}.png`));
    const page = scan.addPage([595, 842]);
    page.drawImage(image, {x:0,y:0,width:595,height:842});
  }
  await Deno.writeFile('.local/statement-test.pdf', await scan.save());
}
console.log(`Created synthetic ${count}-page ${Deno.args.includes('--scanned') ? 'scanned ' : ''}fixture at .local/statement-test.pdf`);

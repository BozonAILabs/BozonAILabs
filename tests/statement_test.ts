import { assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  checkStatement,
  pence,
  spreadsheetText,
  type Statement,
  xeroCsv,
} from '../shared/statement.ts';
import {
  type Chunk,
  combine,
  extract,
  validatePdf,
} from '../supabase/functions/_shared/extraction.ts';
import { PDFDocument } from 'pdf-lib';
export const sample: Statement = {
  bank: 'NatWest',
  currency: 'GBP',
  account: 'synthetic-1234',
  start: '2026-01-01',
  end: '2026-01-31',
  opening: 100000,
  closing: 99800,
  transactions: [{
    date: '2026-01-02',
    description: 'Invoice 1',
    amount: 10000,
    balance: 110000,
    page: 1,
  }, { date: '2026-01-03', description: 'Rent', amount: -10200, balance: 99800, page: 1 }],
};
Deno.test('money parsing uses exact pence and rejects ambiguity', () => {
  assertEquals(['1.01', '-0.01', '100', '1.001', '1,200.00', 'NaN', '1e2', null].map(pence), [
    101,
    -1,
    10000,
    null,
    null,
    null,
    null,
    null,
  ]);
});
Deno.test('valid arithmetic and CSV match independent expected values', () => {
  assertEquals(checkStatement(sample), { balance: 'matches', issues: [], canExport: true });
  assertEquals(xeroCsv(sample), [
    '*Date,*Amount,Description\r\n"02/01/2026","100.00","Invoice 1"\r\n"03/01/2026","-102.00","Rent"\r\n',
  ]);
});
Deno.test('missing transaction and running balance mismatch block Xero', () => {
  const s = structuredClone(sample);
  s.transactions.pop();
  assertEquals(checkStatement(s).balance, 'mismatch');
  assertThrows(() => xeroCsv(s));
  s.closing = 110000;
  s.transactions[0].balance = 0;
  assertEquals(checkStatement(s).canExport, false);
});
Deno.test('invalid dates, null amounts and unsupported currency block', () => {
  for (const date of ['2026-02-30', '01/02/26', '']) {
    const s = structuredClone(sample);
    s.transactions[0].date = date;
    assertEquals(checkStatement(s).canExport, false);
  }
  const s = structuredClone(sample);
  s.transactions[0].amount = null;
  assertThrows(() => xeroCsv(s));
  s.currency = 'EUR';
  assertEquals(checkStatement(s).issues.some((i) => i.code === 'unsupported'), true);
});
Deno.test('balance unavailable requires explicit acknowledgement', () => {
  const s = structuredClone(sample);
  s.opening = null;
  s.closing = null;
  assertThrows(() => xeroCsv(s));
  assertEquals(xeroCsv(s, true).length, 1);
});
Deno.test('duplicates stay visible and are never silently removed', () => {
  const s = structuredClone(sample);
  s.opening = null;
  s.closing = null;
  s.transactions[0].balance = null;
  s.transactions[1].balance = null;
  s.transactions.push({ ...s.transactions[0] });
  assertEquals(checkStatement(s).issues.filter((i) => i.code === 'duplicate').length, 1);
  assertEquals(s.transactions.length, 3);
});
Deno.test('formula injection, quoting, CSV splitting and negative balances', () => {
  assertEquals(spreadsheetText(' =cmd()'), "' =cmd()");
  const s = structuredClone(sample);
  s.transactions = Array.from(
    { length: 1001 },
    (_, i) => ({
      date: '2026-01-01',
      description: i === 0 ? '=HYPERLINK("bad")' : `Row ${i}`,
      amount: -1,
      balance: null,
      page: 1,
    }),
  );
  s.opening = 0;
  s.closing = -1001;
  const files = xeroCsv(s);
  assertEquals(files.length, 2);
  assertEquals(files[0].split('\r\n').length, 1002);
  assertEquals(files[0].includes(`"'=HYPERLINK(""bad"")"`), true);
});
Deno.test('PDF validation rejects garbage, oversized and >20-page PDFs', async () => {
  await assertRejects(() => validatePdf(new TextEncoder().encode('not a pdf')));
  await assertRejects(() => validatePdf(new Uint8Array(10485761)));
  const pdf = await PDFDocument.create();
  pdf.addPage();
  assertEquals(await validatePdf(await pdf.save()), 1);
  for (let i = 1; i < 21; i++) pdf.addPage();
  await assertRejects(async () => validatePdf(await pdf.save()));
});
Deno.test('chunk merge keeps order, detects multiple accounts and gaps', () => {
  const first: Chunk = {
    statement: structuredClone(sample),
    from: 0,
    through: 6,
    complete: true,
    supported: true,
  };
  const second: Chunk = {
    statement: {
      ...structuredClone(sample),
      transactions: [{ ...sample.transactions[1], page: 7 }],
    },
    from: 6,
    through: 8,
    complete: true,
    supported: true,
  };
  assertEquals(combine([first, second], 8).transactions.length, 3);
  second.statement.account = 'another';
  assertThrows(() => combine([first, second], 8));
  second.statement.account = sample.account;
  second.from = 7;
  assertThrows(() => combine([first, second], 8));
  first.complete = false;
  assertThrows(() => combine([first], 6));
});
Deno.test('OCR sends bounded pages, lookahead and pinned model; excludes lookahead rows', async () => {
  const original = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (_input, init) => {
    sent = JSON.parse(init!.body as string);
    return Response.json({
      document_annotation: JSON.stringify({
        ...sample,
        opening: '1000.00',
        closing: '998.00',
        supported: true,
        complete: true,
        transactions: [
          { ...sample.transactions[0], amount: '100.00', balance: '1100.00', page: 6 },
          { ...sample.transactions[1], amount: '-102.00', balance: '998.00', page: 7 },
        ],
      }),
    });
  };
  try {
    const result = await extract('https://example.invalid/source', 0, 15, 'test');
    assertEquals(sent.model, 'mistral-ocr-4-0');
    assertEquals(sent.pages, [0, 1, 2, 3, 4, 5, 6]);
    assertEquals(result.statement.transactions.length, 1);
    assertEquals(result.statement.transactions[0].page, 6);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test('provider errors, corrupt annotations and foreign page references fail honestly', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () => Promise.resolve(new Response('', { status: 429 }));
    await assertRejects(() => extract('x', 0, 1, 'x'));
    globalThis.fetch = () => Promise.resolve(Response.json({ document_annotation: 'invalid' }));
    await assertRejects(() => extract('x', 0, 1, 'x'));
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test('encrypted PDFs are rejected without ignoring encryption', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.context.trailerInfo.Encrypt = pdf.context.register(
    pdf.context.obj({ Filter: 'Standard', V: 1, R: 2 }),
  );
  await assertRejects(async () => validatePdf(await pdf.save()));
});
Deno.test('large exact integer totals cannot overflow into a false balance pass', () => {
  const s = structuredClone(sample);
  s.opening = 0;
  s.closing = 0;
  s.transactions = Array.from(
    { length: 100 },
    () => ({
      date: '2026-01-02',
      description: 'Credit',
      amount: 100_000_000_000_000,
      balance: null,
      page: 1,
    }),
  );
  s.transactions.push(
    ...Array.from(
      { length: 100 },
      () => ({
        date: '2026-01-02',
        description: 'Debit',
        amount: -100_000_000_000_000,
        balance: null,
        page: 1,
      }),
    ),
  );
  s.transactions.splice(100, 0, {
    date: '2026-01-02',
    description: 'One penny',
    amount: 1,
    balance: null,
    page: 1,
  });
  assertEquals(checkStatement(s).balance, 'mismatch');
});

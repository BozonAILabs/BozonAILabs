/** Shared contract for conversion, future completeness and transaction comparison. */
export const ENGINE_VERSION = '1.1.0';
export const API_VERSION = 2;
export const MODEL = 'mistral-ocr-4-0';
export interface ExtractionQuality {
  complete: boolean;
  unreadablePages: number[];
  uncertainPages: number[];
}
export interface Transaction {
  date: string;
  description: string;
  amount: number | null;
  balance: number | null;
  page: number;
}
export interface Statement {
  extraction?: ExtractionQuality;
  bank: string;
  currency: string;
  account: string;
  start: string;
  end: string;
  opening: number | null;
  closing: number | null;
  transactions: Transaction[];
}
export interface Issue {
  code: string;
  message: string;
  row?: number;
  blocking: boolean;
}
export interface Checks {
  balance: 'matches' | 'mismatch' | 'unavailable';
  issues: Issue[];
  canExport: boolean;
}
export interface StatementSummary {
  account: string;
  start: string;
  end: string;
  opening: number | null;
  closing: number | null;
}
export function summary(s: Statement): StatementSummary {
  const { account, start, end, opening, closing } = s;
  return { account, start, end, opening, closing };
}
export function pence(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?\d{1,12}(\.\d{1,2})?$/.test(value.trim())) return null;
  const s = value.trim();
  const [whole, fraction = ''] = s.replace('-', '').split('.');
  return (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))) * (s.startsWith('-') ? -1 : 1);
}
export function money(value: number | null): string {
  return value === null ? '' : (value / 100).toFixed(2);
}
export function validDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
}
const isMoney = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= 100_000_000_000_000;
export function assertStatement(value: unknown): asserts value is Statement {
  if (!value || typeof value !== 'object') throw new Error('Invalid statement');
  const s = value as Statement;
  for (const key of ['bank', 'currency', 'account', 'start', 'end'] as const) {
    if (typeof s[key] !== 'string' || s[key].length > 200) {
      throw new Error('Invalid statement field');
    }
  }
  if (
    s.extraction !== undefined && (
      !s.extraction || typeof s.extraction.complete !== 'boolean' ||
      ![s.extraction.unreadablePages, s.extraction.uncertainPages].every((pages) =>
        Array.isArray(pages) && pages.length <= 20 &&
        pages.every((p) => Number.isInteger(p) && p >= 1 && p <= 20)
      )
    )
  ) throw new Error('Invalid extraction quality');
  if (
    !Array.isArray(s.transactions) || s.transactions.length > 10000 ||
    ![s.opening, s.closing].every((v) => v === null || isMoney(v))
  ) throw new Error('Invalid statement values');
  for (const t of s.transactions) {
    if (
      !t || typeof t.date !== 'string' || t.date.length > 30 || typeof t.description !== 'string' ||
      t.description.length > 2000 || ![t.amount, t.balance].every((v) =>
        v === null || isMoney(v)
      ) || !Number.isInteger(t.page) || t.page < 1 || t.page > 20
    ) throw new Error('Invalid transaction');
  }
}
export function checkStatement(s: Statement): Checks {
  assertStatement(s);
  const issues: Issue[] = [];
  const add = (code: string, message: string, blocking = true, row?: number) =>
    issues.push({ code, message, blocking, ...(row === undefined ? {} : { row }) });
  if (s.currency !== 'GBP') {
    add('unsupported', 'Only single-currency GBP statements can be imported.');
  }
  if (s.extraction?.complete === false) {
    add(
      'incomplete_extraction',
      'Some transactions or details may be missing. This is a partial extraction, even if the balance matches.',
    );
  }
  if (s.extraction?.unreadablePages.length) {
    add('unreadable_pages', `Could not read pages: ${s.extraction.unreadablePages.join(', ')}.`);
  }
  if (s.extraction?.uncertainPages.length) {
    add(
      'uncertain_pages',
      `Check unclear rows on pages: ${s.extraction.uncertainPages.join(', ')}.`,
    );
  }
  if (!validDate(s.start) || !validDate(s.end) || s.start > s.end) {
    add('period', 'Review the statement period.');
  }
  if (!s.transactions.length) add('empty', 'No transactions found.');
  let previous = s.opening === null ? null : BigInt(s.opening);
  const seen = new Set<string>();
  s.transactions.forEach((t, row) => {
    if (!validDate(t.date)) add('date', 'Enter a valid transaction date.', true, row);
    else if (t.date < s.start || t.date > s.end) {
      add('date_range', 'Date falls outside the statement period.', true, row);
    }
    if (t.amount === null) add('amount', 'Enter the signed amount.', true, row);
    if (!t.description.trim()) add('description', 'Enter a description.', true, row);
    if (
      previous !== null && t.amount !== null && t.balance !== null &&
      previous + BigInt(t.amount) !== BigInt(t.balance)
    ) add('running_balance', 'Running balance does not match.', true, row);
    previous = t.balance !== null
      ? BigInt(t.balance)
      : previous !== null && t.amount !== null
      ? previous + BigInt(t.amount)
      : null;
    const fingerprint = `${t.date}|${t.description}|${t.amount}`;
    if (seen.has(fingerprint)) {
      add(
        'duplicate',
        'Possible duplicate. Check the source; this row has been retained.',
        false,
        row,
      );
    }
    seen.add(fingerprint);
  });
  let balance: Checks['balance'] = 'unavailable';
  if (s.opening !== null && s.closing !== null && s.transactions.every((t) => t.amount !== null)) {
    balance = BigInt(s.opening) + s.transactions.reduce((n, t) =>
            n + BigInt(t.amount!), 0n) === BigInt(s.closing)
      ? 'matches'
      : 'mismatch';
    if (balance === 'mismatch') {
      add('balance', 'Opening balance plus transactions does not equal closing balance.');
    }
  }
  return { balance, issues, canExport: !issues.some((i) => i.blocking) };
}
export function spreadsheetText(value: string): string {
  return /^[\s]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
}
const csvCell = (s: string) => `"${s.replaceAll('"', '""')}"`;
export function xeroCsv(s: Statement, acknowledged = false): string[] {
  const checks = checkStatement(s);
  if (!checks.canExport || (checks.balance === 'unavailable' && !acknowledged)) {
    throw new Error('Review statement checks before exporting.');
  }
  const files: string[] = [];
  for (let i = 0; i < s.transactions.length; i += 1000) {
    const rows = s.transactions.slice(i, i + 1000).map((t) =>
      [t.date.split('-').reverse().join('/'), money(t.amount), spreadsheetText(t.description)].map(
        csvCell,
      ).join(',')
    );
    files.push(['*Date,*Amount,Description', ...rows].join('\r\n') + '\r\n');
  }
  return files;
}

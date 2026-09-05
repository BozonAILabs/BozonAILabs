// Opt-in billed test. Real local Auth, Storage, DB, Edge worker and Mistral; no routed/mocked responses.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '../..');
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: root, stdio: ['ignore','pipe','ignore'] }));
assert.equal(status.API_URL, 'http://127.0.0.1:56321');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const base = 'http://127.0.0.1:5174';
const email = `live-browser-${crypto.randomUUID()}@example.test`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const output = resolve(root, '.local/live-result');
await mkdir(output, { recursive: true });
let jobId, userId;
try {
  await page.goto(`${base}/tools/bank-statement-converter`);
  await page.locator('input[name="name"]').fill('Local converter verification');
  await page.locator('input[name="practice"]').fill('Synthetic Practice');
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole('button', { name: 'Continue to converter' }).click();
  await page.locator('#pdf').waitFor();
  const { data: profile, error: profileError } = await admin.from('converter_profiles').select('user_id,email').eq('email',email).single();
  if (profileError) throw profileError;
  userId = profile.user_id;
  await page.reload();
  await page.locator('#pdf').setInputFiles(resolve(root, '.local/statement-test.pdf'));
  await page.getByRole('button', { name: 'Convert statement' }).click();
  await page.locator('#rows tr').first().waitFor({ timeout: 300000 });
  assert.equal(await page.locator('#rows tr').count(), 2);
  assert.equal(await page.getByLabel('Amount in pounds for row 1').inputValue(), '100.00');
  assert.equal(await page.getByLabel('Amount in pounds for row 2').inputValue(), '-102.00');
  const { data: jobs, error: jobError } = await admin.from('conversions').select('id,pages,state,next_page').eq('user_id', userId);
  if (jobError) throw jobError;
  assert.equal(jobs.length, 1); jobId = jobs[0].id;
  assert.equal(jobs[0].state, 'review'); assert.equal(jobs[0].next_page, jobs[0].pages);
  const { data: content } = await admin.from('conversion_content').select('chunks').eq('job_id',jobId).single();
  assert.equal(content.chunks.length, Math.ceil(jobs[0].pages / 6));
  if (jobs[0].pages === 8) assert.match(await page.getByLabel('description for row 1', { exact: true }).inputValue(), /PROJECT ALPHA/);
  await page.getByLabel('description for row 2', { exact: true }).fill('Office rent reviewed');
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await page.locator('#excel:enabled').waitFor();
  for (const [button, filename] of [['Download Excel','statement.xlsx'], ['Download Xero CSV','xero.csv']]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    await (await download).saveAs(resolve(output,filename));
  }
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(resolve(output,'statement.xlsx'));
  const tx = book.getWorksheet('Transactions');
  assert.equal(tx.rowCount,3); assert.equal(tx.getCell('C2').value,100); assert.equal(tx.getCell('C3').value,-102);
  assert.equal(tx.getCell('B3').value,'Office rent reviewed');
  const csv = await readFile(resolve(output,'xero.csv'),'utf8');
  assert.match(csv,/Office rent reviewed/); assert.match(csv,/-102.00/);
  await page.locator('#review').screenshot({ path: resolve(output,'review.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).display !== 'none').map(e => ({ tag: e.tagName, id: e.id, cls: e.className, width: e.getBoundingClientRect().width })).slice(0,20) }));
  if (overflow.document > overflow.width) console.log('Overflow:', overflow);
  await page.screenshot({ path: resolve(output,'mobile.png'),fullPage:true });
  assert.equal(overflow.document <= overflow.width, true);
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete file & transactions' }).click();
  await page.locator('#review').waitFor({ state: 'hidden' });
  const { data: removed } = await admin.from('conversion_content').select('job_id').eq('job_id',jobId);
  assert.deepEqual(removed, []);
  console.log(`PASS: contact form + real anonymous session, PDF upload, ${jobs[0].pages}-page Mistral extraction (${content.chunks.length} chunks), review, saved edit, verified Excel/CSV downloads, mobile fit, deletion.`);
} catch (e) {
  console.error('Live flow failed:', e.message);
  console.error('Visible status:', await page.locator('#error, #progress-text, #availability').allTextContents().catch(() => ['Page unavailable']));
  throw e;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await browser.close();
}

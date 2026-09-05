// Opt-in billed test. Real local Auth, Storage, DB, Edge worker and Mistral; no routed/mocked responses.
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const scenario = process.env.CONVERTER_LIVE_SCENARIO ?? 'complete';
assert(['complete','partial','unsupported'].includes(scenario));
const partial = scenario === 'partial';
const root = resolve(import.meta.dirname, '../..');
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: root, stdio: ['ignore','pipe','ignore'] }));
assert.equal(status.API_URL, 'http://127.0.0.1:56321');
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const base = 'http://127.0.0.1:5174';
const email = `live-browser-${crypto.randomUUID()}@example.test`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const output = resolve(root, '.local/live-result', scenario);
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
  if (scenario === 'unsupported') {
    await page.locator('#failed').waitFor({ timeout: 120000 });
    assert.equal(await page.locator('#review').isVisible(),false);
    const {data: jobs} = await admin.from('conversions').select('id,state,error_code').eq('user_id',userId);
    assert.equal(jobs.length,1); jobId=jobs[0].id;
    assert.equal(jobs[0].state,'failed');
    assert(['UNSUPPORTED_CURRENCY','UNSUPPORTED_STATEMENT'].includes(jobs[0].error_code));
    assert.match(await page.locator('#workflow-contact a').getAttribute('href'), /^mailto:/);
    console.log('PASS: real non-GBP extraction rejected; no finished output; workflow contact available.');
  } else {
  await page.locator('#completed').waitFor({ timeout: 300000 });
  await page.locator('#rows tr').first().waitFor();
  assert.equal(await page.locator('#rows tr').count(), 2);
  assert.equal(await page.getByLabel('Amount in pounds for row 1').inputValue(), '100.00');
  assert.equal(await page.getByLabel('Amount in pounds for row 2').inputValue(), partial ? '' : '-102.00');
  const { data: jobs, error: jobError } = await admin.from('conversions').select('id,pages,state,next_page').eq('user_id', userId);
  if (jobError) throw jobError;
  assert.equal(jobs.length, 1); jobId = jobs[0].id;
  assert.equal(jobs[0].state, 'review'); assert.equal(jobs[0].next_page, jobs[0].pages);
  const { data: content } = await admin.from('conversion_content').select('chunks').eq('job_id',jobId).single();
  assert.equal(content.chunks.length, Math.ceil(jobs[0].pages / 6));
  console.log('Extraction quality:',content.chunks.map(c => c.statement.extraction));
  if (jobs[0].pages === 8) assert.match(await page.getByLabel('description for row 1', { exact: true }).inputValue(), /PROJECT ALPHA/);
  await page.getByLabel('description for row 2', { exact: true }).fill('Office rent reviewed');
  await page.locator('#excel:enabled').waitFor();
  for (const [button, filename] of [['Download Excel','statement.xlsx'], ['Download Xero CSV','xero.csv']]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: button }).click();
    await (await download).saveAs(resolve(output,filename));
  }
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(resolve(output,'statement.xlsx'));
  const tx = book.getWorksheet(partial ? 'Partial transactions' : 'Transactions');
  assert.equal(tx.rowCount,3); assert.equal(tx.getCell('C2').value,100); assert.equal(tx.getCell('C3').value,partial ? null : -102);
  assert.equal(tx.getCell('B3').value,'Office rent reviewed');
  if (partial) {
    assert.equal(book.getWorksheet('Extraction').getCell('A2').value, 'Incomplete extraction');
    assert.equal(await page.locator('#xero').isDisabled(),false);
    assert.equal(await page.locator('#share-statement').count(), 0);
    assert.match(await page.locator('#workflow-contact a').getAttribute('href'), /^mailto:/);
  }
  const csv = await readFile(resolve(output,'xero.csv'),'utf8');
  assert.match(csv,/Office rent reviewed/);
  if (partial) assert.match(csv, /"","Office rent reviewed"/);
  else assert.match(csv,/-102.00/);
  await page.getByRole('button', { name: 'Save corrections' }).click();
  await page.getByText('Corrections saved', {exact:true}).waitFor();
  await page.reload();
  await page.locator('#completed').waitFor();
  assert.equal(await page.locator('#upload').isVisible(), false);
  await page.locator('#review').screenshot({ path: resolve(output,'review.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).display !== 'none').map(e => ({ tag: e.tagName, id: e.id, cls: e.className, width: e.getBoundingClientRect().width })).slice(0,20) }));
  if (overflow.document > overflow.width) console.log('Overflow:', overflow);
  await page.screenshot({ path: resolve(output,'mobile.png'),fullPage:true });
  assert.equal(overflow.document <= overflow.width, true);
  await page.getByRole('button', { name: /Delete conversion from/ }).click();
  await page.getByRole('dialog', { name: 'Delete this statement?' }).getByRole('button', { name: 'Delete statement', exact: true }).click();
  await page.locator('#review').waitFor({ state: 'hidden' });
  const { data: removed } = await admin.from('conversion_content').select('job_id').eq('job_id',jobId);
  assert.deepEqual(removed, []);
  console.log(`PASS: ${scenario} result; contact form + real anonymous session, PDF upload, ${jobs[0].pages}-page Mistral extraction (${content.chunks.length} chunks), review, saved edit, ${partial ? 'partial Excel/CSV downloads and workflow contact' : 'verified Excel/CSV downloads'}, mobile fit, deletion.`);
  }
} catch (e) {
  // This harness only processes generated synthetic fixtures. Keep failure evidence local.
  await page.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(() => {});
  if (userId) {
    const {data: jobs} = await admin.from('conversions').select('id').eq('user_id',userId);
    if (jobs?.length) {
      const {data: results} = await admin.from('conversion_content').select('chunks,corrected').in('job_id',jobs.map(j => j.id));
      await writeFile(resolve(output,'failure-result.json'),JSON.stringify(results,null,2));
    }
  }
  console.error('Live flow failed:', e.message);
  console.error('Visible status:', await page.locator('#error, #progress-text, #availability').allTextContents().catch(() => ['Page unavailable']));
  throw e;
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await browser.close();
}

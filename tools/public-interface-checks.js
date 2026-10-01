import { createSharePackage, encodeTa1Package } from '../docs/share/ta1-codec.js';
const frame = document.getElementById('publicSurface'), results = [];
let loadRevision = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function load(url, predicate) {
  const target = new URL(url, location.href); target.searchParams.set('audit-run', String(++loadRevision));
  await new Promise(resolve => { frame.onload = resolve; frame.src = target.href; });
  for (let i = 0; i < 120; i++) { if (predicate(frame.contentDocument)) return frame.contentDocument; await wait(25); }
  throw new Error('Public page did not settle');
}
async function check(name, fn) { try { await fn(); results.push({name,passed:true}); } catch(error) { results.push({name,passed:false,error:error.message}); } }
const fits = doc => doc.documentElement.scrollWidth <= frame.clientWidth + 1;
await check('Missing share link announces recovery and hides import controls', async () => {
  const doc = await load('../docs/share/index.html', doc => doc.getElementById('shareStatus')?.getAttribute('role') === 'alert');
  assert(doc.getElementById('shareStatus').textContent.includes('Ask the sender'), 'No error recovery');
  assert(doc.defaultView.getComputedStyle(doc.getElementById('shareActions')).display === 'none', 'Invalid share exposes import actions');
  assert(fits(doc), 'Share error overflows');
});
await check('Valid incoming share exposes all links and a retryable unavailable-extension state', async () => {
  const encoded = await encodeTa1Package(createSharePackage({name:'A long shared folder title to review on a narrow screen',items:Array.from({length:20},(_,i)=>({title:`Public review link ${i+1}`,url:`https://example.com/review/${i}`}))}));
  const doc = await load(`../docs/share/index.html${encoded.fragment}`, doc => doc.getElementById('shareStatus')?.textContent.includes('Install it'));
  assert(doc.querySelectorAll('.share-list li').length === 8, 'Initial preview missing');
  doc.querySelector('.share-more').focus(); doc.querySelector('.share-more').click();
  assert(doc.querySelectorAll('.share-list li').length === 20 && doc.activeElement === doc.querySelectorAll('.share-list li')[8], 'Expanding loses links or keyboard position');
  assert(doc.getElementById('shareAdd').disabled && !doc.getElementById('shareRetry').hidden, 'Unavailable extension leaves Add active or hides retry');
  doc.getElementById('shareRetry').click(); await wait(40);
  assert(!doc.getElementById('shareRetry').disabled && fits(doc), 'Retry remains disabled or preview overflows');
});
await check('Damaged share is an alert with a next step and no actionable import', async () => {
  const doc = await load('../docs/share/index.html#ta1.damaged', doc => doc.getElementById('shareStatus')?.getAttribute('role') === 'alert');
  assert(doc.getElementById('shareStatus').getAttribute('aria-live') === 'assertive' && doc.getElementById('shareStatus').textContent.includes('Ask the sender'), 'Error not announced or not recoverable');
  assert(doc.defaultView.getComputedStyle(doc.getElementById('shareActions')).display === 'none', 'Damaged data exposes Add');
});
for (const page of ['index.html','privacy-policy.html']) await check(`Public ${page}: landmark, heading, named links and narrow layout`, async () => {
  const doc = await load(`../docs/${page}`, doc => doc.querySelector('h1'));
  assert(doc.querySelector('main') && doc.documentElement.lang === 'en', 'Missing landmark or language');
  assert([...doc.querySelectorAll('a[href]')].every(link=>link.textContent.trim() || link.getAttribute('aria-label')), 'Unnamed link');
  assert(fits(doc), 'Public page overflows');
});
document.getElementById('publicInterfaceResults').textContent = JSON.stringify({width:innerWidth,results},null,2);

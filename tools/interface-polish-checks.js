// Browser-only checks for the main dashboard and view controls in every theme.
import { THEME_OPTIONS } from '../extension/lib/view-config.js';
const root = document.documentElement;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let n = 0; n < 100 && !document.querySelector('.chip-focus'); n++) await wait(20);
const original = root.dataset.theme;
const freeze = document.createElement('style');
freeze.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
document.head.append(freeze);
const canvas = document.createElement('canvas').getContext('2d');
function rgb(value) {
  canvas.clearRect(0, 0, 1, 1); canvas.fillStyle = value; canvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a / 255];
}
function over(fg, bg) { return fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])); }
function luminance(c) {
  const l = c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return l[0] * .2126 + l[1] * .7152 + l[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
const samples = [];
for (const theme of THEME_OPTIONS) {
  root.dataset.theme = theme.id;
  const panel = getComputedStyle(document.getElementById('tabViewDrawer'));
  const controls = [...document.querySelectorAll('.dashboard-toolbar button, .dashboard-toolbar select, .tab-view-options label, .tab-view-status')];
  const pairs = controls.map(el => {
    const s = getComputedStyle(el), fill = rgb(s.backgroundColor), ink = rgb(s.color);
    // Composite the actual panel material over black and white to bound any
    // content behind glass, rather than assuming a single page background.
    const material = rgb(panel.backgroundColor);
    const bases = material[3] === 1 ? [material] : [over(material, [0, 0, 0]), over(material, [255, 255, 255])];
    const ratios = bases.map(base => { const bg = over(fill, base); return contrast(over(ink, bg), bg); });
    return { control: el.textContent.trim(), foreground: s.color, background: s.backgroundColor, ratio: Number(Math.min(...ratios).toFixed(2)), opaque: fill[3] === 1 };
  });
  samples.push({ theme: theme.id, contentWidth: root.scrollWidth, panel: { background: panel.backgroundColor, radius: panel.borderRadius, shadow: panel.boxShadow, blur: panel.backdropFilter }, pairs });
}
root.dataset.theme = original;
freeze.remove();
const report = document.createElement('pre');
report.id = 'interfacePolishResults';
report.hidden = true;
report.textContent = JSON.stringify({ samples, viewport: innerWidth, contentWidth: root.scrollWidth }, null, 2);
document.body.append(report);

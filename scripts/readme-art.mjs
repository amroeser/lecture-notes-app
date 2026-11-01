#!/usr/bin/env node
/**
 * Composes the README artwork from the captured screenshots in docs/media:
 *   docs/media/readme/hero-{light,dark}.webp         app window with the study guide, PDF page in front
 *   docs/media/readme/hero-phone-{light,dark}.webp   narrow-screen variant of the hero
 *   docs/media/readme/download-{mac-arm64,mac-x64,windows}-{light,dark}.png   download buttons
 * Run after `npm run media` and the desktop media capture (see README → Regenerating the media).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const media = path.join(root, 'docs', 'media');
const out = path.join(media, 'readme');
mkdirSync(out, { recursive: true });

const dataUri = (file) => `data:image/png;base64,${readFileSync(path.join(media, file)).toString('base64')}`;

const themes = {
  light: {
    bg: 'radial-gradient(70% 60% at 50% 0%, #e0e7ff 0%, rgba(224,231,255,0) 70%), linear-gradient(180deg, #fafaf9 0%, #f4f4f5 100%)',
    frame: '#ffffff',
    bar: '#f4f4f5',
    line: 'rgba(24,24,27,0.10)',
    title: '#52525b',
    shadow: '0 1px 2px rgba(0,0,0,.06), 0 24px 60px -20px rgba(30,27,75,.35), 0 60px 120px -40px rgba(30,27,75,.25)',
    ink: '#18181b',
    sub: '#63636c',
    btnBg: '#18181b',
    btnInk: '#fafafa',
    btnSub: 'rgba(250,250,250,.65)',
  },
  dark: {
    bg: 'radial-gradient(70% 60% at 50% 0%, rgba(99,102,241,.28) 0%, rgba(99,102,241,0) 70%), linear-gradient(180deg, #0b0b0f 0%, #09090b 100%)',
    frame: '#131316',
    bar: '#1c1c21',
    line: 'rgba(255,255,255,0.10)',
    title: '#a1a1aa',
    shadow: '0 0 0 1px rgba(255,255,255,.06), 0 24px 60px -20px rgba(0,0,0,.8), 0 60px 120px -40px rgba(79,70,229,.35)',
    ink: '#f4f4f5',
    sub: '#a1a1aa',
    btnBg: '#fafafa',
    btnInk: '#18181b',
    btnSub: 'rgba(24,24,27,.6)',
  },
};

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">`;

function windowFrame(t, img, { width, title }) {
  return `
  <div style="width:${width}px;border-radius:14px;overflow:hidden;background:${t.frame};box-shadow:${t.shadow};border:1px solid ${t.line}">
    <div style="height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;background:${t.bar};border-bottom:1px solid ${t.line};position:relative">
      <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span>
      <span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
      <span style="position:absolute;left:0;right:0;text-align:center;font:500 13px Geist,system-ui;color:${t.title}">${title}</span>
    </div>
    <img src="${img}" style="display:block;width:100%">
  </div>`;
}

function heroHtml(t, scheme) {
  return `<!doctype html><html><head>${fonts}<style>body{margin:0}</style></head><body>
  <div id="art" style="width:1600px;height:1000px;background:${t.bg};position:relative;overflow:hidden;display:flex;justify-content:center;padding-top:96px;box-sizing:border-box">
    ${windowFrame(t, dataUri(`overview-en-${scheme}.png`), { width: 1240, title: 'Lecture Batch Summarizer' })}
    <div style="position:absolute;right:92px;bottom:-120px;width:380px;transform:rotate(4deg);border-radius:10px;overflow:hidden;box-shadow:${t.shadow};border:1px solid ${t.line};background:#fff">
      <img src="${dataUri('pdf-page.png')}" style="display:block;width:100%">
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:220px;background:linear-gradient(180deg, transparent, ${scheme === 'dark' ? '#09090b' : '#f4f4f5'})"></div>
  </div></body></html>`;
}

function phoneHtml(t, scheme) {
  return `<!doctype html><html><head>${fonts}<style>body{margin:0}</style></head><body>
  <div id="art" style="width:900px;height:1000px;background:${t.bg};position:relative;overflow:hidden;display:flex;justify-content:center;padding-top:64px;box-sizing:border-box">
    <div style="width:430px;border-radius:56px;padding:14px;background:${scheme === 'dark' ? '#27272a' : '#18181b'};box-shadow:${t.shadow};height:fit-content">
      <div style="border-radius:44px;overflow:hidden;height:870px;background:${t.frame}">
        <img src="${dataUri(`mobile-en-${scheme}.png`)}" style="display:block;width:100%">
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:240px;background:linear-gradient(180deg, transparent, ${scheme === 'dark' ? '#09090b' : '#f4f4f5'})"></div>
  </div></body></html>`;
}

const icons = {
  apple: '<path d="M16.37 12.7c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-2.99-.79-1.54.02-2.96.9-3.75 2.27-1.6 2.78-.41 6.89 1.15 9.14.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.24-.02 2.02-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.39-.92-2.41-3.66zM14.1 5.95c.63-.77 1.06-1.83.94-2.89-.91.04-2.02.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.02.08 2.06-.52 2.69-1.28z"/>',
  windows: '<path d="M3 5.5l7.4-1v7.1H3V5.5zm0 13l7.4 1v-7H3v6zm8.3 1.1L21 21v-8.4h-9.7v7zm0-15.2v7.2H21V3l-9.7 1.4z"/>',
};

function buttonHtml(t, { icon, label, sub }) {
  return `<!doctype html><html><head>${fonts}<style>body{margin:0;background:transparent}</style></head><body>
  <div id="art" style="display:inline-flex;align-items:center;gap:14px;height:64px;padding:0 26px 0 20px;border-radius:16px;background:${t.btnBg};color:${t.btnInk};font-family:Geist,system-ui;box-sizing:border-box;width:300px">
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">${icons[icon]}</svg>
    <div style="line-height:1.15">
      <div style="font-size:12px;font-weight:500;color:${t.btnSub};letter-spacing:.01em">${sub}</div>
      <div style="font-size:18px;font-weight:600;letter-spacing:-.01em">${label}</div>
    </div>
  </div></body></html>`;
}

const buttons = [
  { id: 'mac-arm64', icon: 'apple', label: 'macOS · Apple silicon', sub: 'Download for' },
  { id: 'mac-x64', icon: 'apple', label: 'macOS · Intel', sub: 'Download for' },
  { id: 'windows', icon: 'windows', label: 'Windows · 64-bit', sub: 'Download for' },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });

  async function render(html, file, { webp = false, omitBackground = false } = {}) {
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.locator('#art').screenshot({ omitBackground });
    if (!webp) return writeFileSync(path.join(out, file), png);
    const b64 = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.9).split(',')[1];
    }, `data:image/png;base64,${png.toString('base64')}`);
    writeFileSync(path.join(out, file), Buffer.from(b64, 'base64'));
  }

  for (const scheme of ['light', 'dark']) {
    const t = themes[scheme];
    await page.setViewportSize({ width: 1600, height: 1000 });
    await render(heroHtml(t, scheme), `hero-${scheme}.webp`, { webp: true });
    await page.setViewportSize({ width: 900, height: 1000 });
    await render(phoneHtml(t, scheme), `hero-phone-${scheme}.webp`, { webp: true });
    await page.setViewportSize({ width: 400, height: 120 });
    for (const b of buttons) await render(buttonHtml(t, b), `download-${b.id}-${scheme}.png`, { omitBackground: true });
  }
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}

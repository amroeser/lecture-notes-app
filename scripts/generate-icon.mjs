#!/usr/bin/env node
/**
 * Renders src/app/icon.svg into build/icons/icon.png (1024 px) for electron-builder, which derives
 * .icns and .ico from it. The artwork sits at 824 px inside the canvas, like macOS app icons.
 * Usage: node scripts/generate-icon.mjs   (needs: npx playwright install chromium)
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(path.join(root, 'src', 'app', 'icon.svg'), 'utf8');
const out = path.join(root, 'build', 'icons', 'icon.png');
mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(
  `<html><body style="margin:0;background:transparent">
     <div style="width:1024px;height:1024px;display:grid;place-items:center">
       <div style="width:824px;height:824px;filter:drop-shadow(0 12px 24px rgb(0 0 0/.22))">${svg.replace('<svg', '<svg width="824" height="824"')}</div>
     </div></body></html>`,
);
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`wrote ${path.relative(root, out)}`);

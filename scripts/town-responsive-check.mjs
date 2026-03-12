#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:8000';
const DEFAULT_TOKEN = 'clawpanel';
const OUTPUT_DIR = path.resolve('output/playwright/town');

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolvePlaywrightEntry() {
  if (process.env.TOWN_QA_PLAYWRIGHT_ENTRY) {
    return process.env.TOWN_QA_PLAYWRIGHT_ENTRY;
  }

  const npmNpxRoot = path.join(os.homedir(), '.npm', '_npx');
  if (await exists(npmNpxRoot)) {
    const candidates = await fs.readdir(npmNpxRoot, { withFileTypes: true });
    for (const entry of candidates) {
      if (!entry.isDirectory()) continue;
      const maybe = path.join(npmNpxRoot, entry.name, 'node_modules', 'playwright', 'index.js');
      if (await exists(maybe)) {
        return maybe;
      }
    }
  }

  return '';
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const resolvedEntry = await resolvePlaywrightEntry();
    if (!resolvedEntry) {
      throw new Error(
        '找不到 playwright。请先安装，或设置 TOWN_QA_PLAYWRIGHT_ENTRY 指向 playwright/index.js。'
      );
    }
    return import(pathToFileURL(resolvedEntry).href);
  }
}

async function capturePage(browser, options) {
  const context = await browser.newContext({
    viewport: options.viewport,
    deviceScaleFactor: 1,
    isMobile: options.isMobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  const baseUrl = (process.env.TOWN_QA_URL || DEFAULT_URL).replace(/\/$/, '');
  const token = process.env.TOWN_ADMIN_TOKEN || process.env.ADMIN_TOKEN || DEFAULT_TOKEN;

  await page.addInitScript(adminToken => {
    window.localStorage.setItem('admin-token', adminToken);
  }, token);

  await page.goto(`${baseUrl}/town`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const mainTownButton = page.getByRole('button', { name: '主镇' });
  const officeButton = page.getByRole('button', { name: '办公室' });
  if (await officeButton.isVisible().catch(() => false)) {
    await officeButton.click();
    await page.waitForTimeout(900);
  }
  if (await mainTownButton.isVisible().catch(() => false)) {
    await mainTownButton.click();
    await page.waitForTimeout(900);
  }
  if (await officeButton.isVisible().catch(() => false)) {
    await officeButton.click();
    await page.waitForTimeout(900);
  }

  await page.screenshot({
    path: path.join(OUTPUT_DIR, options.outputName),
    fullPage: true,
  });

  await context.close();
  return consoleErrors;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const desktopErrors = await capturePage(browser, {
      viewport: { width: 1440, height: 1100 },
      isMobile: false,
      outputName: 'town-desktop.png',
    });
    const mobileErrors = await capturePage(browser, {
      viewport: { width: 430, height: 932 },
      isMobile: true,
      outputName: 'town-mobile.png',
    });

    const allErrors = [...desktopErrors, ...mobileErrors];
    if (allErrors.length > 0) {
      console.error('Town responsive check captured console errors:');
      allErrors.forEach(item => console.error(`- ${item}`));
      process.exitCode = 1;
      return;
    }

    console.log(`Town responsive check passed. Screenshots written to ${OUTPUT_DIR}`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

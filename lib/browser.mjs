import { CDP, createTab, launchBrowser, closeBrowser, EDGE, CHROME, sleep } from './cdp.mjs';

export { EDGE, CHROME, closeBrowser };

export function browserExe(name) {
  return name === 'chrome' ? CHROME : EDGE;
}

export async function launchForAccount({ port, browser, profile, headless = true }) {
  const proc = await launchBrowser({
    port,
    browser: browserExe(browser),
    profile,
    extraArgs: headless ? [] : ['--window-size=1600,1000', '--start-maximized'],
  });
  return proc;
}

export async function openTab(port, url) {
  const tab = await createTab(port, url);
  const page = new PageSession(tab.webSocketDebuggerUrl, port, tab.id);
  await page.init();
  return page;
}

export class PageSession {
  constructor(wsUrl, port, targetId) {
    this.cdp = new CDP(wsUrl);
    this.port = port;
    this.targetId = targetId;
  }
  async init() {
    await this.cdp.send('Page.enable');
    await this.cdp.send('Runtime.enable');
  }
  async navigate(url) {
    await this.cdp.send('Page.navigate', { url });
  }
  async eval(expression) {
    const r = await this.cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('页面脚本异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 300));
    }
    return r.result.value;
  }
  async url() {
    return this.eval('location.href');
  }
  async waitUrlContain(substr, timeoutSec = 60) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutSec * 1000) {
      const u = await this.url().catch(() => '');
      if (u.includes(substr)) return u;
      await sleep(1000);
    }
    throw new Error(`等待 URL 包含 "${substr}" 超时（当前 ${await this.url().catch(() => '?')}）`);
  }
  // 等待页面就绪：readyState=complete 且 body 有一定内容
  async waitReady(maxSec = 40, minLen = 50) {
    let stable = 0;
    for (let i = 0; i < maxSec; i++) {
      await sleep(1000);
      try {
        const s = JSON.parse(await this.eval(`JSON.stringify({
          state: document.readyState,
          len: (document.body && document.body.innerHTML.length) || 0
        })`));
        if (s.state === 'complete' && s.len >= minLen) {
          if (s.len === stable) return;
          stable = s.len;
        }
      } catch { /* 页面可能正在跳转 */ }
    }
  }
  // 轮询等待条件成立
  async waitFor(expr, timeoutSec = 60, intervalMs = 1000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutSec * 1000) {
      try {
        if (await this.eval(expr)) return true;
      } catch { /* ignore */ }
      await sleep(intervalMs);
    }
    throw new Error(`等待条件超时: ${expr.slice(0, 80)}`);
  }
  async closeTab() {
    try { this.cdp.close(); } catch {}
    try { await fetch(`http://127.0.0.1:${this.port}/json/close/${this.targetId}`, { method: 'PUT' }); } catch {}
  }
}

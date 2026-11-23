import { CDP, createTab, launchBrowser, closeBrowser, EDGE, CHROME, sleep } from './cdp.mjs';

export { EDGE, CHROME, closeBrowser };

export function browserExe(name) {
  return name === 'chrome' ? CHROME : EDGE;
}

// 站点 Default.aspx / Login.aspx 的 pageLoad() 里有 `_pass = !isEdge`，
// 命中 Edge UA 时会 alert("不支持当前浏览器...") 并中断脚本，headless 下 alert 还会卡住页面。
// 因此无论驱动 Edge 还是 Chrome，统一把 UA 伪装成 Chrome，绕过该判断。
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function launchForAccount({ port, browser, profile, headless = true }) {
  const extraArgs = headless ? [] : ['--window-size=1600,1000', '--start-maximized'];
  extraArgs.push(`--user-agent=${CHROME_UA}`);
  // Edge 158 默认开启 HTTPS 优先（自动升级），会把只支持 HTTP 的
  // http://www.gaoxiaokaoshi.com 直接拦成 net::ERR_BLOCKED_BY_CLIENT；
  // 关掉这几个 feature 后登录页可正常打开。
  extraArgs.push('--disable-features=HttpsUpgrades,HttpsFirstMode,HttpsFirstModeV2,HttpsOnlyMode,HttpsFirstBalancedModeAutoEnable');
  const proc = await launchBrowser({
    port,
    browser: browserExe(browser),
    profile,
    extraArgs,
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
    // 站点大量使用 alert() 做提示（登录失败、验证码、未完成学习等）。
    // 弹窗会阻塞渲染进程，导致后续 Runtime.evaluate 永远不返回，必须自动确认并记录内容。
    this.cdp.on('Page.javascriptDialogOpening', (p) => {
      this.lastDialog = { type: p.type, message: p.message };
      console.log(`[dialog] ${p.type}: ${p.message}`);
      this.cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
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

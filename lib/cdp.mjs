import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';

// 浏览器路径自动探测：支持 GXKS_EDGE_PATH / GXKS_CHROME_PATH 覆盖
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const PF = process.env['ProgramFiles'] || 'C:\\Program Files';
const LOCAL = process.env['LOCALAPPDATA'] || '';
const pick = (list) => list.find(p => p && existsSync(p)) || list.filter(Boolean)[0] || '';

export const EDGE = pick([
  process.env.GXKS_EDGE_PATH,
  `${PF86}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${PF}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${LOCAL}\\Microsoft\\Edge\\Application\\msedge.exe`,
]);
export const CHROME = pick([
  process.env.GXKS_CHROME_PATH,
  `${PF}\\Google\\Chrome\\Application\\chrome.exe`,
  `${PF86}\\Google\\Chrome\\Application\\chrome.exe`,
  `${LOCAL}\\Google\\Chrome\\Application\\chrome.exe`,
]);

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function launchBrowser({ port = 9333, browser = EDGE, profile, extraArgs = [] } = {}) {
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-crash-reporter', '--no-sandbox', '--remote-allow-origins=*',
    '--disable-blink-features=AutomationControlled',
    ...extraArgs,
    'about:blank',
  ];
  // 用文件接收浏览器 stderr（避免命名管道，受限环境更稳），启动失败时把尾部日志带出来
  let logPath = '';
  let errFd = -1;
  try {
    mkdirSync('logs', { recursive: true });
    logPath = 'logs/browser-launch.log';
    writeFileSync(logPath, `\n===== ${new Date().toISOString()} launch ${browser} port=${port} =====\n`);
    errFd = openSync(logPath, 'a');
  } catch { errFd = -1; }

  const proc = spawn(browser, args, { stdio: ['ignore', 'ignore', errFd >= 0 ? errFd : 'ignore'] });
  if (errFd >= 0) { try { closeSync(errFd); } catch {} }
  proc.on('error', (e) => console.log('[cdp] spawn error:', e.message));
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return proc;
    } catch { /* not ready */ }
    await sleep(500);
  }
  let tail = '';
  try { tail = readFileSync(logPath, 'utf-8').split(/\r?\n/).filter(Boolean).slice(-5).join(' | '); } catch {}
  throw new Error(`浏览器 CDP 端口未就绪（${browser}）${tail ? '；浏览器日志尾部: ' + tail.slice(-400) : ''}`);
}

export async function createTab(port, url) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error('创建标签页失败: ' + r.status);
  return await r.json();
}

export class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map(); // method -> [fn]
    this.lastDialog = null;
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('WS error: ' + e.message));
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      const list = this.handlers.get(msg.method);
      if (list) for (const fn of list) { try { fn(msg.params || {}); } catch {} }
    };
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  async send(method, params = {}, timeoutMs = 30000) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP 响应超时 ${method}（${timeoutMs}ms）`));
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error('evaluate 异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async waitReady(maxSec = 30, minBodyLen = 50) {
    let stable = 0;
    for (let i = 0; i < maxSec; i++) {
      await sleep(1000);
      const s = JSON.parse(await this.eval(`JSON.stringify({
        state: document.readyState,
        len: (document.body && document.body.innerHTML.length) || 0,
        url: location.href
      })`));
      if (s.state === 'complete' && s.len >= minBodyLen) {
        if (s.len === stable) break;
        stable = s.len;
      }
    }
  }
  async dump(prefix) {
    const out = JSON.parse(await this.eval(`JSON.stringify({
      url: location.href,
      title: document.title,
      head: document.head ? document.head.innerHTML : '',
      body: document.body ? document.body.innerHTML : ''
    })`));
    out.frames = JSON.parse(await this.eval(`JSON.stringify((function(){
      var out = {};
      function walk(w, path){
        try {
          for (var i = 0; i < w.frames.length; i++) {
            var fw = w.frames[i];
            var fp = path + '/' + i;
            try {
              var d = fw.document;
              out[fp] = (d.body ? d.body.innerHTML : '') + '|||HEAD|||' + (d.head ? d.head.innerHTML : '');
            } catch(e) { out[fp] = '(cross-origin)'; }
            walk(fw, fp);
          }
        } catch(e) { out[path + '#err'] = e.message; }
      }
      walk(window, 'frame');
      return out;
    })())`));
    out.step = prefix;
    return out;
  }
  async click(selector, frameIndex = null) {
    const scope = frameIndex != null ? `window.frames[${frameIndex}].document` : 'document';
    const r = await this.eval(`(() => {
      const el = ${scope}.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'not found: ' + ${JSON.stringify(selector)} };
      el.click();
      return { ok: true };
    })()`);
    return r;
  }
  async fill(selector, value, frameIndex = null) {
    const scope = frameIndex != null ? `window.frames[${frameIndex}].document` : 'document';
    return this.eval(`(() => {
      const el = ${scope}.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, reason: 'not found: ' + ${JSON.stringify(selector)} };
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
      if (proto && Object.getOwnPropertyDescriptor(proto, 'value').set) {
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.value = ${JSON.stringify(value)};
      }
      return { ok: true, value: el.value };
    })()`);
  }
  async getLinks(frameIndex = null) {
    const scope = frameIndex != null ? `window.frames[${frameIndex}].document` : 'document';
    return this.eval(`JSON.stringify(Array.from(${scope}.querySelectorAll('a')).map(a => ({
      text: (a.innerText || a.textContent || '').trim().slice(0, 60),
      href: a.href || a.getAttribute('href') || ''
    })))`).then(JSON.parse);
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function closeBrowser(port) {
  try {
    const b = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    const bc = new CDP(b.webSocketDebuggerUrl);
    await bc.send('Browser.close');
    bc.close();
  } catch {}
}

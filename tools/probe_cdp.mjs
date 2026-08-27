// 零依赖 CDP 探测脚本：用系统 Edge(headless) + Chrome DevTools 协议抓取真实 DOM。
// Node >= 22（需要全局 WebSocket/fetch）。用法: node tools/probe_cdp.mjs [url]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const URL = process.argv[2] || 'http://www.gaoxiaokaoshi.com/Login.aspx';
const PROFILE = process.cwd() + '\\.edge-profile';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launchEdge() {
  const args = [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-crash-reporter', '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    'about:blank',
  ];
  const proc = spawn(EDGE, args, { stdio: 'ignore', detached: false });
  proc.on('error', (e) => console.log('[probe] spawn error:', e.message));
  proc.on('exit', (code, sig) => console.log('[probe] edge exited code=', code, 'sig=', sig));
  // 等调试端口就绪
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return proc;
    } catch { /* not ready */ }
    await sleep(500);
  }
  throw new Error('Edge CDP 端口未就绪');
}

async function createTab(url) {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error('创建标签页失败: ' + r.status);
  return await r.json(); // { id, webSocketDebuggerUrl, ... }
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
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
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function main() {
  const proc = await launchEdge();
  console.log('[probe] Edge launched pid=' + proc.pid);
  const tab = await createTab(URL);
  console.log('[probe] tab:', tab.id, tab.url);
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: URL });
  // 等待页面真正就绪：readyState=complete 且 body 有实质内容
  let stable = '';
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const st = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        state: document.readyState,
        len: (document.body && document.body.innerHTML.length) || 0,
        url: location.href
      })`,
      returnByValue: true,
    });
    const s = JSON.parse(st.result.value);
    console.log(`[probe] t=${i + 1}s state=${s.state} bodyLen=${s.len} url=${s.url}`);
    if (s.state === 'complete' && s.len > 50) {
      if (s.len === stable) break; // 内容稳定
      stable = s.len;
    }
  }
  await sleep(1500);
  const res = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      body: document.body ? document.body.innerHTML : '(no body)',
      frames: (function(){
        var out = {};
        function walk(w, path){
          try {
            for (var i = 0; i < w.frames.length; i++) {
              var fw = w.frames[i];
              var fp = path + '/' + i;
              try {
                var d = fw.document;
                out[fp] = (d.body ? d.body.innerHTML : '') + '|||HEAD|||' + (d.head ? d.head.innerHTML : '');
              } catch(e) { out[fp] = '(cross-origin: ' + e.message + ')'; }
              walk(fw, fp);
            }
          } catch(e) { out[path + '#err'] = e.message; }
        }
        walk(window, 'frame');
        return out;
      })()
    })`,
    returnByValue: true,
  });
  const out = JSON.parse(res.result.value);
  console.log('[probe] FINAL URL :', out.url);
  console.log('[probe] TITLE     :', out.title);
  console.log('[probe] BODY LEN  :', out.body.length);
  for (const [k, v] of Object.entries(out.frames || {})) {
    console.log(`[probe] FRAME ${k} len=${v.length}`);
  }
  writeFileSync('tools/_probe_dom.html', out.body, 'utf-8');
  writeFileSync('tools/_probe_frames.json', JSON.stringify(out.frames, null, 2), 'utf-8');
  // 截图
  await cdp.send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => {
    if (shot && shot.data) {
      writeFileSync('tools/_probe_dom.png', Buffer.from(shot.data, 'base64'));
      console.log('[probe] saved tools/_probe_dom.png');
    }
  }).catch(() => console.log('[probe] screenshot skipped'));
  console.log('[probe] saved tools/_probe_dom.html');
  cdp.close();
  // 关闭浏览器
  try {
    const b = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(r => r.json());
    const bc = new CDP(b.webSocketDebuggerUrl);
    await bc.send('Browser.close');
    bc.close();
  } catch {}
  proc.kill();
}

main().catch(e => { console.error('[probe] FAILED:', e.message); process.exit(1); });

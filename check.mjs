// 部署自检：不登录、不填账号，验证「Node 运行时 + Edge/CDP 驱动 + 站点可达 + 登录页元素」是否正常。
// 用法：双击 自检.bat，或 node check.mjs
import { readFileSync } from 'node:fs';
import { launchForAccount, openTab, closeBrowser, EDGE, CHROME } from './lib/browser.mjs';
import { ensureProfileDir } from './lib/util.mjs';

const line = (s) => console.log(s);
let fail = 0;
const okMark = (ok, msg) => { line(`${ok ? '  [✓]' : '  [✗]'} ${msg}`); if (!ok) fail++; };

line('================ 部署自检 ================');
line(`Node      : ${process.version} (${process.platform}/${process.arch})`);
line(`Node 路径 : ${process.execPath}`);
line(`工作目录  : ${process.cwd()}`);

// 1) 配置文件
let cfg = null;
try {
  const raw = JSON.parse(readFileSync('config.json', 'utf-8').replace(/^\uFEFF/, ''));
  const a = (raw.accounts || [])[0] || {};
  cfg = {
    base_url: (raw.site?.base_url || 'http://www.gaoxiaokaoshi.com').replace(/\/+$/, ''),
    login_page: raw.site?.login_page || '/Login.aspx',
    browser: raw.site?.browser || 'edge',
    username: String(a.username || ''),
  };
  okMark(true, `config.json 解析成功 base_url=${cfg.base_url} browser=${cfg.browser}`);
  if (!cfg.username || /填|示例|请在此|placeholder/i.test(cfg.username)) {
    line(`  [!] 当前账号仍是占位符「${cfg.username || '(空)'}」，正式运行前必须填真实账号，否则登录必然失败`);
  }
} catch (e) {
  okMark(false, 'config.json 解析失败：' + e.message);
}

// 2) 启动浏览器（Edge/Chrome）+ CDP
let proc = null, page = null;
const port = 9499;
try {
  const profile = ensureProfileDir('check');
  line(`      浏览器: ${cfg?.browser === 'chrome' ? CHROME : EDGE}`);
  line(`      profile: ${profile}`);
  line('  [..] 正在启动无头浏览器 ...');
  proc = await launchForAccount({ port, browser: cfg?.browser || 'edge', profile, headless: true });
  okMark(true, `浏览器已启动，CDP 端口 ${port} 就绪`);
} catch (e) {
  okMark(false, '浏览器启动失败：' + String(e.message).split('；')[0]);
  const tail = String(e.message).split('；')[1];
  if (tail) line('      ' + tail.slice(0, 300));
  line('  [i] 若日志里出现 platform_channel / crashpad「拒绝访问」：当前终端是低完整性或受限环境，');
  line('      换到正常桌面运行即可（任务管理器 → 文件 → 运行新任务 → 浏览本目录的 自检.bat）。');
}

// 3) 打开登录页并检查关键元素
if (proc) {
  try {
    const base = cfg?.base_url || 'http://www.gaoxiaokaoshi.com';
    page = await openTab(port, base + (cfg?.login_page || '/Login.aspx'));
    await page.waitReady(40, 50);
    const info = JSON.parse(await page.eval(`JSON.stringify({
      url: location.href,
      title: document.title,
      ua: navigator.userAgent,
      hasName: !!document.querySelector('#name'),
      hasPw: !!document.querySelector('#pw'),
      hasSubmit: !!document.querySelector('#btnSubmit'),
      isEdgeUA: navigator.userAgent.toLowerCase().includes('edge')
    })`));
    line(`      当前地址: ${info.url}`);
    line(`      页面标题: ${info.title}`);
    line(`      UA      : ${info.ua}`);
    okMark(/^http:/i.test(info.url) && !info.url.startsWith('chrome-error'), '登录页已成功加载（HTTP 未被 HTTPS 优先拦截）');
    okMark(info.hasName && info.hasPw && info.hasSubmit,
      `登录表单元素 #name=${info.hasName} #pw=${info.hasPw} #btnSubmit=${info.hasSubmit}`);
    okMark(!info.isEdgeUA, 'UA 已伪装为 Chrome（站点 pageLoad 会拒绝 Edge UA）');
  } catch (e) {
    okMark(false, '打开登录页失败：' + e.message);
  }
}

// 4) 收尾
try { if (page) await page.closeTab(); } catch {}
try { await closeBrowser(port); } catch {}
try { if (proc) proc.kill(); } catch {}

line('==========================================');
if (fail === 0) line('结论：环境就绪，可以双击「高校考试助手.exe」填账号开始使用。');
else line(`结论：${fail} 项未通过，见上方 [✗] 项。`);
process.exit(fail === 0 ? 0 : 1);

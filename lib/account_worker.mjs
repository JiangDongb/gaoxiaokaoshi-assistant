// 单账号流程：登录 → 选课 → 视频学习(并发) → 作业(两遍制)
import { openTab, launchForAccount, closeBrowser } from './browser.mjs';
import { sleep, Limiter, safeName, ensureProfileDir } from './util.mjs';
import { discoverLessons, fetchCourseRows, isDone } from './courses.mjs';
import { watchLesson } from './study.mjs';
import { runHomeworkPasses } from './exam.mjs';

// 每轮只拉一次课程列表，广播给所有并发课时，避免高并发下各自拉取
function startProgressPoller(ctrl, baseUrl, pollSec, seedRows, planId, log) {
  const map = new Map();
  for (const r of seedRows) map.set(r.name, r);
  let stopped = false;
  let inFlight = false;
  const run = async () => {
    if (stopped || inFlight) return; // 防重入：上一轮未结束则跳过本轮
    inFlight = true;
    try {
      const rows = await fetchCourseRows(ctrl, baseUrl, planId);
      if (rows.length === 0) {
        log.warn('[进度] 课程列表拉取为空（可能会话过期），下轮重试');
        return;
      }
      for (const r of rows) map.set(r.name, r);
    } catch (e) {
      log.warn('[进度] 课程列表拉取失败，下轮重试: ' + e.message);
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(run, pollSec * 1000);
  run();
  return {
    get: (name) => map.get(name) || null,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}

async function login(ctrl, account, baseUrl, log) {
  log.info(`[登录] ${account.name} (${account.username})`);
  await ctrl.navigate(baseUrl + '/Login.aspx');
  await ctrl.waitReady(30);
  await ctrl.waitFor(`!!document.querySelector('#name')`, 30, 1000);
  await ctrl.eval(`(() => {
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
      if (proto && Object.getOwnPropertyDescriptor(proto, 'value').set) {
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else el.value = v;
    };
    set(document.querySelector('#name'), ${JSON.stringify(account.username)});
    set(document.querySelector('#pw'), ${JSON.stringify(account.password)});
    document.querySelector('#btnSubmit').click();
    return true;
  })()`);
  await ctrl.waitUrlContain('MainPage.aspx', 60).catch(async () => {
    // 登录失败则检查页面提示
    const body = await ctrl.eval('document.body.innerText.slice(0, 300)').catch(() => '');
    throw new Error(`登录后未跳转到主面板，页面内容: ${body}`);
  });
  log.ok(`[登录] ${account.name} 登录成功`);
}

export async function runAccount(account, cfg, store, log, index) {
  const port = cfg.concurrency.cdp_base_port + index;
  // Edge 的 --user-data-dir 必须用绝对路径，否则启动失败。
  // 优先用项目内 profiles\，%TEMP% 不可写时也能启动；不依赖 exe 所在目录可写。
  const profile = ensureProfileDir(account.name);
  const base = cfg.site.base_url;
  const browserProc = await launchForAccount({
    port,
    browser: cfg.site.browser,
    profile,
    headless: cfg.site.headless,
  });

  let ctrl = null;
  let poller = null;
  try {
    ctrl = await openTab(port, base + '/Login.aspx');
    await login(ctrl, account, base, log);

    // 发现并过滤课时
    const lessons = await discoverLessons(ctrl, base, account, log);
    if (lessons.length === 0) {
      log.warn(`[账号] ${account.name} 未发现任何课时`);
      return { account: account.name, lessons: 0, ok: false, reason: 'no lessons' };
    }
    for (const ls of lessons) ls._port = port;

    // 启动共享进度轮询器（以发现结果作为初始快照）
    const planId = (lessons[0] && lessons[0].planId) || null;
    poller = startProgressPoller(ctrl, base, cfg.video.poll_sec, lessons, planId, log);
    const getProgress = (name) => poller.get(name);

    // 观看阶段（并发）
    const limiter = new Limiter(cfg.concurrency.parallel_lessons);
    const tasks = lessons.map(ls => limiter.run(async () => {
      if (cfg.video.mode !== 'skip' && account.watch_videos && !isDone(ls)) {
        const prog = await watchLesson(() => getProgress(ls.name), ls, base, cfg, log);
        if (prog) { ls.doneMin = prog.doneMin; ls.status = prog.status; }
      }
      // 观看后从快照刷新练习入口（练习需先完成学习才解锁）
      const fresh = getProgress(ls.name) || ls;
      ls.examId = fresh.examId != null ? fresh.examId : ls.examId;
      ls.status = fresh.status || ls.status;
      ls.doneMin = fresh.doneMin != null ? fresh.doneMin : ls.doneMin;
      ls.requiredMin = fresh.requiredMin != null ? fresh.requiredMin : ls.requiredMin;

      // 每课一学完就立即答题（无需等该账号所有课时都看完）
      if (account.do_homework && ls.examId && isDone(ls)) {
        await runHomeworkPasses(port, ls, base, cfg, store, log);
      } else if (account.do_homework && !ls.examId) {
        log.warn(`[作业] "${ls.name}" 无练习入口，跳过`);
      } else if (account.do_homework && !isDone(ls)) {
        log.warn(`[作业] "${ls.name}" 尚未完成学习，练习未解锁，跳过`);
      }
      return ls;
    }));
    const watched = await Promise.all(tasks);

    // 若配置为不做作业，仅提示
    if (!account.do_homework) {
      log.info(`[账号] ${account.name} 配置为不做作业`);
    }

    const doneCount = watched.filter(isDone).length;
    log.ok(`===== 账号 ${account.name} 结束：${doneCount}/${watched.length} 课时已完成 =====`);
    return { account: account.name, lessons: watched.length, done: doneCount, ok: true };
  } catch (e) {
    log.error(`[账号] ${account.name} 流程异常: ${e.message}`);
    return { account: account.name, ok: false, reason: e.message };
  } finally {
    try { if (poller) poller.stop(); } catch {}
    try { if (ctrl) await ctrl.closeTab(); } catch {}
    try { await closeBrowser(port); } catch {}
    try { browserProc.kill(); } catch {}
    await sleep(500);
  }
}

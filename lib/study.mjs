// 视频学习：模拟播放器时钟驱动 updateTime 心跳（服务端按真实流逝时间校验，1 倍速累计）
import { openTab } from './browser.mjs';
import { sleep } from './util.mjs';
import { isDone } from './courses.mjs';

async function readStudyParams(tab) {
  return JSON.parse(await tab.eval(`JSON.stringify({
    newId: document.getElementById('hidNewId')?.value || '',
    refId: document.getElementById('hidRefId')?.value || '',
    studentId: document.getElementById('hidStudentId')?.value || '',
    passLine: document.getElementById('hidPassLine')?.value || '1',
    studyTime: document.getElementById('hidStudyTime')?.value || '0',
    sessionId: document.getElementById('hidSessionID')?.value || ''
  })`));
}

async function heartbeat(tab, p, t) {
  const url = `updateTime.ashx?Id=${p.newId}&pTime=${t}&Mins=${p.passLine}&refId=${p.refId}` +
    `&StudentId=${p.studentId}&StydyTime=${p.studyTime}&SessionId=${p.sessionId}`;
  try {
    await tab.eval(`fetch(${JSON.stringify(url)}).then(r => r.text()).catch(e => 'ERR:' + e)`);
  } catch (e) {
    return false;
  }
  return true;
}

/**
 * 观看一个课时直到"已完成"（或达到时长上限）。
 * getProgress: async () => 该课时最新进度 {name, doneMin, requiredMin, status, examId}，从共享轮询读取
 * port: 浏览器调试端口
 * 返回最终进度（或 null 表示超时未完成）。
 * 注意：进度数据由账号级共享轮询器统一拉取后传入，多课时并发时不单独拉取列表。
 */
export async function watchLesson(getProgress, lesson, baseUrl, cfg, log) {
  const studyUrl = `${baseUrl}/Study/LibraryStudy.aspx?Id=${lesson.studyId}&PlanId=${lesson.planId}`;
  log.info(`[学习] 打开课时 "${lesson.name}" (Id=${lesson.studyId}) 要求 ${lesson.requiredMin} 分钟`);
  const tab = await openTab(lesson._port, studyUrl);
  try {
    await tab.waitReady(40);
    let params = await readStudyParams(tab);
    if (!params.newId || !params.sessionId) {
      log.warn(`[学习] "${lesson.name}" 页面参数读取异常，跳过`);
      return null;
    }
    const maxWatchMs = cfg.video.max_watch_sec * 1000;
    const pollSec = cfg.video.poll_sec;
    const stallMs = cfg.video.stall_tolerance_min * 60 * 1000;
    const started = Date.now();
    let t = 0;
    let lastDoneMin = lesson.doneMin;
    let lastChangeAt = Date.now();
    let reloaded = false;

    while (Date.now() - started < maxWatchMs) {
      await sleep(1000);
      t++;
      if (t % 60 === 0) {
        await heartbeat(tab, params, t);
      }
      if (t % pollSec === 0) {
        const prog = await getProgress();
        if (!prog) {
          log.warn(`[学习] "${lesson.name}" 进度查询失败`);
          continue;
        }
        if (prog.doneMin !== lastDoneMin) {
          log.info(`[学习] "${lesson.name}" 进度 ${prog.doneMin}/${prog.requiredMin} 分钟 (${prog.status})`);
          lastDoneMin = prog.doneMin;
          lastChangeAt = Date.now();
        }
        if (isDone(prog)) {
          log.ok(`[学习] "${lesson.name}" 已完成（${prog.doneMin} 分钟）`);
          lesson.examId = prog.examId;
          lesson.status = prog.status;
          return prog;
        }
        // 停滞检测：自上次进度变化以来的时长超过容忍值才刷新会话（该容忍值由用户在设置页控制）
        if (Date.now() - lastChangeAt > stallMs && !reloaded) {
          log.warn(`[学习] "${lesson.name}" 进度 ${stallMs / 60000} 分钟未变化，刷新学习会话`);
          await tab.navigate(studyUrl);
          await tab.waitReady(40);
          params = await readStudyParams(tab);
          t = 0;
          lastChangeAt = Date.now();
          reloaded = true;
        }
      }
    }
    log.warn(`[学习] "${lesson.name}" 达到时长上限 ${cfg.video.max_watch_sec}s 未完成`);
    return null;
  } finally {
    await tab.closeTab();
  }
}

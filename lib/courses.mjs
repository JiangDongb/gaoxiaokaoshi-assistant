// 课程（课时）列表：发现、解析、过滤
import { sleep } from './util.mjs';

// 从课程列表页 HTML 解析一行课时
export function parseLessonRow(rowHtml) {
  const cells = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
  const text = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const name = text(cells[0]);
  if (!name || name === '课程名称') return null; // "课程名称" 是表头假数据
  const mins = [...rowHtml.matchAll(/<td[^>]*>\s*(\d+)\s*分钟\s*<\/td>/g)].map(m => parseInt(m[1], 10));
  const statusM = rowHtml.match(/<span[^>]*>\s*([^<]*?(?:已完成|未学习|学习中)[^<]*?)\s*<\/span>/);
  const status = statusM ? statusM[1].trim() : '';
  const studyM = rowHtml.match(/showframe\(\s*'[^']*'\s*,\s*(\d+)\s*\)/);
  const examM = rowHtml.match(/showExam\(\s*(\d+)\s*\)/);
  const planM = rowHtml.match(/LibraryStudy\.aspx\?Id=\d+&PlanId=(\d+)/);
  const studyId = studyM ? parseInt(studyM[1], 10) : null;
  const examId = examM ? parseInt(examM[1], 10) : 0;
  // 既没有"开始学习"入口也没有"参加练习"入口的行不是真实课时（如筛选/表头行）
  if (studyId == null && examId === 0) return null;
  return {
    name,
    requiredMin: mins[0] || 0,
    doneMin: mins[1] || 0,
    status,
    studyId,
    examId,
    planId: planM ? parseInt(planM[1], 10) : null,
  };
}

export function parseLessonRows(html) {
  const rows = [];
  const trs = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  for (const tr of trs) {
    if (/class="title"/.test(tr)) continue; // 跳过表头行
    if (!tr.includes('pleft30')) continue;  // 跳过非课程行
    const row = parseLessonRow(tr);
    if (row) rows.push(row);
  }
  return rows;
}

export function isDone(row) {
  return row.status === '已完成' || (row.requiredMin > 0 && row.doneMin >= row.requiredMin);
}

// 解析学习计划下拉框
export function parsePlans(html) {
  const plans = [];
  const m = html.match(/<select name="ddlClass"[^>]*id="ddlClass"[^>]*>([\s\S]*?)<\/select>/);
  if (m) {
    for (const opt of m[1].matchAll(/<option[^>]*value="(\d+)"([^>]*)>([\s\S]*?)<\/option>/g)) {
      const selected = /selected="selected"/.test(opt[2]);
      plans.push({ id: parseInt(opt[1], 10), name: opt[3].replace(/<[^>]+>/g, '').trim(), selected });
    }
  }
  return plans;
}

export function hasNextPage(html) {
  const m = html.match(/id="PageSplit1_BtnNext"[^>]*>/);
  if (!m) return false;
  return !/disabled="disabled"/.test(m[0]);
}

// 在控制标签页上选择学习计划（如需）
export async function selectPlan(ctrl, baseUrl, planName, log) {
  const html = await ctrl.eval(`fetch(${JSON.stringify(baseUrl + '/Study/LibraryStudyList.aspx?rnd=' + Date.now())}).then(r => r.text())`);
  const plans = parsePlans(html);
  if (plans.length === 0) return null;
  const target = plans.find(p => p.name === planName) || plans[0];
  if (!plans.find(p => p.id === target.id && p.selected)) {
    log.info(`[选课] 切换到学习计划 "${target.name}" (id=${target.id})`);
    await ctrl.eval(`(() => {
      const sel = document.getElementById('ddlClass');
      if (!sel) return false;
      sel.value = ${target.id};
      __doPostBack('btnSearch', '');
      return true;
    })()`);
    await sleep(3000);
    await ctrl.waitReady(30);
  }
  return target;
}

// 翻页采集所有课时行（发现与共享轮询共用；返回跨分页的全部行）
export async function collectAllRows(ctrl, baseUrl, plan = null) {
  const all = [];
  let page = 0;
  while (page < 60) {
    page++;
    const html = await ctrl.eval('document.body.innerHTML');
    const rows = parseLessonRows(html);
    for (const r of rows) {
      if (r.planId == null && plan) r.planId = plan.id;
      all.push(r);
    }
    if (!hasNextPage(html)) break;
    await ctrl.eval(`__doPostBack('PageSplit1$BtnNext', '')`);
    await sleep(2200);
    await ctrl.waitReady(20);
  }
  return all;
}

// 发现所有课时（跨分页），并支持按账号配置过滤
export async function discoverLessons(ctrl, baseUrl, account, log) {
  // 先导航到课程列表
  await ctrl.navigate(baseUrl + '/Study/LibraryStudyList.aspx?rnd=' + Date.now());
  await ctrl.waitReady(30);

  const plan = account.plan ? await selectPlan(ctrl, baseUrl, account.plan, log) : null;
  const all = await collectAllRows(ctrl, baseUrl, plan);
  log.info(`[选课] 共发现 ${all.length} 个课时`);

  // 按账号配置过滤（名称比较时忽略空白差异）
  let targets = all;
  if (account.lessons && account.lessons.length > 0) {
    const pats = account.lessons.map(p => p.replace(/\s+/g, ''));
    targets = all.filter(r => pats.some(p => r.name.replace(/\s+/g, '').includes(p)));
    log.info(`[选课] 按配置 "${account.lessons.join('、')}" 过滤后 ${targets.length} 个`);
  }
  return targets;
}

// 拉取全部课时进度（翻页），供共享轮询用
// 先重新导航到课程列表第 1 页再翻页，避免上轮停在中途页导致的采集不全；planId 用于必要时重选计划
export async function fetchCourseRows(ctrl, baseUrl, planId = null) {
  await ctrl.navigate(baseUrl + '/Study/LibraryStudyList.aspx?rnd=' + Date.now());
  await ctrl.waitReady(20);
  if (planId != null) {
    const cur = await ctrl.eval(`(document.getElementById('ddlClass')||{}).value`).catch(() => null);
    if (cur != null && String(cur) !== String(planId)) {
      await ctrl.eval(`(() => { const s = document.getElementById('ddlClass'); if (s) { s.value = ${planId}; __doPostBack('btnSearch',''); } return true; })()`);
      await sleep(3000);
      await ctrl.waitReady(20);
    }
  }
  return collectAllRows(ctrl, baseUrl, planId ? { id: planId } : null);
}

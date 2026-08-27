// 课后作业：第一遍全选C收集答案，第二遍用收集的答案作答
import { openTab } from './browser.mjs';

// 从 mainFrame 提取题目（兼容两种页面结构：ExamMain 的 <dl class="exam_list"> 与 ExamTmStepMain 的 <table class="tb_content"> <dl>）
const EXTRACT_QS = `(() => {
  const mf = window.frames['mainFrame'];
  if (!mf) return '[]';
  const d = mf.document;
  const qs = [];
  const serialInputs = Array.from(d.getElementsByName('serial'));
  for (const serialInput of serialInputs) {
    const idx = serialInput.value;
    // 题干 dt 在该 serial 所在 <dl> 内的 <dt>（两种结构的 dt 都在同一 <dl> 中）
    let dt = null;
    const dl = serialInput.closest('dl');
    if (dl) dt = dl.querySelector('dt');
    if (!dt) {
      const dd = serialInput.closest('dd');
      if (dd && dd.previousElementSibling && dd.previousElementSibling.tagName === 'DT') dt = dd.previousElementSibling;
    }
    const qtext = dt ? (dt.textContent || '').replace(/\\s+/g, ' ').trim() : '(无题干)';
    const tmtx = (d.getElementById('tmtx_' + idx) || {}).value || '';
    const opts = Array.from(d.getElementsByName('tmda_' + idx)).map(o => ({
      value: o.value,
      type: o.type || o.tagName.toLowerCase(),
      text: (o.parentElement ? o.parentElement.textContent : o.value || '').replace(/\\s+/g, ' ').trim()
    }));
    qs.push({ idx, tmtx, qtext, opts });
  }
  return JSON.stringify(qs);
})()`;

// 解析 viewExam 答卷页：每题题干 + 标准答案 + 得分
const PARSE_VIEW = `(() => {
  const blocks = Array.from(document.querySelectorAll('div[id^="ddTm_"]'));
  const questions = [];
  for (const b of blocks) {
    const dt = b.querySelector('dt');
    const qtext = (dt ? dt.textContent : '').replace(/\\s+/g, ' ').trim();
    let answer = '';
    let score = null;
    for (const l of Array.from(b.querySelectorAll('dd label'))) {
      const spans = Array.from(l.querySelectorAll('span'));
      let afterStd = false;
      for (const s of spans) {
        if (afterStd && s.classList.contains('green')) { answer = s.textContent.trim(); break; }
        if (s.textContent.includes('标准答案')) afterStd = true;
      }
      const strong = l.querySelector('strong');
      if (strong) { const v = parseFloat(strong.textContent); if (!isNaN(v)) score = v; }
    }
    questions.push({ question: qtext, answer, score });
  }
  // 总分：优先取 .right_top 的 "成绩X分"，其次 "总得分 X"，最后累加每题得分
  let totalScore = null;
  const rightTop = document.querySelector('.right_top');
  if (rightTop) {
    const m = (rightTop.innerText || '').match(/成绩\\s*([\\d.]+)\\s*分/);
    if (m) totalScore = parseFloat(m[1]);
  }
  if (totalScore == null) {
    const m = (document.body.innerText || '').match(/总得分\\s*([\\d.]+)/);
    if (m) totalScore = parseFloat(m[1]);
  }
  if (totalScore == null) {
    const sum = questions.reduce((s, q) => s + (q.score || 0), 0);
    if (questions.length > 0) totalScore = Math.round(sum * 100) / 100;
  }
  return JSON.stringify({ questions, totalScore });
})()`;

function isChoiceQuestion(q) {
  return q.opts.length > 0 && !(q.opts[0].type === 'text' || q.opts[0].type === 'textarea');
}

// 计算每题的作答方案（passNo=1 全猜 guess；passNo=2 用答案库）
function buildAnswerPlan(questions, store, guess, passNo) {
  return questions.map(q => {
    const choice = isChoiceQuestion(q);
    if (!choice) {
      // 主观/填空：第2遍如有记录文本则填入
      if (passNo >= 2) {
        const rec = store.lookup(q.qtext);
        if (rec && rec.answer && !/^[A-Z]+$/.test(rec.answer.toUpperCase())) {
          return { idx: q.idx, letters: [], text: rec.answer, fromStore: true };
        }
      }
      return { idx: q.idx, letters: [], text: null, fromStore: false };
    }
    if (passNo === 1) {
      const hit = q.opts.find(o => o.value.toLowerCase() === guess);
      const pick = hit ? hit.value.toLowerCase() : (q.opts[0] ? q.opts[0].value.toLowerCase() : '');
      return { idx: q.idx, letters: pick ? [pick] : [], text: null, fromStore: false };
    }
    // 第2遍
    const rec = store.lookup(q.qtext);
    if (rec && rec.answer) {
      const ans = rec.answer.toUpperCase();
      if (/^[A-Z]+$/.test(ans)) {
        const valid = ans.toLowerCase().split('').filter(l => q.opts.some(o => o.value.toLowerCase() === l));
        if (valid.length) return { idx: q.idx, letters: valid, text: null, fromStore: true };
      }
      if (ans.includes('对') || ans.includes('错')) {
        const want = ans.includes('对') ? '对' : '错';
        const o = q.opts.find(x => (x.text || '').includes(want));
        if (o) return { idx: q.idx, letters: [o.value.toLowerCase()], text: null, fromStore: true };
      }
    }
    // 未记录 → 回退猜
    const hit = q.opts.find(o => o.value.toLowerCase() === guess);
    const pick = hit ? hit.value.toLowerCase() : (q.opts[0] ? q.opts[0].value.toLowerCase() : '');
    return { idx: q.idx, letters: pick ? [pick] : [], text: null, fromStore: false };
  });
}

// 执行一遍作业
export async function runHomeworkPass(port, lesson, baseUrl, cfg, store, passNo, log) {
  const guess = cfg.homework.first_pass_guess.toLowerCase();
  const examUrl = `${baseUrl}/ExamList/chkExam.aspx?ExamID=${lesson.examId}&SiteType=2&IsContinue=0`;
  const label = passNo === 1 ? '第1遍(收集答案)' : `第2遍(按答案作答)`;
  log.info(`[作业] "${lesson.name}" ${label}：开始考试 (ExamID=${lesson.examId})`);

  const tab = await openTab(port, examUrl);
  try {
    await tab.waitReady(40);
    await tab.waitFor(`(() => {
      const mf = window.frames['mainFrame'];
      return !!(mf && mf.document && mf.document.getElementsByName('serial').length > 0);
    })()`, 90, 1000);

    const questions = JSON.parse(await tab.eval(EXTRACT_QS));
    if (!questions || questions.length === 0) throw new Error('未提取到题目');
    log.info(`[作业] "${lesson.name}" ${label}：共 ${questions.length} 题`);

    const plan = buildAnswerPlan(questions, store, guess, passNo);
    if (passNo >= 2) {
      const hit = plan.filter(x => x.fromStore).length;
      log.info(`[作业] "${lesson.name}" ${label}：答案库命中 ${hit}/${plan.length} 题`);
    }
    const applied = JSON.parse(await tab.eval(`(() => {
      const mf = window.frames['mainFrame'];
      const d = mf.document;
      const plan = ${JSON.stringify(plan)};
      const applied = [];
      for (const q of plan) {
        const opts = Array.from(d.getElementsByName('tmda_' + q.idx));
        if (opts.length === 0) { applied.push({ idx: q.idx, mode: 'none' }); continue; }
        const first = opts[0];
        const isText = first.type === 'text' || first.type === 'textarea' || first.tagName === 'TEXTAREA';
        if (isText) {
          if (q.text != null) {
            for (const o of opts) { o.value = q.text; o.dispatchEvent(new Event('change', { bubbles: true })); }
            applied.push({ idx: q.idx, mode: 'text', text: q.text });
          } else applied.push({ idx: q.idx, mode: 'text-skip' });
          continue;
        }
        const picked = [];
        for (const o of opts) {
          const want = (q.letters || []).includes(o.value.toLowerCase());
          if (o.checked !== want) { o.checked = want; try { o.dispatchEvent(new Event('click', { bubbles: true })); } catch {} }
          if (want) picked.push(o.value);
        }
        applied.push({ idx: q.idx, mode: 'choice', picked });
      }
      return JSON.stringify(applied);
    })()`));

    const unanswered = applied.filter(a =>
      (a.mode === 'choice' && a.picked.length === 0) || a.mode === 'text-skip' || a.mode === 'none').length;
    if (unanswered > 0) log.warn(`[作业] "${lesson.name}" ${label}：${unanswered} 题未作答（主观题或无匹配选项）`);

    // 交卷
    const sub = await tab.eval(`(() => {
      const mf = window.frames['mainFrame'];
      mf.confirm = () => true;
      mf.alert = () => true;
      try { mf.btnSumbit_onclick(); return { ok: true }; } catch (e) { return { ok: false, err: String(e) }; }
    })()`);
    if (!sub.ok) throw new Error('交卷失败: ' + sub.err);
    log.info(`[作业] "${lesson.name}" ${label}：已交卷，等待评分...`);
    await tab.waitUrlContain('ExamMessage.aspx', 120);

    const msgUrl = await tab.url();
    const kscj = (msgUrl.match(/Clerk_Kscj_Id=(\d+)/) || [])[1];
    const tkcl = (msgUrl.match(/Tk_Cl_Id=(\d+)/) || [])[1] || lesson.examId;
    if (!kscj) throw new Error('未找到答卷ID: ' + msgUrl);

    // 查看答卷 → 收集标准答案/得分
    await tab.navigate(`${baseUrl}/ExamList/ExamPage/viewExam.aspx?ExamID=${tkcl}&Clerk_kscj_ID=${kscj}`);
    await tab.waitReady(30);
    await tab.waitFor(`document.querySelectorAll('div[id^="ddTm_"]').length > 0`, 30, 1000);
    const result = JSON.parse(await tab.eval(PARSE_VIEW));

    if (passNo === 1) {
      let recorded = 0;
      for (const q of result.questions) {
        if (q.answer) { store.record(q.question, q.answer, { source: `${lesson.name}` }); recorded++; }
      }
      log.ok(`[作业] "${lesson.name}" 第1遍得分 ${result.totalScore}，记录答案 ${recorded}/${result.questions.length} 题`);
    } else {
      const pass = result.totalScore != null && result.totalScore >= cfg.homework.min_score;
      log.info(`[作业] "${lesson.name}" 第2遍得分 ${result.totalScore}${pass ? ' ✓ 达标' : ' ✗ 未达标（低于及格线）'}`);
    }
    return result;
  } finally {
    await tab.closeTab();
  }
}

export async function runHomeworkPasses(port, lesson, baseUrl, cfg, store, log) {
  const scores = [];
  for (let p = 1; p <= cfg.homework.passes; p++) {
    try {
      const r = await runHomeworkPass(port, lesson, baseUrl, cfg, store, p, log);
      scores.push(r.totalScore);
    } catch (e) {
      log.error(`[作业] "${lesson.name}" 第${p}遍失败: ${e.message}`);
    }
    // 两次考试间稍作间隔
    await new Promise(r => setTimeout(r, 3000));
  }
  log.info(`[作业] "${lesson.name}" 完成：各遍得分 = ${scores.join(' / ') || '无'}`);
}

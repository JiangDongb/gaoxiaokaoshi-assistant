// 入口：多账号并发执行完整流程
// 用法: node main.mjs [config.json]
import { loadConfig } from './lib/config.mjs';
import { AnswerStore } from './lib/answers.mjs';
import { Limiter, makeLogger } from './lib/util.mjs';
import { runAccount } from './lib/account_worker.mjs';

const cfgPath = process.argv[2] || 'config.json';
const cfg = loadConfig(cfgPath);
const store = new AnswerStore(cfg.homework.answers_file);
const log = makeLogger('main');

log.info('========================================');
log.info(' 高校考试网 功能测试自动化 (QA)');
log.info(` 账号数=${cfg.accounts.length} 并发账号=${cfg.concurrency.max_accounts} 并行课时=${cfg.concurrency.parallel_lessons}`);
log.info(` 作业遍数=${cfg.homework.passes} 第1遍猜测=${cfg.homework.first_pass_guess} 及格线=${cfg.homework.min_score}`);
log.info(` 视频模式=${cfg.video.mode} 答案库=${cfg.homework.answers_file}(现有 ${store.size} 题)`);
log.info('========================================');

const limiter = new Limiter(cfg.concurrency.max_accounts);
const results = await Promise.all(cfg.accounts.map((acc, i) =>
  limiter.run(() => runAccount(acc, cfg, store, log, i))
));

log.info('========================================');
log.info(' 全部账号流程结束，汇总:');
for (const r of results) {
  if (r.ok) log.info(`  ✓ ${r.account}: 课时 ${r.lessons} 个，完成 ${r.done}`);
  else log.info(`  ✗ ${r.account}: ${r.reason}`);
}
log.info(` 答案库现有 ${store.size} 题 -> ${cfg.homework.answers_file}`);
log.info('========================================');
log.close();
process.exit(0);

// =============================================================
// 备份「数据库 + 学生卡照片」
//
// 用法（本机）：
//   node scripts/backup-db.mjs
// 用法（服务器上，容器里跑，不用装 Node）：
//   cd ~/greensinbit && docker compose exec -T web node scripts/backup-db.mjs
//   或更省事：bash scripts/run.sh backup
//
// 产物：server/data/backups/<时间戳>/{greensinbit.db, uploads/, manifest.json}
// 数据库用 SQLite 的 VACUUM INTO 做一致性快照，不需要停机。
// 默认保留最近 30 份，更早的自动清理（可用 --keep N 调整）。
//
// 恢复方法：
//   cd ~/greensinbit
//   docker compose down
//   cp 备份目录/greensinbit.db data/greensinbit.db
//   rm -rf data/uploads && cp -r 备份目录/uploads data/uploads
//   docker compose up -d
// =============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotData, resolveDataPaths, pruneBackups } from './safety.mjs';

await import('../server/src/env.js'); // 本地运行时顺带读一下 .env

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = resolveDataPaths(root);
const { dbFile, uploadDir, backupsRoot } = paths;

// 解析参数：--out 指定输出目录，--keep 指定保留份数
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const keep = Math.max(1, Number(argValue('--keep', process.env.BACKUP_KEEP || 30)) || 30);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const outDir = path.resolve(root, argValue('--out', path.join(backupsRoot, stamp)));

if (!fs.existsSync(dbFile)) {
  console.error(`[备份] 找不到数据库文件：${dbFile}`);
  console.error(`       数据目录按「${paths.from}」判断为：${paths.dir}`);
  console.error('       服务器上的正确用法（数据库在主机 data/ 里）：');
  console.error('         bash scripts/run.sh backup');
  console.error('       或显式指定：');
  console.error('         docker run --rm -v "$PWD:/app" -w /app \\');
  console.error('           -e DB_FILE=/app/data/greensinbit.db \\');
  console.error('           -e UPLOAD_DIR=/app/data/uploads \\');
  console.error('           greensinbit:latest node scripts/backup-db.mjs');
  process.exit(1);
}

const result = snapshotData({ outDir, dbFile, uploadDir, label: 'manual' });
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

console.log('[备份] 完成');
console.log(`  目录        ${outDir}`);
console.log(`  数据来源    ${paths.dir}（按 ${paths.from} 判断）`);
console.log(`  数据库      ${result.consistent ? '一致性快照' : '文件拷贝（可能不一致）'} · ${mb(result.dbBytes || 0)}`);
if (result.note) console.log(`  说明        ${result.note}`);
if (result.counts) {
  console.log(`  数据条数    用户 ${result.counts.users} / 赛事 ${result.counts.events}`
    + ` / 报名 ${result.counts.registrations} / 队员 ${result.counts.registration_members}`
    + ` / 比赛 ${result.counts.matches} / 上传文件记录 ${result.counts.files}`);
}
console.log(`  上传文件    ${result.uploadFiles ?? 0} 个`);

// 清理过旧的备份（只保留最近 keep 份；只删带 manifest.json 的自己生成的目录）
const pruned = pruneBackups(backupsRoot, keep);
if (pruned.removed.length) console.log(`  已清理      ${pruned.removed.length} 份旧备份（保留最近 ${keep} 份）`);
if (pruned.total) console.log(`  现有备份    ${Math.min(pruned.total, keep)} 份 · 目录 ${backupsRoot}`);

// 顺手校验：备份里数据库与上传文件都要有内容
if (!result.db) {
  console.error('[备份] 警告：没有生成数据库快照');
  process.exit(1);
}
if ((result.counts?.registrations || 0) > 0 && (result.uploadFiles || 0) === 0) {
  console.error('[备份] 警告：数据库里有报名记录，但没备份到任何上传文件，请检查 UPLOAD_DIR');
}
console.log('[备份] 建议把 data/backups 里的最新一份下载到本地或另存到对象存储，'
  + '服务器整机故障时同一块盘上的备份也会一起丢。');

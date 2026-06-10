/**
 * Quick preview of the production "front door": a user's free-form paragraph → ContentBrief → Product
 * Intelligence. Cheap (no Director / matching / authoring), for iterating on your input wording before
 * running the full pipeline via manual_test_director_agent_timeline.ts.
 *
 * Usage (PowerShell):  $env:USER_INPUT="...你的一段话..."; pnpm --filter @viral-struct/api exec node --import tsx ../../scripts/parse_user_brief.ts
 * Usage (bash):        USER_INPUT="...你的一段话..." pnpm --filter @viral-struct/api exec node --import tsx ../../scripts/parse_user_brief.ts
 *   or put the paragraph in a file:  USER_INPUT_FILE=tmp/user_input.txt pnpm ...
 *   deterministic only (no LLM):     PI_LLM=false USER_INPUT="..." pnpm ...
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContentBrief, USER_BRIEF_INPUT_GUIDANCE } from '../apps/api/src/services/productIntelligence/contentBriefParser';
import { analyzeProductIntelligence } from '../apps/api/src/services/productIntelligence/productIntelligenceAnalyzer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(path.join(repoRoot, '.env'));

async function main(): Promise<void> {
  const fromFile = process.env.USER_INPUT_FILE
    ? readFileSync(path.join(repoRoot, process.env.USER_INPUT_FILE), 'utf8')
    : undefined;
  const raw = (fromFile ?? process.env.USER_INPUT ?? '').trim();

  if (!raw) {
    console.log('没有检测到用户输入。请设置 USER_INPUT 或 USER_INPUT_FILE。\n');
    console.log('===== 前端输入指导 =====\n');
    console.log(USER_BRIEF_INPUT_GUIDANCE);
    return;
  }

  const useLlm = process.env.PI_LLM !== 'false';
  const brief = await parseContentBrief({ rawInput: raw, useLlm });
  console.log(`===== 1) 解析出的 ContentBrief (${brief.source}) =====`);
  console.log(JSON.stringify(brief.contentBrief, null, 2));
  brief.warnings.forEach((w) => console.log(`· ${w}`));

  const pi = await analyzeProductIntelligence({ contentBrief: brief.contentBrief, useLlm });
  console.log(`\n===== 2) Product Intelligence (${pi.productIntelligence.analysisSource}) =====`);
  console.log(JSON.stringify(pi.productIntelligence, null, 2));
  pi.warnings.forEach((w) => console.log(`· ${w}`));
  console.log('\n提示：跑完整 pipeline（含压缩+渲染交接）请用同样的 USER_INPUT 运行 manual_test_director_agent_timeline.ts。');
}

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

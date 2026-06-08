// THROWAWAY verify-runner: Doubao authors a HyperFrames composition + lint/inspect revise loop + render.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { config } from 'dotenv';
import type { ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import type { EditConstraints, VideoEditContext } from '@viral-struct/video-agent';
import { loadAssetLibrary } from './src/services/assetLibraryLoader';
import { getDemoShowcase } from './src/services/demoShowcase';
import { hyperframesRenderFromContext } from './src/services/hyperframesRenderService';
import { getAnalysisDir, getRepoRoot } from './src/services/videoPaths';

config({ path: path.join(getRepoRoot(), '.env') });

const graph = JSON.parse(readFileSync(path.join(getAnalysisDir(), 'macbook_neo', 'structure_graph.json'), 'utf-8')) as ViralStructureGraph;
const showcase = getDemoShowcase();
const contentBrief: ContentBrief = {
  productName: showcase.case.productName,
  targetAudience: showcase.case.targetAudience,
  scenario: showcase.case.scenario,
  sellingPoints: showcase.case.sellingPoints,
  cta: showcase.case.cta,
  stylePreference: '超酷、强动感、夏日冰感、快节奏、闪卡与真实产品图混排'
};
const assetCards = await loadAssetLibrary('kangshifu_demo');
const constraints: EditConstraints = { aspectRatio: '9:16', allowAigc: false, allowHumanGeneration: false, allowedClaimSources: [], forbiddenClaims: [] };
const context: VideoEditContext = { projectId: showcase.case.id, structureGraph: graph, contentBrief, assetCards, slotMatches: [], materialGaps: [], constraints };

console.log('authoring + lint/inspect revise + rendering via HyperFrames…');
const r = await hyperframesRenderFromContext(context);
console.log('=== RESULT ===');
console.log('source        :', r.source);
console.log('rendered      :', r.rendered);
console.log('mediaUrl      :', r.mediaUrl);
console.log('lint.ok       :', r.lint.ok, '| warnings:', r.lint.warnings.length);
console.log('inspectIssues :', r.inspectIssues.length, JSON.stringify(r.inspectIssues.slice(0, 5)));
console.log('projectDir    :', r.projectDir);
console.log('--- log ---');
console.log(r.log);

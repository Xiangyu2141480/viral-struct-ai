// struct-mock-server.mjs — zero-dependency contract stub for /api/struct/*
//
// Purpose: let the frontend verify its wiring against the documented contract
// (docs/API_CONTRACT.md §10) BEFORE the real backend ships those routes. Run it,
// open /demo, and every screen flips to LIVE — proving the fetch/parse/render
// chain matches the shapes in apps/web/app/_struct/api/types.ts.
//
// It impersonates the backend on port 4000 (the frontend's default
// NEXT_PUBLIC_API_BASE), so no env config is needed. Run EITHER this OR the real
// API on 4000, not both.
//
//   node apps/web/mock/struct-mock-server.mjs          # port 4000
//   PORT=4100 node apps/web/mock/struct-mock-server.mjs # custom port
//
// Every response carries a warning tagging it as mock-server data, so the demo's
// StatusBanner reminds you these are stubs, not the real pipeline.

import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4000);
const MOCK_TAG = '🔌 来自契约 mock server（非真实后端）';

/* ─── canned fixtures (multipart endpoints can't be echoed easily) ─── */

const MOCK_SOURCE_VIDEO = {
  id: 'mock-src-001',
  title: 'mock-server 解析样例',
  platform: '抖音',
  duration: 38,
  views: '1203.4w',
  likes: '88.1w',
  finish_rate: 0.41,
  ctr: 0.092,
  cvr: 0.031,
  protocol_version: 'structure-ir/mock-1',
  segments: [
    { id: 's1', role: 'hook',    start: 0,  end: 3,  label: '开场钩子', shot: '反差特写',   caption: '你绝对想不到…' },
    { id: 's2', role: 'pain',    start: 3,  end: 9,  label: '痛点共鸣', shot: '生活场景',   caption: '每次都这样头疼' },
    { id: 's3', role: 'product', start: 9,  end: 18, label: '产品展示', shot: '产品特写',   caption: '直到我遇到它' },
    { id: 's4', role: 'compare', start: 18, end: 26, label: '效果对比', shot: '前后对比',   caption: '差距一目了然' },
    { id: 's5', role: 'social',  start: 26, end: 33, label: '信任背书', shot: '证书/评价',   caption: '十万人都在用' },
    { id: 's6', role: 'cta',     start: 33, end: 38, label: '行动号召', shot: '价格+引导',   caption: '点击下方立即购买' },
  ],
  rhythm: { avg_shot: 2.4, cuts: 16, hook_density: '高', bgm_bpm: 128, caption_density: '密' },
  packaging: {
    title_template: '【揭秘】{产品}竟然能…',
    captions: '全程硬字幕',
    bgm: '快节奏电子',
    cover: '反差大字封面',
  },
};

const MOCK_MATERIALS = [
  { id: 'mm1', kind: 'photo', subject: 'mock 产品正面图', slot: 's3', quality: 0.88, color: '#3d4a3a' },
  { id: 'mm2', kind: 'photo', subject: 'mock 使用场景图', slot: 's4', quality: 0.74, color: '#414b4d' },
  { id: 'mm3', kind: 'photo', subject: 'mock 包装礼盒图', slot: 's6', quality: 0.81, color: '#5d3b2b' },
  { id: 'mm4', kind: 'text',  subject: 'mock 标题/卖点',  slot: null, quality: 0.55 },
];

/* ─── helpers ─── */

const STATES = ['filled', 'weakly', 'missing', 'critical'];

/** Build a Diagnosis record keyed by the request's segment ids (or fallback). */
function buildDiagnosis(sourceVideo) {
  const segs = sourceVideo?.segments?.length ? sourceVideo.segments : MOCK_SOURCE_VIDEO.segments;
  const diagnosis = {};
  segs.forEach((seg, i) => {
    const state = STATES[i % STATES.length];
    diagnosis[seg.id] = {
      state,
      have: state === 'filled' ? ['已有匹配素材'] : [],
      need: state === 'filled' ? [] : ['主体特写', '情境镜头'],
      gap_reason: state === 'filled' ? '素材充分覆盖该槽位' : `mock: 槽位 ${seg.id} 缺少支撑素材`,
      impact: { dim: seg.role ?? 'hook', pct: state === 'filled' ? 0 : -22, note: 'mock 影响评估' },
      fix: state === 'filled' ? null : { kind: '复用+合成', desc: `mock: 为 ${seg.id} 合成补全镜头` },
      strategy: state === 'filled' ? null : 'hyperframes',
    };
  });
  return diagnosis;
}

/** Build a playable timeline from the request's segments + diagnosis. */
function buildTimeline(sourceVideo, diagnosis = {}) {
  const segs = sourceVideo?.segments?.length ? sourceVideo.segments : MOCK_SOURCE_VIDEO.segments;
  return segs.map((seg) => ({
    id: seg.id,
    role: seg.role,
    start: seg.start,
    end: seg.end,
    label: seg.label,
    shot: seg.shot,
    caption: seg.caption,
    fixKind: diagnosis[seg.id]?.fix?.kind ?? null,
  }));
}

function synthVersion(versionId) {
  const id = versionId || 'click';
  return {
    id,
    name: `mock ${id} 版`,
    desc: 'mock-server 合成版本',
    bias: 'mock: 偏向演示，无真实权衡',
    stats: [
      { k: 'CTR', v: '+18%', up: true },
      { k: '完播', v: '+9pt', up: true },
      { k: '加购', v: '+5%', up: true },
    ],
    mainStrat: 'pack',
  };
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

/** Read + JSON-parse the request body; returns {} for empty/multipart/non-JSON. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const ct = req.headers['content-type'] ?? '';
      if (!raw || !ct.includes('application/json')) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

const w = (...extra) => [MOCK_TAG, ...extra];

/* ─── router ─── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') return send(res, 204, {});

  // GET /api/struct/export/:jobId
  const exportMatch = path.match(/^\/api\/struct\/export\/(.+)$/);
  if (method === 'GET' && exportMatch) {
    const jobId = decodeURIComponent(exportMatch[1]);
    return send(res, 200, { jobId, status: 'done', progress: 100, downloadUrl: `/mock-renders/${jobId}.mp4`, warnings: w() });
  }

  if (method === 'GET' && path === '/health') return send(res, 200, { ok: true, mock: true });

  if (method !== 'POST') return send(res, 404, { error: `mock: no route for ${method} ${path}` });

  const body = await readBody(req);
  console.log(`[mock] POST ${path}`);

  switch (path) {
    case '/api/struct/sample/analyze':
      return send(res, 200, { sourceVideo: MOCK_SOURCE_VIDEO, warnings: w('样例为 mock-server 固定结构') });

    case '/api/struct/materials/upload':
      return send(res, 200, { materials: MOCK_MATERIALS, warnings: w('素材为 mock-server 固定卡片') });

    case '/api/struct/materials/match': {
      const { materials = [], assignments = {} } = body;
      const merged = materials.map((m) => (m && m.id in assignments ? { ...m, slot: assignments[m.id] } : m));
      return send(res, 200, { materials: merged.length ? merged : MOCK_MATERIALS, warnings: w() });
    }

    case '/api/struct/diagnose':
      return send(res, 200, { diagnosis: buildDiagnosis(body.sourceVideo), warnings: w() });

    case '/api/struct/strategy/apply': {
      const { slotId, diagnosis = {} } = body;
      const next = { ...diagnosis };
      if (slotId && next[slotId]) {
        next[slotId] = { ...next[slotId], state: 'filled', fix: null, strategy: null, gap_reason: 'mock: 策略已应用' };
      }
      return send(res, 200, { diagnosis: next, appliedSlots: slotId ? [slotId] : [], warnings: w() });
    }

    case '/api/struct/compile':
      return send(res, 200, {
        version: synthVersion(body.versionId),
        timeline: buildTimeline(body.sourceVideo, body.diagnosis),
        warnings: w(),
      });

    case '/api/struct/nl-edit': {
      const timeline = Array.isArray(body.timeline) && body.timeline.length
        ? body.timeline
        : buildTimeline(body.sourceVideo);
      return send(res, 200, {
        timeline,
        patchSummary: `mock: 已套用改片指令「${body.instruction ?? ''}」`,
        warnings: w(),
      });
    }

    case '/api/struct/export': {
      const jobId = `mock-${Date.now()}`;
      return send(res, 200, { jobId, status: 'done', progress: 100, downloadUrl: `/mock-renders/${jobId}.mp4`, warnings: w() });
    }

    default:
      return send(res, 404, { error: `mock: no route for POST ${path}` });
  }
});

server.listen(PORT, () => {
  console.log(`\n  ⚡ struct-mock-server listening on http://localhost:${PORT}`);
  console.log(`     serving /api/struct/* contract stubs (docs/API_CONTRACT.md §10)`);
  console.log(`     point the demo at it via NEXT_PUBLIC_API_BASE (default already :4000)\n`);
});

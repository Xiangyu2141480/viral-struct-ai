// data.jsx — Mock fixtures for the 爆款结构迁移引擎 prototype
// (Loaded as plain JS via Babel; exposes window globals.)

// Step spine (the spine bar — present on every screen)
const STEPS = [
  { id: "source",    num: "01", label: "样例",   tag: "SOURCE",     short: "样例解析" },
  { id: "materials", num: "02", label: "素材",   tag: "ASSETS",     short: "新品素材" },
  { id: "diagnose",  num: "03", label: "诊断",   tag: "DIAGNOSE",   short: "缺口诊断" },
  { id: "compile",   num: "04", label: "成片",   tag: "COMPILE",    short: "时间线编译" },
];

// Source viral video — abstract structure (StructureIR)
const SOURCE_VIDEO = {
  id: "douyin_2786341",
  title: "母亲的旧手镯 · 母亲节情感转化",
  platform: "抖音",
  duration: 28.4,
  views: "2.3M",
  likes: "186K",
  finish_rate: 0.42,
  ctr: 0.081,
  cvr: 0.034,
  protocol_version: "StructureIR.v2.3.1",
  segments: [
    { id: "s1", role: "hook",    start: 0.0,  end: 2.8,  label: "开场抓停",
      shot: "母亲手部特写 + 旧手镯", caption: "妈妈手上这只手镯，戴了二十年" },
    { id: "s2", role: "pain",    start: 2.8,  end: 6.2,  label: "问题抛出",
      shot: "镯子磨损细节 + 字幕递进", caption: "她舍不得换，因为是你爸送的" },
    { id: "s3", role: "emotion", start: 6.2,  end: 11.4, label: "情绪代入",
      shot: "母亲日常 / 切菜 / 浇花", caption: "可你也该送她一只属于自己的了" },
    { id: "s4", role: "product", start: 11.4, end: 17.2, label: "产品登场",
      shot: "产品三视角 + 工艺特写", caption: "和田玉福镯 · 一体工艺无接缝" },
    { id: "s5", role: "compare", start: 17.2, end: 21.0, label: "价值放大",
      shot: "同类产品并列 + 价格标", caption: "市面同款卖 2999，工厂直供 599" },
    { id: "s6", role: "social",  start: 21.0, end: 24.6, label: "信任补强",
      shot: "买家秀拼接 + 五星评分", caption: "1.2 万妈妈已收到 · 4.9 分" },
    { id: "s7", role: "cta",     start: 24.6, end: 28.4, label: "行动收口",
      shot: "倒计时 + 下单按钮闪动", caption: "母亲节最后 12 小时 · 立即下单" },
  ],
  // Transitions are first-class "special slots". A transition can NEVER be 缺失/关键缺失:
  // 硬切(hard cut) is a free, unconditional fallback, so the floor is always 弱满足.
  //   已满足(filled)  = a rich transition (叠化/推镜/卡点) is actually applied
  //   弱满足(weakly)  = only 硬切 applied — either intended, or a degraded fallback
  // `type` = what the source structure intended; `applied` = what we can actually do now.
  transitions: [
    { id: "t1", from: "s1", to: "s2", at: 2.8,  type: "硬切", applied: "硬切",
      state: "weakly", upgradable: false, dur: 0.0, intendedDur: 0.0,
      need: ["硬切"], have: ["硬切"],
      gap_reason: "原结构此处即为硬切，已达原意 —— 弱满足是它的天花板，不是缺口",
      impact: { dim: "rhythm", pct: 0, note: "符合原结构，无损失" },
      fix: null, note: "钩子结束硬切入痛点，制造节奏顿挫" },
    { id: "t2", from: "s2", to: "s3", at: 6.2,  type: "叠化", applied: "硬切",
      state: "weakly", upgradable: true, dur: 0.0, intendedDur: 0.4,
      need: ["s2 出帧", "s3 入帧"], have: ["s3 入帧"],
      gap_reason: "原结构用叠化柔化痛点→情绪；但 s2 素材缺失，叠化无源可化，降级为硬切",
      impact: { dim: "emotion", pct: -15, note: "情绪过渡变生硬，emotion 衰减约 15%" },
      fix: { kind: "补邻槽素材 / 合成过渡帧", desc: "补 s2 出帧 → 叠化成立(升为已满足)；或合成一帧闪白过渡顶替硬切" },
      note: "原：叠化 0.4s → 现：硬切" },
    { id: "t3", from: "s3", to: "s4", at: 11.4, type: "推镜", applied: "推镜",
      state: "filled", upgradable: false, dur: 0.3, intendedDur: 0.5,
      need: ["产品起幅(宽景)"], have: ["产品特写"],
      gap_reason: "—",
      impact: { dim: "rhythm", pct: 0, note: "推镜成立(起幅略受限，行程 0.3s)" },
      fix: { kind: "可选增强", desc: "补 1 张产品宽景 → 推镜行程拉满 0.5s" }, note: "情绪推近，揭示产品" },
    { id: "t4", from: "s4", to: "s5", at: 17.2, type: "硬切", applied: "硬切",
      state: "weakly", upgradable: false, dur: 0.0, intendedDur: 0.0,
      need: ["硬切"], have: ["硬切"],
      gap_reason: "原结构此处即为硬切，强调产品→价格反差 —— 符合原意",
      impact: { dim: "rhythm", pct: 0, note: "符合原结构，无损失" },
      fix: null, note: "产品硬切到价格对比，强调反差" },
    { id: "t5", from: "s5", to: "s6", at: 21.0, type: "卡点", applied: "卡点",
      state: "filled", upgradable: false, dur: 0.3, intendedDur: 0.3,
      need: ["BGM 鼓点", "干脆切换"], have: ["BGM 88BPM", "证书→买家秀切换"],
      gap_reason: "—",
      impact: { dim: "rhythm", pct: 0, note: "卡点成立，节奏锁定" },
      fix: null, note: "随 BGM 鼓点卡点切到证言" },
    { id: "t6", from: "s6", to: "s7", at: 24.6, type: "叠化", applied: "叠化",
      state: "filled", upgradable: false, dur: 0.3, intendedDur: 0.3,
      need: ["s6 出帧", "s7 入帧"], have: ["s6 出帧", "s7 入帧"],
      gap_reason: "—",
      impact: { dim: "emotion", pct: 0, note: "叠化成立，平稳落地" },
      fix: null, note: "证言叠化收束到 CTA" },
  ],
  rhythm: {
    avg_shot: 1.6,          // seconds
    cuts: 17,
    hook_density: "高",      // 0-3s 内信息密度
    bgm_bpm: 88,
    caption_density: "高",
  },
  packaging: {
    title_template: "她{动作}{年限}年了 · {情感锚}",
    captions: "白底黑字 + 红色重点",
    bgm: "钢琴慢节奏 / 副歌进入卖点",
    cover: "母亲手部 + 文字钩子",
  },
};

// Role meta (role colors are encoded in CSS)
// New naming: EN code + 短中文 (e.g. "HOOK · 开场抓停")
const ROLES = {
  hook:    { code: "HOOK",     name: "开场抓停",  desc: "前 3 秒抓人，最强信息密度" },
  pain:    { code: "PROBLEM",  name: "问题抛出",  desc: "把用户的真实焦虑摆上桌" },
  emotion: { code: "EMPATHY",  name: "情绪代入",  desc: "建立共情与代入感" },
  product: { code: "SOLUTION", name: "产品登场",  desc: "产品/工艺/差异化展示" },
  compare: { code: "VALUE",    name: "价值放大",  desc: "价值锚定 / 锚价对比" },
  social:  { code: "TRUST",    name: "信任补强",  desc: "社会证明 / 评价滚动" },
  cta:     { code: "CTA",      name: "行动收口",  desc: "下单指令 / 紧迫感" },
};

// Target product (the merchant's new product)
const TARGET_PRODUCT = {
  name: "和田玉福镯 · 送母亲",
  category: "首饰 / 玉石",
  price: "¥ 599",
  stock: 4200,
  asset_count: 5,
  industry: "中老年女性礼赠",
};

// User-uploaded materials (just 5 photos + 1 text)
const TARGET_MATERIALS = [
  { id: "m1", kind: "photo", subject: "产品正面图",   slot: "s4", quality: 0.9, color: "#3d4a3a" },
  { id: "m2", kind: "photo", subject: "产品工艺特写", slot: "s4", quality: 0.8, color: "#414b4d" },
  { id: "m3", kind: "photo", subject: "礼盒包装图",   slot: "s7", quality: 0.85, color: "#5d3b2b" },
  { id: "m4", kind: "photo", subject: "佩戴上手图",   slot: "s6", quality: 0.7, color: "#4d3a2a" },
  { id: "m5", kind: "photo", subject: "证书 / 鉴定卡", slot: "s5", quality: 0.6, color: "#3a3a47" },
  { id: "m6", kind: "text",  subject: "商品标题/卖点", slot: null, quality: 0.5 },
];

// Diagnostic state per slot
const SLOT_DIAGNOSIS = {
  s1: {
    state: "missing",
    have: [],
    need: ["主体特写", "情境镜头"],
    gap_reason: "缺少能在 0-3 秒制造好奇心或情绪反差的镜头素材",
    impact: { dim: "hook", pct: -38, note: "若不补全，预计完播率从 38% 跌至 19%" },
    fix: { kind: "复用+合成", desc: "用 m4 佩戴上手图前 0.6s 反差剪辑 + 文案钩子" },
    strategy: "hyperframes",
    fill: {
      reshoot: {
        guide: "补拍一个能在 0-3 秒制造好奇或反差的开场镜头，竖屏 9:16、侧逆光。",
        shots: ["手腕佩戴手镯特写，自然侧光", "0.5s 内一个动作反差：摘下 / 戴上"],
      },
      hyperframes: {
        uses: ["m4"],
        desc: "抽 m4 佩戴图前 0.6s，叠文案钩子 + 快速变焦反差，凑出一个开场镜头。",
      },
      aigc: {
        prompt: "母亲手腕佩戴和田玉手镯的特写，温暖侧逆光，皮肤有岁月感，镜头缓慢推近，情绪克制，9:16 竖屏，真实纪录片质感",
      },
    },
  },
  s2: {
    state: "critical",
    have: [],
    need: ["细节磨损/痕迹特写", "动态字幕"],
    gap_reason: "无任何承接痛点的视觉素材，原结构在此处建立共鸣",
    impact: { dim: "trust", pct: -42, note: "情感共鸣链路断裂，跳过情感直入卖点会让 trust 大幅下降" },
    fix: { kind: "补拍 / 文案替代", desc: "建议 1 张磨损细节图 + 文案条" },
    strategy: "aigc",
    fill: {
      reshoot: {
        guide: "补拍能承接痛点、体现『戴了二十年』的磨损细节，最能救这个关键缺口。",
        shots: ["旧手镯磨损 / 包浆细节微距", "母亲手部劳作日常一镜"],
      },
      hyperframes: {
        uses: ["m6"],
        desc: "无可复用图像，仅能用 m6 文案做纯字幕条兜底 —— 效果弱，强烈建议补拍或 AIGC。",
      },
      aigc: {
        prompt: "一只戴了二十年的旧玉镯，表面有自然磨损与包浆，微距特写，暖调，背景虚化，怀旧情绪，9:16 竖屏",
      },
    },
  },
  s3: {
    state: "weakly",
    have: ["m6 文案"],
    need: ["生活场景镜头", "母亲特写"],
    gap_reason: "仅有文案，缺少能托住情感铺垫的视觉",
    impact: { dim: "emotion", pct: -18, note: "可由 m4 + 慢摇动效兜底，强度略减" },
    fix: { kind: "素材复用", desc: "复用 m4 + 加缓慢 Ken Burns 推近" },
    strategy: "hyperframes",
    fill: {
      reshoot: {
        guide: "补拍母亲的日常生活片段，建立情感代入与信任。",
        shots: ["母亲切菜 / 浇花的侧影", "母亲自然微笑特写"],
      },
      hyperframes: {
        uses: ["m4"],
        desc: "复用 m4 + Ken Burns 缓慢推近 + 暖色情绪滤镜，托住情感铺垫。",
      },
      aigc: {
        prompt: "一位年长母亲在厨房做家务的温暖生活场景，自然光，侧影，温馨克制，9:16 竖屏",
      },
    },
  },
  s4: {
    state: "filled",
    have: ["m1 正面图", "m2 工艺特写"],
    need: ["产品镜头 ≥ 2"],
    gap_reason: "—",
    impact: { dim: "product", pct: 0, note: "卖点展示槽位已被两张产品图完整覆盖" },
    fix: null,
    strategy: null,
  },
  s5: {
    state: "filled",
    have: ["m5 鉴定证书"],
    need: ["价值锚定素材"],
    gap_reason: "—",
    impact: { dim: "compare", pct: 0, note: "证书作锚定即可" },
    fix: { kind: "包装增强", desc: "加价格对比卡 ¥599 vs ¥2999 字幕" },
    strategy: "hyperframes",
  },
  s6: {
    state: "weakly",
    have: ["m4 佩戴图"],
    need: ["买家秀 ≥ 3", "评分截图"],
    gap_reason: "仅 1 张佩戴图，缺多样性带来的证言密度",
    impact: { dim: "social", pct: -22, note: "可生成评分卡片 + 评论文本墙补足" },
    fix: { kind: "包装合成", desc: "生成评分卡片 + 评论滚动墙" },
    strategy: "aigc",
    fill: {
      reshoot: {
        guide: "收集真实买家秀与评分截图，证言密度越高越可信。",
        shots: ["3+ 张不同买家佩戴实拍", "店铺 4.9 分评分截图"],
      },
      hyperframes: {
        uses: ["m4"],
        desc: "用 m4 + 合成评分卡片 + 评论滚动墙，凑出证言密度（包装合成）。",
      },
      aigc: {
        prompt: "多位不同年龄女性佩戴玉镯的买家秀拼贴，真实手机拍摄质感，生活化背景，9:16 竖屏",
      },
    },
  },
  s7: {
    state: "filled",
    have: ["m3 礼盒图"],
    need: ["产品/包装 + 倒计时"],
    gap_reason: "—",
    impact: { dim: "cta", pct: 0, note: "礼盒图配合倒计时包装即可" },
    fix: { kind: "包装合成", desc: "添加倒计时数字卡 + CTA 按钮动效" },
    strategy: "hyperframes",
  },
};

// Three competing source structures for the Structure Lab
const LAB_STRUCTURES = [
  {
    id: "A",
    code: "STR-A",
    name: "情感转化型 · 母亲节原版",
    source_title: "母亲的旧手镯",
    family: "情感共鸣",
    bgm: "钢琴慢板 88 BPM",
    sequence: ["hook", "pain", "emotion", "product", "compare", "social", "cta"],
    durations: [2.8, 3.4, 5.2, 5.8, 3.8, 3.6, 3.8],
    sig: { 节奏: "慢-中-慢", 包装: "情感字幕白底红重点", "段落顺序": "痛点先行 → 卖点延后", 预测点击: "8.1%", 预测完播: "41%" },
    color: "oklch(0.70 0.08 350)",
  },
  {
    id: "B",
    code: "STR-B",
    name: "硬卖型 · 工厂直营爆款",
    source_title: "工厂直发 · 0 中间商",
    family: "对比锚价",
    bgm: "鼓点节奏 124 BPM",
    sequence: ["hook", "product", "compare", "compare", "social", "cta", "cta"],
    durations: [1.6, 4.2, 3.6, 3.4, 3.8, 2.4, 2.0],
    sig: { 节奏: "急-急-急", 包装: "黄底黑字大号弹幕", "段落顺序": "卖点+对比强压", 预测点击: "9.4%", 预测完播: "29%" },
    color: "oklch(0.72 0.10 75)",
  },
  {
    id: "C",
    code: "STR-C",
    name: "测评信任型 · 鉴定开箱",
    source_title: "开箱鉴定 · 这只值不值",
    family: "理性信任",
    bgm: "环境音 + 提示音",
    sequence: ["hook", "product", "product", "social", "compare", "social", "cta"],
    durations: [2.4, 3.8, 4.2, 4.0, 3.6, 4.0, 2.4],
    sig: { 节奏: "中-中-中", 包装: "深色底+证书印章", "段落顺序": "拆解+证书+口碑", 预测点击: "6.8%", 预测完播: "48%" },
    color: "oklch(0.68 0.08 248)",
  },
];

// Comparison dimensions across structures
const LAB_DIFF_ROWS = [
  "段落顺序",
  "节奏",
  "包装",
  "预测点击",
  "预测完播",
];

// ─── 结构样例库: classic viral video examples ──────────────
const LIBRARY_VIDEOS = [
  {
    id: "lib_001",
    title: "母亲的旧手镯 · 母亲节情感转化",
    platform: "抖音",
    category: "首饰 / 玉石",
    family: "情感共鸣",
    duration: 28.4,
    views: "2.3M",
    likes: "186K",
    ctr: "8.1%",
    cvr: "3.4%",
    finish_rate: "42%",
    bgm: "钢琴慢板 88 BPM",
    color: "oklch(0.70 0.08 350)",
    segments: [
      { role: "hook", dur: 2.8, label: "开场抓停", shot: "母亲手部特写 + 旧手镯" },
      { role: "pain", dur: 3.4, label: "问题抛出", shot: "镯子磨损细节 + 字幕递进" },
      { role: "emotion", dur: 5.2, label: "情绪代入", shot: "母亲日常 / 切菜 / 浇花" },
      { role: "product", dur: 5.8, label: "产品登场", shot: "产品三视角 + 工艺特写" },
      { role: "compare", dur: 3.8, label: "价值放大", shot: "同类产品并列 + 价格标" },
      { role: "social", dur: 3.6, label: "信任补强", shot: "买家秀拼接 + 五星评分" },
      { role: "cta", dur: 3.8, label: "行动收口", shot: "倒计时 + 下单按钮闪动" },
    ],
    packaging: { captions: "白底黑字 + 红色重点", cover: "母亲手部 + 文字钩子" },
    tags: ["母亲节", "情感", "礼赠", "中老年"],
  },
  {
    id: "lib_002",
    title: "工厂直发 · 0 中间商",
    platform: "抖音",
    category: "数码 / 耳机",
    family: "对比锚价",
    duration: 21.0,
    views: "5.7M",
    likes: "342K",
    ctr: "9.4%",
    cvr: "4.1%",
    finish_rate: "29%",
    bgm: "鼓点节奏 124 BPM",
    color: "oklch(0.72 0.10 75)",
    segments: [
      { role: "hook", dur: 1.6, label: "价格反差", shot: "大字价格闪出 + 质疑语气" },
      { role: "product", dur: 4.2, label: "产品速览", shot: "耳机旋转展示 + 拆解" },
      { role: "compare", dur: 3.6, label: "对比锚价", shot: "并排品牌耳机 vs 白牌" },
      { role: "compare", dur: 3.4, label: "参数碾压", shot: "规格表滚动 + 高亮" },
      { role: "social", dur: 3.8, label: "真实测评", shot: "博主上耳实拍 + 反应" },
      { role: "cta", dur: 2.4, label: "限时抢购", shot: "库存倒计时 + 价格牌" },
      { role: "cta", dur: 2.0, label: "紧迫收口", shot: "仅剩 XX 件弹窗" },
    ],
    packaging: { captions: "黄底黑字大号弹幕", cover: "价格对比封面" },
    tags: ["3C", "对比", "性价比", "冲动消费"],
  },
  {
    id: "lib_003",
    title: "开箱鉴定 · 这只值不值",
    platform: "小红书",
    category: "美妆 / 护肤",
    family: "理性信任",
    duration: 24.4,
    views: "1.8M",
    likes: "98K",
    ctr: "6.8%",
    cvr: "2.9%",
    finish_rate: "48%",
    bgm: "环境音 + 提示音",
    color: "oklch(0.68 0.08 248)",
    segments: [
      { role: "hook", dur: 2.4, label: "悬念开箱", shot: "快递拆封 + 期待字幕" },
      { role: "product", dur: 3.8, label: "产品拆解", shot: "成分表特写 + 手感展示" },
      { role: "product", dur: 4.2, label: "深度体验", shot: "上脸实测 + 前后对比" },
      { role: "social", dur: 4.0, label: "口碑证据", shot: "评论截图 + KOL推荐" },
      { role: "compare", dur: 3.6, label: "竞品对比", shot: "3 款产品并排测试" },
      { role: "social", dur: 4.0, label: "最终判定", shot: "打分卡 + 推荐等级" },
      { role: "cta", dur: 2.4, label: "购买引导", shot: "链接提示 + 优惠码" },
    ],
    packaging: { captions: "深色底 + 证书印章", cover: "开箱悬念封面" },
    tags: ["测评", "开箱", "理性决策", "成分党"],
  },
  {
    id: "lib_004",
    title: "30 天挑战 · 从 0 到逆袭",
    platform: "抖音",
    category: "健身 / 器械",
    family: "过程叙事",
    duration: 32.6,
    views: "8.1M",
    likes: "520K",
    ctr: "7.2%",
    cvr: "2.1%",
    finish_rate: "51%",
    bgm: "渐强电子 110 BPM",
    color: "oklch(0.70 0.10 155)",
    segments: [
      { role: "hook", dur: 2.2, label: "结果前置", shot: "before/after 对比闪切" },
      { role: "pain", dur: 3.8, label: "起点困境", shot: "Day 1 痛苦训练 + 自嘲" },
      { role: "emotion", dur: 6.4, label: "过程蒙太奇", shot: "Day 3-20 快剪 + 配文" },
      { role: "product", dur: 4.8, label: "秘密武器", shot: "器械特写 + 使用教学" },
      { role: "emotion", dur: 5.2, label: "突破时刻", shot: "Day 25 明显变化 + 激动" },
      { role: "social", dur: 4.6, label: "粉丝跟练", shot: "评论区跟练打卡截图" },
      { role: "cta", dur: 5.6, label: "号召行动", shot: "同款链接 + 挑战tag" },
    ],
    packaging: { captions: "运动风手写字体", cover: "前后对比封面" },
    tags: ["健身", "挑战", "蜕变", "vlog"],
  },
  {
    id: "lib_005",
    title: "闺蜜安利 · 回购 5 次的面膜",
    platform: "小红书",
    category: "美妆 / 面膜",
    family: "闺蜜种草",
    duration: 18.6,
    views: "3.2M",
    likes: "210K",
    ctr: "10.2%",
    cvr: "5.3%",
    finish_rate: "38%",
    bgm: "轻快吉他 96 BPM",
    color: "oklch(0.68 0.08 305)",
    segments: [
      { role: "hook", dur: 1.8, label: "夸张反应", shot: "闺蜜惊讶表情 + 问询" },
      { role: "emotion", dur: 3.2, label: "使用场景", shot: "敷面膜日常 + 闲聊" },
      { role: "product", dur: 4.4, label: "产品展示", shot: "质地特写 + 成分讲解" },
      { role: "social", dur: 3.6, label: "回购证据", shot: "空瓶展示 + 购买记录" },
      { role: "compare", dur: 2.8, label: "简短对比", shot: "同价位产品快速PK" },
      { role: "cta", dur: 2.8, label: "安利收口", shot: "购买链接 + 活动价" },
    ],
    packaging: { captions: "粉色气泡字幕", cover: "闺蜜合照 + 产品" },
    tags: ["种草", "闺蜜", "面膜", "回购"],
  },
  {
    id: "lib_006",
    title: "老板亲自砍价 · 源头直播间",
    platform: "快手",
    category: "食品 / 零食",
    family: "人设带货",
    duration: 26.2,
    views: "4.5M",
    likes: "278K",
    ctr: "8.8%",
    cvr: "6.7%",
    finish_rate: "33%",
    bgm: "无BGM / 现场收音",
    color: "oklch(0.65 0.12 22)",
    segments: [
      { role: "hook", dur: 2.6, label: "现场冲突", shot: "老板拍桌 + 砍价喊话" },
      { role: "pain", dur: 3.2, label: "价格痛点", shot: "超市同款价格标签" },
      { role: "product", dur: 5.4, label: "源头展示", shot: "工厂/产地实拍" },
      { role: "compare", dur: 4.2, label: "成本拆解", shot: "价格组成图 + 对比" },
      { role: "social", dur: 4.8, label: "现场试吃", shot: "工人/路人试吃反馈" },
      { role: "emotion", dur: 2.4, label: "人情味", shot: "和工人聊天 + 故事" },
      { role: "cta", dur: 3.6, label: "限量开抢", shot: "库存倒计时 + 上链接" },
    ],
    packaging: { captions: "红色粗体 + 价格闪标", cover: "老板怼脸封面" },
    tags: ["源头", "砍价", "人设", "直播切片"],
  },
];

// ─── 历史版本: previously generated materials ──────────────
const HISTORY_RECORDS = [
  {
    id: "hist_001",
    title: "和田玉福镯 · 高点击版",
    source_title: "母亲的旧手镯",
    source_family: "情感共鸣",
    created: "2026-06-04 18:32",
    version: "v3 · CLICK",
    duration: "28.4s",
    status: "done",
    stats: { ctr: "8.1%", finish: "41%", convert: "3.4%" },
    color: "oklch(0.70 0.08 350)",
    segments: ["hook", "pain", "emotion", "product", "compare", "social", "cta"],
    product: "和田玉福镯 · 送母亲",
  },
  {
    id: "hist_002",
    title: "和田玉福镯 · 高转化版",
    source_title: "母亲的旧手镯",
    source_family: "情感共鸣",
    created: "2026-06-04 17:15",
    version: "v3 · CONVERT",
    duration: "28.4s",
    status: "done",
    stats: { ctr: "6.5%", finish: "38%", convert: "5.1%" },
    color: "oklch(0.78 0.10 192)",
    segments: ["hook", "product", "compare", "emotion", "social", "cta", "cta"],
    product: "和田玉福镯 · 送母亲",
  },
  {
    id: "hist_003",
    title: "蓝牙耳机 · 性价比硬卖",
    source_title: "工厂直发 · 0 中间商",
    source_family: "对比锚价",
    created: "2026-06-03 14:08",
    version: "v2 · CLICK",
    duration: "21.0s",
    status: "done",
    stats: { ctr: "9.4%", finish: "29%", convert: "4.1%" },
    color: "oklch(0.72 0.10 75)",
    segments: ["hook", "product", "compare", "compare", "social", "cta"],
    product: "AirX Pro 降噪耳机",
  },
  {
    id: "hist_004",
    title: "美白精华 · 测评信任型",
    source_title: "开箱鉴定 · 这只值不值",
    source_family: "理性信任",
    created: "2026-06-02 09:44",
    version: "v1 · PREMIUM",
    duration: "24.4s",
    status: "draft",
    stats: { ctr: "6.8%", finish: "48%", convert: "2.9%" },
    color: "oklch(0.68 0.08 248)",
    segments: ["hook", "product", "product", "social", "compare", "cta"],
    product: "亮白精华 30ml",
  },
  {
    id: "hist_005",
    title: "健身器械 · 过程叙事版",
    source_title: "30 天挑战 · 从 0 到逆袭",
    source_family: "过程叙事",
    created: "2026-05-30 20:11",
    version: "v2 · CLICK",
    duration: "32.6s",
    status: "done",
    stats: { ctr: "7.2%", finish: "51%", convert: "2.1%" },
    color: "oklch(0.70 0.10 155)",
    segments: ["hook", "pain", "emotion", "product", "emotion", "social", "cta"],
    product: "多功能哑铃凳",
  },
  {
    id: "hist_006",
    title: "面膜 · 闺蜜种草版",
    source_title: "闺蜜安利 · 回购 5 次的面膜",
    source_family: "闺蜜种草",
    created: "2026-05-28 11:22",
    version: "v1 · CONVERT",
    duration: "18.6s",
    status: "done",
    stats: { ctr: "10.2%", finish: "38%", convert: "5.3%" },
    color: "oklch(0.68 0.08 305)",
    segments: ["hook", "emotion", "product", "social", "compare", "cta"],
    product: "水光面膜礼盒装",
  },
];

// Transition-type metadata — the visual + semantic vocabulary of seams.
// Kept neutral (no role colors, no four-state colors) to protect the color budget;
// only the accent cyan is used for emphasis.
const TRANSITION_TYPES = {
  硬切: { code: "CUT",      glyph: "cut",      desc: "硬切 · 无过渡素材，节奏顿挫" },
  叠化: { code: "DISSOLVE", glyph: "dissolve", desc: "叠化 · 两镜半透明交叠" },
  推镜: { code: "PUSH",     glyph: "push",     desc: "推镜 · 镜头推近承接" },
  卡点: { code: "BEAT",     glyph: "beat",     desc: "卡点 · 随 BGM 鼓点切换" },
};

// expose
window.STEPS = STEPS;
window.SOURCE_VIDEO = SOURCE_VIDEO;
window.ROLES = ROLES;
window.TRANSITION_TYPES = TRANSITION_TYPES;
window.TARGET_PRODUCT = TARGET_PRODUCT;
window.TARGET_MATERIALS = TARGET_MATERIALS;
window.SLOT_DIAGNOSIS = SLOT_DIAGNOSIS;
window.LAB_STRUCTURES = LAB_STRUCTURES;
window.LAB_DIFF_ROWS = LAB_DIFF_ROWS;
window.LIBRARY_VIDEOS = LIBRARY_VIDEOS;
window.HISTORY_RECORDS = HISTORY_RECORDS;

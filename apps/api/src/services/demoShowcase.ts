export interface DemoShowcaseCase {
  id: string;
  title: string;
  seedFilename: string;
  manualTranscript: string;
  productName: string;
  targetAudience: string;
  scenario: string;
  sellingPoints: string[];
  cta: string;
  stylePreference: string;
  assetBrief: string;
}

export interface DemoShowcaseStep {
  id: string;
  label: string;
  route: string;
  output: string;
  judgeSignal: string;
}

export interface DemoScoreEvidence {
  taskId: string;
  taskName: string;
  points: number;
  route: string;
  evidence: string;
}

export interface DemoShowcase {
  case: DemoShowcaseCase;
  steps: DemoShowcaseStep[];
  scoreEvidence: DemoScoreEvidence[];
}

export function getChampionDemoShowcase(): DemoShowcase {
  return {
    case: {
      id: 'portable_coffee_cup_gap_repair',
      title: '便携咖啡杯：少素材结构迁移主案例',
      seedFilename: 'huaxizi.mp4',
      manualTranscript:
        '开头先用强问题抓住注意。普通选择很难兼顾质感和效率。核心卖点要快速前置。真实画面展示使用过程和细节。最后用明确 CTA 完成转化。',
      productName: '便携咖啡杯',
      targetAudience: '通勤上班族',
      scenario: '早高峰通勤路上',
      sellingPoints: ['保温 8 小时', '倒置不漏', '单手开盖', '可放入车载杯架'],
      cta: '通勤党想喝热咖啡，就选它。',
      stylePreference: '高点击、快节奏、清晰卖点卡',
      assetBrief:
        '只有产品图和手持图；缺少真人讲解、缺少使用过程、缺少对比镜头、缺少 CTA 镜头。系统需要用标题卡、卖点卡、结构重排和素材复用完成补全。'
    },
    steps: [
      {
        id: 'analyze',
        label: '真实样例解析',
        route: '/analyze',
        output: 'VideoAnalysis',
        judgeSignal: '真实 duration / fps / resolution / keyframes / transcript fallback'
      },
      {
        id: 'graph',
        label: '结构图谱抽取',
        route: '/graph',
        output: 'ViralStructureGraph',
        judgeSignal: '脚本结构、节奏结构、包装结构和 creativeIngredients'
      },
      {
        id: 'adapt',
        label: '新商品与素材适配',
        route: '/adapt',
        output: 'ContentBrief + AssetCard[]',
        judgeSignal: '少素材输入被转成可匹配槽位的素材卡'
      },
      {
        id: 'gaps',
        label: '缺口识别与补全',
        route: '/gaps',
        output: 'SlotMatch + MaterialGap + GapRepair',
        judgeSignal: 'opening / usage / comparison / CTA 等缺口和补全策略'
      },
      {
        id: 'result',
        label: '结果生成与验证',
        route: '/result',
        output: 'Script + Storyboard + Timeline + QualityReport',
        judgeSignal: '脚本、分镜、时间线、包装建议、映射关系和质量自检'
      }
    ],
    scoreEvidence: [
      {
        taskId: 'task_1',
        taskName: '样例视频输入与解析',
        points: 5,
        route: '/analyze',
        evidence: 'seed/upload 输入、真实元信息、封面/关键帧、字幕概览'
      },
      {
        taskId: 'task_2',
        taskName: '结构拆解',
        points: 10,
        route: '/graph',
        evidence: '脚本段落、节奏结构、包装结构三类同时展示'
      },
      {
        taskId: 'task_3',
        taskName: '新内容与素材输入',
        points: 5,
        route: '/adapt',
        evidence: '商品 brief、文字素材、图片/视频素材入口和 AssetCard 结果'
      },
      {
        taskId: 'task_5',
        taskName: '素材缺口识别',
        points: 8,
        route: '/gaps',
        evidence: '槽位级 matched / partial / missing 和缺失创作要素'
      },
      {
        taskId: 'task_6',
        taskName: '素材缺口补全',
        points: 12,
        route: '/gaps',
        evidence: '标题卡、卖点卡、CTA 卡、素材复用、结构重排等 repair'
      },
      {
        taskId: 'task_7',
        taskName: '迁移过程可视化',
        points: 10,
        route: '/demo',
        evidence: '一页串联样例结构、新内容映射、缺口、补全和最终结果'
      },
      {
        taskId: 'task_8',
        taskName: '结果可验证',
        points: 10,
        route: '/result',
        evidence: '脚本、分镜、时间线草案、Web preview、质量自检'
      },
      {
        taskId: 'task_9_10_12',
        taskName: '进阶与人机协同',
        points: 20,
        route: '/result',
        evidence: '多版本策略、包装建议和自然语言局部调整入口'
      }
    ]
  };
}

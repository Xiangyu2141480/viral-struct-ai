# Demo Target / 最终演示目标

## 1. 推荐主 case

商品：

```txt
便携咖啡杯
```

目标用户：

```txt
通勤上班族
```

卖点：

```txt
1. 保温 8 小时
2. 不漏水
3. 单手开盖
4. 可放入车载杯架
```

用户素材故意不完整：

```txt
1. 产品正面图 1 张
2. 手持图 1 张
3. 商品介绍文案 1 段
```

故意缺少：

```txt
1. 开头强视觉镜头
2. 使用过程视频
3. 对比镜头
4. 结尾 CTA 镜头
```

这样可以最大化展示素材缺口识别和补全能力。

## 2. 理想演示流程

### Step 1：上传样例视频

展示：

- 视频封面
- 时长
- 分辨率
- 镜头数
- 字幕 / ASR 概览
- 关键帧

### Step 2：样例结构拆解

展示：

```txt
Hook -> 痛点 -> 卖点 -> 证明 -> CTA
```

同时展示：

- 节奏结构
- 包装结构
- 封面风格
- 转场建议
- 字幕密度

### Step 3：结构图谱

展示 Motion Graph：

```txt
[Hook]
  -> required: opening_attention
  -> package: large title + zoom
  -> transfer rule: 替换为新商品核心痛点

[Pain Point]
  -> required: problem scene
  -> fallback: text_card

[Selling Point]
  -> required: product closeup
  -> fallback: crop_zoom + selling point card

[Proof]
  -> required: comparison shot
  -> fallback: comparison_card

[CTA]
  -> required: end visual
  -> fallback: cta_card
```

### Step 4：输入新商品和素材

展示用户只上传了少量素材。

### Step 5：素材适配

展示 AssetCard：

```txt
产品图：适合 product_closeup / CTA，不适合 usage_demo
手持图：适合 usage_demo 的弱补全，不是真实动作视频
文案：适合脚本和字幕生成
```

### Step 6：缺口识别

展示 GapBoard：

| 结构槽位 | 需要素材 | 当前素材 | 状态 |
|---|---|---|---|
| Hook | 强视觉开头 | 无 | missing |
| 商品特写 | 产品近景 | 产品图 | matched |
| 使用过程 | 操作视频 | 手持图 | partial |
| 对比证明 | 对比镜头 | 无 | missing |
| CTA | 结尾镜头 | 无 | missing |

### Step 7：补全策略

展示 RepairBoard：

| 缺口 | 补全方式 |
|---|---|
| 缺开头镜头 | 标题卡 + 产品图快速推近 |
| 缺使用过程 | 手持图裁切 + 步骤字幕 |
| 缺对比镜头 | 左右对比卡 |
| 缺 CTA | 结尾行动卡 |

### Step 8：生成结果

展示：

- 新脚本
- 分镜
- 时间线
- Remotion 预览
- 样例结构和新结果对比

### Step 9：人工调整

演示：

```txt
把 Hook 改成更抓人
把保温卖点提前
节奏改快
包装风格改成高转化
```

### Step 10：多版本

展示：

- 高点击版
- 高转化版
- 高质感版

## 3. 最终视频效果要求

不要求电影级画面，但必须做到：

- 能播放
- 字幕清楚
- 镜头段落清楚
- 能看到标题卡、卖点卡、对比卡、CTA 卡
- 能看到素材缺口被补全
- 能解释每一段来自哪个样例结构槽位

## 4. 答辩核心话术

> 我们不是复制爆款视频，而是把爆款里的创作结构抽象成可迁移的 ViralStructureGraph。系统会把结构映射到新商品和用户素材上，并检查每个结构槽位是否有素材支撑。当素材不足时，系统会通过标题卡、卖点卡、裁切放大、字幕补全、对比卡和 CTA 卡等方式补全，最后生成脚本、分镜、时间线和可播放 demo。

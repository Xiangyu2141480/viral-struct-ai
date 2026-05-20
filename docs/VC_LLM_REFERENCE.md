# VC-LLM 对本项目的参考意义

## 可参考

```txt
1. 把广告生成定义为结构化任务，而非纯文本生成。
2. 输出 clip + script + subtitle，可以解析为视频生产协议。
3. 使用 spatial frame 理解商品细节。
4. 使用 temporal frames 理解动作变化。
5. 用指标评估画文一致性、事实性、连贯性、字幕分段。
```

## 需要改造

```txt
VC-LLM：商品信息 + raw footage → 广告视频
本项目：样例爆款视频 + 新内容 + 用户素材 → 结构迁移视频
```

本项目必须增加：

```txt
样例结构抽取
ViralStructureGraph
结构槽位匹配
素材缺口识别
缺口补全策略
包装层生成
迁移过程可视化
```

## 工程落地

```txt
AssetCard = spatialDescription + temporalDescription + suitableSlots + qualityScore
TimelineItem = slot + matchedAsset + script + subtitles + packaging + repair
QualityReport = structureMatch + slotCoverage + factuality + visualScriptAlignment
```

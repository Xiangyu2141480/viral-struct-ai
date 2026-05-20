# Current Status / 当前状态

## 已完成

- 项目仓库初始化
- GitHub 远程仓库绑定
- pnpm workspace 配置
- Turborepo 配置
- 前端、后端、共享协议、Remotion 包目录拆分
- CI pnpm 版本冲突修复
- CI workspace 依赖构建顺序修复
- 本地 `pnpm typecheck` 通过
- 本地 `pnpm build` 通过
- 项目任务体系脚本化

## 当前最近的工程结论

`@viral-struct/shared` 必须在 API、Web、Remotion typecheck 之前 build，否则这些包无法解析共享类型。

因此：

```txt
turbo typecheck dependsOn ^build
CI 里显式先 build @viral-struct/shared
```

## 当前冲刺分支

```txt
cxy
```

`cxy` 是当前拿奖冲刺分支。后续需求沉淀、评分映射、demo case 和正式实现都先在该分支推进，再按稳定程度合回主线。

## 当前产品定位

本项目要从“AI 生成视频工具”明确升级为：

```txt
可解释的爆款结构迁移引擎
```

核心不是复制样例视频，而是抽取样例中的结构能力，并迁移到新的商品、主题或用户素材中。当素材不足时，系统必须说明缺什么、为什么缺、怎么补、补完如何生成结果。

## 下一步

优先做 M1：

```txt
1. 样例视频上传
2. ffprobe 基础解析
3. FFmpeg 抽封面和关键帧
4. 手动字幕 fallback
5. VideoAnalysis 数据结构
6. ViralStructureGraph mock 输出
7. 前端 analyze / graph 页面展示
```

## 当前不要做

- 不要先做复杂编辑器
- 不要先做复杂 AIGC
- 不要先重构 monorepo
- 不要修改核心协议名称
- 不要提交密钥

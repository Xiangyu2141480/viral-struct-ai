# GitHub 仓库创建方案

## 1. 仓库命名

推荐：

```txt
viral-struct-ai
```

展示名称：

```txt
爆构引擎：营销短视频结构迁移与素材补全平台
```

仓库描述：

```txt
AI platform for transferring viral short-video structures to new products with material gap detection, repair planning, and timeline-based video generation.
```

## 2. 创建远程仓库

方式 A：GitHub 网页创建

```txt
Repository name: viral-struct-ai
Visibility: Private 前期建议 / Public 交付前确认
Initialize: 不勾选 README，因为本仓库已有 README
```

方式 B：GitHub CLI

```bash
gh repo create viral-struct-ai --private --description "AI short-video structure transfer engine"
git remote add origin git@github.com:<your-org-or-name>/viral-struct-ai.git
git push -u origin main
```

## 3. 初始化本地仓库

```bash
git init
git add .
git commit -m "chore: initialize viral structure transfer engine"
git branch -M main
git remote add origin git@github.com:<your-org-or-name>/viral-struct-ai.git
git push -u origin main
```

## 4. 推荐 GitHub Milestones

```txt
M1 - P0 Core Loop
M2 - P0 Gap Detection & Repair
M3 - P0 Visualization & Demo
M4 - P1 Advanced Creation
M5 - Final Delivery
```

## 5. 推荐 Labels

```txt
score/p0-core
score/p0-gap
score/p0-visualization
score/p1-packaging
score/p1-human-in-loop
type/frontend
type/backend
type/ai
type/video
type/docs
risk/demo-critical
```

## 6. GitHub Project 看板列

```txt
Backlog
This Week
In Progress
Blocked
Demo Ready
Done
```

## 7. 第一次提交后立即做三件事

```txt
1. 确认 .env 没有被提交。
2. 创建 M1-M5 milestones。
3. 按 docs/issues-backlog.md 创建 issues。
```

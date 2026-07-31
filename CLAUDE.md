# CLAUDE.md

本文件给 Claude Code 提供本仓库的工作指引。

## 项目

「AI 成本换算助手」——油猴脚本（Tampermonkey/Violentmonkey），自动把网页美元价格换算为多币种显示，悬停看多币种浮窗，并把 K/M/B/T 大数与千分位大数转为中文万/亿读数。非侵入式：只在价格后追加灰色 badge，不改网页原内容。

## 仓库结构

- `src/ai-cost-helper.user.js` —— **唯一的脚本源码**，单文件 IIFE，无构建/无依赖。几乎所有改动都在这里。
- `demo/index.html` —— 演示页（独立模拟器，含自己的 JS），由 GitHub Pages 部署。改脚本不需要动 demo。
- `.github/workflows/release.yml` —— 打 `v*` tag 触发，自动把 `src/ai-cost-helper.user.js` 发为 Release 资产。
- `.github/workflows/pages.yml` —— push main 时把 demo 部署到 Pages。
- `README.md` / `LICENSE`

## 开发与测试

无构建步骤。在 Tampermonkey 里把脚本指向 `src/ai-cost-helper.user.js` 即可调试。

验证手段：
- `node --check src/ai-cost-helper.user.js` —— 语法检查（最快，先跑）。
- 纯逻辑（正则/格式化/去重）可复制函数到临时脚本单测。
- DOM 行为（观察器、badge 插入）用 jsdom 跑：`npm i jsdom` 后 `window.eval` 加载脚本，构造 HTML 断言 badge。`GM_*` 不定义走默认值，`fetch` stub 成 reject 走兜底汇率。
- 真实页面验证（OpenAI / Anthropic / OpenRouter 等定价页）。

## 发布

提交到 `main`，bump `@version`，打 tag，推送：

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: ..."
git push origin main
git push origin vX.Y.Z   # 触发 release.yml
```

**发布是对外动作**（自动更新所有已安装用户）：本地提交 + 打 tag 后，推送前与用户确认。

## 改动约束（重要）

- **非侵入**：只追加 badge span，绝不修改网页原有文本/结构。
- **避免 MutationObserver 反馈**：观察器会捕获自身写入。跳过自身元素（`[data-ai-cost-helper]` / `-popup` / `-panel`）内部变更；用模块级 `handled` WeakMap（文本节点 -> 上次文本）防重入，拆分片段用 `markText` 登记防回扫二次换算。
- **`shouldIgnore` 必须排除自身 badge**：`formatMoney` 千分位后 badge 含逗号，会被 `parseComma` 二次识别出嵌套 badge。
- **价格识别三类**：同节点 `$5`；`$` 与数字拆到相邻内联元素（`adjacentText` 只跨内联、遇块级即停，不跨单元格）；K/M/B/T 与千分位大数。
- **样式放 `injectStyles()` 不放行内 cssText**：浮窗/面板颜色要在样式表里，`@media (prefers-color-scheme: dark)` 才能覆盖。
- **已知限制**：深色仅跟系统偏好；多币种只针对 `$` 源；千分位 <1万 不换算。改了限制要同步更新 README「已知限制」。

## 代码风格

- 4 空格缩进，IIFE + `'use strict'`，中文注释，JSDoc 风格函数说明。
- 遵循周边代码的命名与注释密度。
- commit message 用 conventional commits（`feat:`/`fix:`/`chore:`），中文描述 + 「版本升至 X.Y.Z」。

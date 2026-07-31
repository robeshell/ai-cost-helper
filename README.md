# AI 成本换算助手

> 自动将网页中的美元价格转换为人民币显示，方便查看 AI API、模型调用和海外服务成本。

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![UserScript](https://img.shields.io/badge/UserScript-Tampermonkey-orange.svg)

## 功能

- 自动识别网页上的美元价格（`$12.50` 形式），在美元后追加人民币换算结果
- 自动从公开接口获取 USD/CNY 实时汇率
- 汇率本地缓存 7 天，离线或接口失败时回退到默认汇率
- 非侵入式显示：不改动网页原有内容，仅在美元价格后追加灰色小字
- 自动监听动态加载的内容（SPA、无限滚动等）

## 安装

### 方式一：油猴商店（推荐）

从 Release 直接安装：

[![安装脚本](https://img.shields.io/badge/安装脚本-download-2ea44f.svg)](https://github.com/robeshell/ai-cost-helper/releases/latest)

### 方式二：Greasy Fork（审核通过后）

<https://greasyfork.org/zh-CN/scripts/ai-cost-helper>

### 手动安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. 打开 [ai-cost-helper.user.js](https://github.com/robeshell/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js)
3. 点击「安装」即可

## 使用

安装后打开任意页面，例如：

- OpenAI 价格页：<https://openai.com/api/pricing>
- Anthropic 价格页：<https://www.anthropic.com/pricing>
- 各类海外云服务官网

美元价格后会自动出现类似 `≈ ¥67.80` 的换算结果，鼠标悬停可查看所用汇率。

## 预览

- 在线演示：<https://robeshell.github.io/ai-cost-helper/>
- 本地演示：[demo/index.html](demo/index.html)（配合脚本查看真实换算效果）

## 开发

```bash
# 克隆仓库
git clone https://github.com/robeshell/ai-cost-helper.git

# 在 Tampermonkey 中新建脚本，内容指向仓库中的 src/ai-cost-helper.user.js
```

## 发布

打 tag 推送后，GitHub Actions 会自动构建并发布 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 隐私

- 不收集任何用户数据
- 不上传浏览记录
- 仅请求一次公开汇率接口：<https://open.er-api.com/v6/latest/USD>

## 已知限制

- 只处理文本节点中的第一个美元金额
- 不处理页面源码、输入框、代码块中的价格
- `$` 前缀以外的价格格式暂不支持

## License

[MIT](LICENSE)

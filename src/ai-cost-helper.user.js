// ==UserScript==
// @name         AI 成本换算助手
// @name:zh-CN   AI 成本换算助手
// @name:zh-TW   AI 成本換算助手
// @name:en      AI Cost Helper
// @namespace    https://github.com/robeshell/ai-cost-helper
// @version      1.1.0
// @description  自动将网页中的美元价格转换为人民币显示，方便查看 AI API、模型调用和海外服务成本
// @description:zh-CN  自动将网页中的美元价格转换为人民币显示，方便查看 AI API、模型调用和海外服务成本
// @description:zh-TW  自動將網頁中的美元價格轉換為人民幣顯示，方便查看 AI API、模型調用和海外服務成本
// @description:en  Automatically convert USD prices on web pages to CNY, handy for checking AI API, model usage and overseas service costs
// @author       Wang
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @supportURL   https://github.com/robeshell/ai-cost-helper/issues
// @homepageURL  https://github.com/robeshell/ai-cost-helper
// @downloadURL  https://github.com/robeshell/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @updateURL    https://github.com/robeshell/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @grant        none
// ==/UserScript==

/*!
 * AI 成本换算助手
 *
 * 功能：
 * - 自动识别网页美元价格
 * - 在美元后显示人民币金额
 * - 自动识别 K/M/B/T 大数，换算为中文万/亿读数
 * - 自动获取 USD/CNY 汇率
 * - 汇率缓存 7 天
 * - 非侵入式显示，不修改网页原内容
 *
 * 隐私：
 * - 不收集任何用户数据
 * - 不上传浏览记录
 * - 仅请求公开汇率接口
 */

(function () {
    'use strict';

    const DEFAULT_RATE = 6.78;
    const RATE_API = 'https://open.er-api.com/v6/latest/USD';
    const CACHE_KEY = 'ai_cost_helper_rate';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

    const FLAG = 'data-ai-cost-helper';

    let USD_CNY = DEFAULT_RATE;

    /**
     * 获取汇率，7 天缓存
     */
    async function loadRate() {
        try {
            const cache = localStorage.getItem(CACHE_KEY);
            if (cache) {
                const data = JSON.parse(cache);
                if (Date.now() - data.time < CACHE_TTL) {
                    USD_CNY = data.rate;
                    return;
                }
            }

            const response = await fetch(RATE_API);
            const json = await response.json();

            if (json && json.rates && json.rates.CNY) {
                USD_CNY = json.rates.CNY;
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    rate: USD_CNY,
                    time: Date.now()
                }));
            }
        } catch (e) {
            console.log('[AI 成本换算助手] 汇率获取失败，使用默认汇率', DEFAULT_RATE);
        }
    }

    /**
     * 创建换算标签
     * @param {string} text 标签文本
     * @param {string} title 悬浮提示
     */
    function createBadge(text, title) {
        const span = document.createElement('span');
        span.textContent = text;
        span.setAttribute(FLAG, 'true');
        span.style.cssText = `
            color: #9ca3af;
            font-size: 0.82em;
            margin-left: 5px;
            white-space: nowrap;
        `;
        span.title = title;
        return span;
    }

    /**
     * 忽略区域：代码、输入框等
     */
    function shouldIgnore(node) {
        const el = node.parentElement;
        if (!el) return true;
        return !!el.closest(`
            code,
            pre,
            script,
            style,
            textarea,
            input
        `);
    }

    /**
     * 查找美元金额（支持千分位，如 $2,400,000）
     */
    function parseUSD(text) {
        const regex = /\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/g;
        const result = [];
        let match;
        while ((match = regex.exec(text))) {
            result.push({
                value: Number(match[1].replace(/,/g, '')),
                start: match.index,
                end: regex.lastIndex
            });
        }
        return result;
    }

    /**
     * 英文大数单位对应的倍数
     */
    const UNIT_MULTIPLIERS = {
        K: 1e3,
        M: 1e6,
        B: 1e9,
        T: 1e12
    };

    /**
     * 查找 K/M/B/T 大数（仅大写，避免误伤 5m、5G、MB 等；支持千分位）
     */
    function parseUnits(text) {
        const regex = /\b((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([KMBT])\b/g;
        const result = [];
        let match;
        while ((match = regex.exec(text))) {
            const unit = match[2];
            result.push({
                value: Number(match[1].replace(/,/g, '')) * UNIT_MULTIPLIERS[unit],
                start: match.index,
                end: regex.lastIndex,
                unit
            });
        }
        return result;
    }

    /**
     * 查找纯千分位大数（如 122,800,000），仅保留 >=1万 的结果避免噪音
     */
    function parseComma(text) {
        const regex = /(?<![\d,$])(\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?![\d,])/g;
        const result = [];
        let match;
        while ((match = regex.exec(text))) {
            const value = Number(match[1].replace(/,/g, ''));
            if (value >= 1e4) {
                result.push({
                    value,
                    start: match.index,
                    end: regex.lastIndex
                });
            }
        }
        return result;
    }

    /**
     * 将大数格式化为中文读数（万/亿，1 位小数去尾零）
     * @param {number} n
     */
    function formatChinese(n) {
        let value;
        let suffix = '';
        if (n >= 1e8) {
            value = n / 1e8;
            suffix = '亿';
        } else if (n >= 1e4) {
            value = n / 1e4;
            suffix = '万';
        } else {
            return String(Math.round(n));
        }
        const rounded = Math.round(value * 10) / 10;
        return String(rounded) + suffix;
    }

    /**
     * 处理单个文本节点
     */
    function processNode(node) {
        if (node.nodeType !== Node.TEXT_NODE) return;
        if (shouldIgnore(node)) return;

        const text = node.nodeValue;
        const parent = node.parentElement;
        if (parent && parent.querySelector(`[${FLAG}]`)) return;

        // 合并美元金额、大数、千分位数字匹配，按位置排序
        const matches = parseUSD(text)
            .map(m => {
                const rmb = m.value * USD_CNY;
                return {
                    ...m,
                    badge: `≈ ¥${rmb >= 1e4 ? formatChinese(rmb) : rmb.toFixed(2)}`,
                    title: `汇率 USD/CNY=${USD_CNY.toFixed(2)}`
                };
            })
            .concat(parseUnits(text).map(m => ({
                ...m,
                badge: `≈ ${formatChinese(m.value)}`,
                title: m.value.toLocaleString('zh-CN')
            })))
            .concat(parseComma(text).map(m => ({
                ...m,
                badge: `≈ ${formatChinese(m.value)}`,
                title: m.value.toLocaleString('zh-CN')
            })))
            .sort((a, b) => a.start - b.start);

        if (matches.length === 0) return;

        // 当匹配重叠时（如 $2.4B：美元 $2.4 与大数 2.4B），保留覆盖更完整的那个
        const kept = [];
        for (const m of matches) {
            const last = kept[kept.length - 1];
            if (last && m.start < last.end) {
                if (m.end > last.end) kept[kept.length - 1] = m;
            } else {
                kept.push(m);
            }
        }

        const fragment = document.createDocumentFragment();
        let cursor = 0;

        for (const m of kept) {
            if (m.start > cursor) {
                fragment.appendChild(document.createTextNode(text.substring(cursor, m.start)));
            }
            fragment.appendChild(document.createTextNode(text.substring(m.start, m.end)));
            fragment.appendChild(createBadge(m.badge, m.title));
            cursor = m.end;
        }

        if (cursor < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(cursor)));
        }

        node.replaceWith(fragment);
    }

    /**
     * 扫描页面上的文本节点
     */
    function scan(root = document.body) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) {
            nodes.push(walker.currentNode);
        }
        nodes.forEach(processNode);
    }

    /**
     * 监听动态内容
     */
    function start() {
        scan();

        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1) {
                        scan(node);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    loadRate().then(start);
})();

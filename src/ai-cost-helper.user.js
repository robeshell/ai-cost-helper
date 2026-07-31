// ==UserScript==
// @name         AI 成本换算助手
// @name:zh-CN   AI 成本换算助手
// @name:zh-TW   AI 成本換算助手
// @name:en      AI Cost Helper
// @namespace    https://github.com/wangwenyu
// @version      1.0.0
// @description  自动将网页中的美元价格转换为人民币显示，方便查看 AI API、模型调用和海外服务成本
// @description:zh-CN  自动将网页中的美元价格转换为人民币显示，方便查看 AI API、模型调用和海外服务成本
// @description:en  Automatically convert USD prices on web pages to CNY, handy for checking AI API, model usage and overseas service costs
// @author       Wang
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @supportURL   https://github.com/wangwenyu/ai-cost-helper/issues
// @homepageURL  https://github.com/wangwenyu/ai-cost-helper
// @downloadURL  https://github.com/wangwenyu/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @updateURL    https://github.com/wangwenyu/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @grant        none
// ==/UserScript==

/*!
 * AI 成本换算助手
 *
 * 功能：
 * - 自动识别网页美元价格
 * - 在美元后显示人民币金额
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
     * 创建人民币标签
     */
    function createBadge(text) {
        const span = document.createElement('span');
        span.textContent = text;
        span.setAttribute(FLAG, 'true');
        span.style.cssText = `
            color: #9ca3af;
            font-size: 0.82em;
            margin-left: 5px;
            white-space: nowrap;
        `;
        span.title = `汇率 USD/CNY=${USD_CNY.toFixed(2)}`;
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
     * 查找美元金额
     */
    function parseUSD(text) {
        const regex = /\$(\d+(?:\.\d+)?)/g;
        const result = [];
        let match;
        while ((match = regex.exec(text))) {
            result.push({
                value: Number(match[1]),
                start: match.index,
                end: regex.lastIndex
            });
        }
        return result;
    }

    /**
     * 处理单个文本节点
     */
    function processNode(node) {
        if (node.nodeType !== Node.TEXT_NODE) return;
        if (shouldIgnore(node)) return;

        const text = node.nodeValue;
        if (!text.includes('$')) return;

        const parent = node.parentElement;
        if (parent && parent.querySelector(`[${FLAG}]`)) return;

        const prices = parseUSD(text);
        if (prices.length === 0) return;

        // 当前只处理第一个美元金额
        const item = prices[0];
        const rmb = (item.value * USD_CNY).toFixed(2);

        const fragment = document.createDocumentFragment();

        if (item.start > 0) {
            fragment.appendChild(document.createTextNode(text.substring(0, item.start)));
        }

        fragment.appendChild(document.createTextNode(text.substring(item.start, item.end)));

        fragment.appendChild(createBadge(`≈ ¥${rmb}`));

        if (item.end < text.length) {
            fragment.appendChild(document.createTextNode(text.substring(item.end)));
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

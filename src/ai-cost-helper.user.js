// ==UserScript==
// @name         AI 成本换算助手
// @name:zh-CN   AI 成本换算助手
// @name:zh-TW   AI 成本換算助手
// @name:en      AI Cost Helper
// @namespace    https://github.com/robeshell/ai-cost-helper
// @version      1.2.0
// @description  自动将网页中的美元价格转换为人民币显示，悬停查看多币种换算，方便查看 AI API、模型调用和海外服务成本
// @description:zh-CN  自动将网页中的美元价格转换为人民币显示，悬停查看多币种换算，方便查看 AI API、模型调用和海外服务成本
// @description:zh-TW  自動將網頁中的美元價格轉換為人民幣顯示，懸停查看多幣種換算，方便查看 AI API、模型調用和海外服務成本
// @description:en  Automatically convert USD prices on web pages to CNY, hover to see multi-currency conversions, handy for checking AI API, model usage and overseas service costs
// @author       Wang
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @supportURL   https://github.com/robeshell/ai-cost-helper/issues
// @homepageURL  https://github.com/robeshell/ai-cost-helper
// @downloadURL  https://github.com/robeshell/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @updateURL    https://github.com/robeshell/ai-cost-helper/releases/latest/download/ai-cost-helper.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/*!
 * AI 成本换算助手
 *
 * 功能：
 * - 自动识别网页美元价格
 * - 在美元后显示默认币种（人民币）换算
 * - 悬停/点击查看多币种换算浮窗
 * - 自动识别 K/M/B/T 大数，换算为中文万/亿读数
 * - 自动获取多币种汇率
 * - 汇率缓存 7 天
 * - 设置面板：默认币种、浮窗币种
 * - 非侵入式显示，不修改网页原内容
 *
 * 隐私：
 * - 不收集任何用户数据
 * - 不上传浏览记录
 * - 仅请求公开汇率接口
 */

(function () {
    'use strict';

    const RATE_API = 'https://open.er-api.com/v6/latest/USD';
    const CACHE_KEY = 'ai_cost_helper_rate';
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天

    const FLAG = 'data-ai-cost-helper';

    /**
     * 支持的币种与货币符号
     */
    const CURRENCIES = {
        CNY: '¥',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        HKD: 'HK$',
        SGD: 'S$',
        KRW: '₩',
        AUD: 'A$',
        CAD: 'C$'
    };

    /**
     * 默认设置
     */
    const DEFAULT_SETTINGS = {
        defaultCurrency: 'CNY',
        popupCurrencies: ['EUR', 'GBP', 'JPY', 'HKD', 'SGD', 'KRW', 'AUD', 'CAD']
    };

    // 兜底汇率（1 USD 兑各币种）
    const FALLBACK_RATES = { CNY: 6.78, EUR: 0.92, GBP: 0.79, JPY: 150, HKD: 7.8, SGD: 1.34, KRW: 1350, AUD: 1.5, CAD: 1.36 };

    let RATES = { ...FALLBACK_RATES };
    let SETTINGS = { ...DEFAULT_SETTINGS };

    /**
     * 加载设置（GM_* 不可用时回退默认）
     */
    function loadSettings() {
        try {
            const dc = GM_getValue('defaultCurrency', DEFAULT_SETTINGS.defaultCurrency);
            const pc = GM_getValue('popupCurrencies', DEFAULT_SETTINGS.popupCurrencies);
            if (dc && CURRENCIES[dc]) SETTINGS.defaultCurrency = dc;
            if (Array.isArray(pc) && pc.length) SETTINGS.popupCurrencies = pc.filter(c => CURRENCIES[c]);
        } catch (e) {
            /* GM_* 不可用，保持默认 */
        }
    }

    /**
     * 保存设置
     */
    function saveSettings() {
        try {
            GM_setValue('defaultCurrency', SETTINGS.defaultCurrency);
            GM_setValue('popupCurrencies', SETTINGS.popupCurrencies);
        } catch (e) {
            console.log('[AI 成本换算助手] 设置保存失败');
        }
    }

    /**
     * 获取汇率，7 天缓存（仅保留脚本用到的币种）
     */
    async function loadRate() {
        try {
            const cache = localStorage.getItem(CACHE_KEY);
            if (cache) {
                const data = JSON.parse(cache);
                if (Date.now() - data.time < CACHE_TTL && data.rates) {
                    RATES = { ...FALLBACK_RATES, ...data.rates };
                    return;
                }
            }

            const response = await fetch(RATE_API);
            const json = await response.json();

            if (json && json.rates) {
                const picked = {};
                for (const code of Object.keys(CURRENCIES)) {
                    if (json.rates[code]) picked[code] = json.rates[code];
                }
                if (Object.keys(picked).length) {
                    RATES = { ...FALLBACK_RATES, ...picked };
                    localStorage.setItem(CACHE_KEY, JSON.stringify({
                        rates: picked,
                        time: Date.now()
                    }));
                }
            }
        } catch (e) {
            console.log('[AI 成本换算助手] 汇率获取失败，使用默认汇率');
        }
    }

    /**
     * 格式化货币金额
     * @param {number} amount
     * @param {string} code 币种代码
     */
    function formatMoney(amount, code) {
        // 大面额币种用整数
        const value = (code === 'JPY' || code === 'KRW')
            ? Math.round(amount).toLocaleString('zh-CN')
            : String(Math.round(amount * 100) / 100);
        return `${CURRENCIES[code] || ''}${value}`;
    }

    /**
     * 创建换算标签
     * @param {string} text 标签文本
     * @param {string} title 悬浮提示
     * @param {number} usdValue 美元金额（仅 USD 换算的 badge 有，用于浮窗）
     */
    function createBadge(text, title, usdValue) {
        const span = document.createElement('span');
        span.textContent = text;
        span.setAttribute(FLAG, 'true');
        if (usdValue != null) {
            span.setAttribute('data-usd', String(usdValue));
        }
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
                const dc = SETTINGS.defaultCurrency;
                const rate = RATES[dc] || FALLBACK_RATES[dc];
                const converted = m.value * rate;
                return {
                    ...m,
                    badge: `≈ ${formatMoney(converted, dc)}`,
                    title: `汇率 USD/${dc}=${rate.toFixed(2)}`,
                    usdValue: m.value
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
            fragment.appendChild(createBadge(m.badge, m.title, m.usdValue));
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

    // ===== 多币种浮窗 =====

    let popupEl = null;
    let popupHideTimer = null;
    let activeBadge = null;

    function getPopup() {
        if (popupEl) return popupEl;
        popupEl = document.createElement('div');
        popupEl.setAttribute('data-ai-cost-helper-popup', 'true');
        popupEl.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: #fff;
            color: #14161a;
            border: 1px solid #e6e8ec;
            border-radius: 10px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.12);
            padding: 10px 14px;
            font-size: 13px;
            line-height: 1.8;
            display: none;
            min-width: 150px;
        `;
        popupEl.addEventListener('mouseenter', () => clearTimeout(popupHideTimer));
        popupEl.addEventListener('mouseleave', () => scheduleHidePopup());
        document.body.appendChild(popupEl);
        return popupEl;
    }

    /**
     * 渲染浮窗内容
     */
    function renderPopup(badge) {
        const usd = Number(badge.getAttribute('data-usd'));
        if (!usd) return;
        const el = getPopup();
        const dc = SETTINGS.defaultCurrency;
        // 浮窗币种 = 默认币种 + 用户勾选，去重
        const codes = [...new Set([dc, ...SETTINGS.popupCurrencies])];
        const rows = codes.map(code => {
            const rate = RATES[code] || FALLBACK_RATES[code];
            return `<div>${code} ${formatMoney(usd * rate, code)}</div>`;
        });
        rows.push(`<div style="border-top:1px solid #eee;margin-top:6px;padding-top:6px;font-size:12px"><a href="javascript:void(0)" data-popup-settings style="color:#6366f1;text-decoration:none">设置</a></div>`);
        el.innerHTML = rows.join('');
        el.style.display = 'block';
        positionPopup(badge, el);
        const link = el.querySelector('[data-popup-settings]');
        if (link) link.addEventListener('click', (e) => {
            e.preventDefault();
            hidePopup();
            openSettingsPanel();
        });
    }

    /**
     * 浮窗定位（badge 下方，越界自动翻转）
     */
    function positionPopup(badge, el) {
        const r = badge.getBoundingClientRect();
        const left = Math.min(r.left, window.innerWidth - el.offsetWidth - 8);
        const bottom = r.bottom + 6 + el.offsetHeight;
        el.style.left = Math.max(4, left) + 'px';
        if (bottom > window.innerHeight) {
            el.style.top = Math.max(4, r.top - el.offsetHeight - 6) + 'px';
        } else {
            el.style.top = (r.bottom + 6) + 'px';
        }
    }

    function showPopup(badge) {
        clearTimeout(popupHideTimer);
        if (activeBadge !== badge) {
            activeBadge = badge;
            renderPopup(badge);
        } else {
            getPopup().style.display = 'block';
        }
    }

    function hidePopup() {
        clearTimeout(popupHideTimer);
        if (popupEl) popupEl.style.display = 'none';
    }

    function scheduleHidePopup() {
        clearTimeout(popupHideTimer);
        popupHideTimer = setTimeout(hidePopup, 300);
    }

    // ===== 设置面板 =====

    let panelEl = null;

    function openSettingsPanel() {
        getPanel().style.display = 'flex';
    }

    function closeSettingsPanel() {
        if (panelEl) panelEl.style.display = 'none';
    }

    function getPanel() {
        if (panelEl) return panelEl;
        panelEl = document.createElement('div');
        panelEl.setAttribute('data-ai-cost-helper-panel', 'true');
        panelEl.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 2147483646;
            background: rgba(0,0,0,0.4);
            display: none;
            align-items: center;
            justify-content: center;
        `;
        panelEl.innerHTML = buildPanelHTML();
        document.body.appendChild(panelEl);
        panelEl.addEventListener('click', (e) => {
            if (e.target === panelEl) closeSettingsPanel();
        });
        panelEl.querySelector('[data-panel-cancel]').addEventListener('click', closeSettingsPanel);
        panelEl.querySelector('[data-panel-save]').addEventListener('click', saveFromPanel);
        return panelEl;
    }

    function buildPanelHTML() {
        const dc = SETTINGS.defaultCurrency;
        const popup = SETTINGS.popupCurrencies;
        const codeOptions = Object.keys(CURRENCIES).map(code =>
            `<option value="${code}" ${code === dc ? 'selected' : ''}>${code} (${CURRENCIES[code]})</option>`
        ).join('');
        const checks = Object.keys(CURRENCIES).map(code =>
            `<label style="display:block"><input type="checkbox" value="${code}" ${popup.includes(code) ? 'checked' : ''}> ${code} (${CURRENCIES[code]})</label>`
        ).join('');
        return `
            <div style="background:#fff;border-radius:12px;padding:20px;width:320px;max-width:90vw;font-size:14px;color:#14161a">
                <h3 style="margin:0 0 14px;font-size:16px">AI 成本换算助手 · 设置</h3>
                <div style="margin-bottom:12px">
                    <div style="margin-bottom:4px">默认币种</div>
                    <select data-panel-default style="padding:6px;border:1px solid #d0d3d8;border-radius:6px">${codeOptions}</select>
                </div>
                <div style="margin-bottom:16px">
                    <div style="margin-bottom:4px">浮窗展示币种</div>
                    <div data-panel-popup>${checks}</div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end">
                    <button data-panel-cancel style="padding:6px 14px;border:1px solid #d0d3d8;border-radius:8px;background:#fff;cursor:pointer">取消</button>
                    <button data-panel-save style="padding:6px 14px;border:none;border-radius:8px;background:#6366f1;color:#fff;cursor:pointer">保存</button>
                </div>
            </div>
        `;
    }

    function saveFromPanel() {
        const panel = getPanel();
        SETTINGS.defaultCurrency = panel.querySelector('[data-panel-default]').value;
        SETTINGS.popupCurrencies = [...panel.querySelectorAll('[data-panel-popup] input:checked')].map(i => i.value);
        saveSettings();
        closeSettingsPanel();
        refreshBadges();
    }

    /**
     * 设置变更后刷新已有 USD badge 的内联文本与 title
     */
    function refreshBadges() {
        const dc = SETTINGS.defaultCurrency;
        const rate = RATES[dc] || FALLBACK_RATES[dc];
        document.querySelectorAll(`[${FLAG}][data-usd]`).forEach(span => {
            const usd = Number(span.getAttribute('data-usd'));
            span.textContent = `≈ ${formatMoney(usd * rate, dc)}`;
            span.title = `汇率 USD/${dc}=${rate.toFixed(2)}`;
        });
        hidePopup();
    }

    /**
     * 绑定浮窗事件（事件委托，单一监听）
     */
    function bindPopupEvents() {
        document.addEventListener('mouseover', (e) => {
            const badge = e.target.closest ? e.target.closest(`[${FLAG}]`) : null;
            if (badge && badge.hasAttribute('data-usd')) showPopup(badge);
        });
        document.addEventListener('mouseout', (e) => {
            const badge = e.target.closest ? e.target.closest(`[${FLAG}]`) : null;
            const inPopup = e.target.closest ? e.target.closest('[data-ai-cost-helper-popup]') : null;
            if (!badge && !inPopup) scheduleHidePopup();
        });
        document.addEventListener('click', (e) => {
            const badge = e.target.closest ? e.target.closest(`[${FLAG}]`) : null;
            const inPopup = e.target.closest ? e.target.closest('[data-ai-cost-helper-popup]') : null;
            if (badge && badge.hasAttribute('data-usd')) {
                const el = getPopup();
                if (el.style.display === 'block') hidePopup();
                else showPopup(badge);
                e.preventDefault();
            } else if (!inPopup) {
                hidePopup();
            }
        });
        window.addEventListener('scroll', hidePopup, true);
        window.addEventListener('resize', hidePopup);
    }

    /**
     * 监听动态内容
     */
    function start() {
        loadSettings();
        bindPopupEvents();
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

        // 注册油猴菜单设置入口
        if (typeof GM_registerMenuCommand === 'function') {
            GM_registerMenuCommand('AI 成本换算助手 · 设置', openSettingsPanel);
        }
    }

    loadRate().then(start);
})();

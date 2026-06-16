/* ============ 星光48·爱豆模拟器 V2 - 主脚本 ============ */

// ============ 全局命名空间 ============
const App = window.App = {};

// ============ 配置 ============
// API 地址自动检测：优先使用当前服务器地址，file:// 协议下回退到部署地址
// 可通过在 URL 后加 ?api=https://xxx 临时覆盖
App.Config = (() => {
    const params = new URLSearchParams(window.location.search);
    const customApi = params.get('api');
    if (customApi) return { API_URL: customApi };

    const proto = window.location.protocol;
    if (proto === 'file:') {
        // 直接打开 HTML 文件时，使用默认部署地址
        return { API_URL: 'https://kodai48-production.up.railway.app' };
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return { API_URL: `http://${window.location.host}` };
    }
    return { API_URL: window.location.origin };
})();

// ============ 网络诊断与连接管理 ============
App.Network = {
    _status: 'unknown', // unknown | online | offline | degraded
    _lastCheck: 0,
    _checkInterval: null,
    _listeners: [],

    /** 初始化网络监控 */
    init() {
        window.addEventListener('online', () => {
            console.log('🌐 浏览器报告网络恢复');
            this._setStatus('unknown');
            this.checkNow();
        });
        window.addEventListener('offline', () => {
            console.warn('🔴 浏览器报告网络断开');
            this._setStatus('offline');
        });
        // 每60秒定期检测
        this._checkInterval = setInterval(() => this.checkNow(), 60000);
        // 首检延迟2秒（等页面就绪）
        setTimeout(() => this.checkNow(), 2000);
    },

    /** 获取当前网络状态 */
    get status() { return this._status; },

    /** 监听状态变化 */
    onChange(fn) { this._listeners.push(fn); },

    _setStatus(s) {
        if (this._status !== s) {
            const prev = this._status;
            this._status = s;
            this._listeners.forEach(fn => fn(s, prev));
        }
    },

    /**
     * 立即检测网络与 API 连通性
     * @returns {Promise<{online:boolean, apiReachable:boolean, latency:number|null, detail:string}>}
     */
    async checkNow() {
        const now = Date.now();
        // 至少间隔5秒
        if (now - this._lastCheck < 5000) return this._lastResult;
        this._lastCheck = now;

        const result = {
            online: navigator.onLine,
            apiReachable: false,
            latency: null,
            detail: '',
            timestamp: new Date().toISOString()
        };

        if (!result.online) {
            result.detail = '设备未连接网络';
            this._setStatus('offline');
            this._lastResult = result;
            return result;
        }

        // 尝试连接 API
        const apiUrl = App.Config.API_URL;
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            const t0 = performance.now();
            const res = await fetch(`${apiUrl}/health`, {
                method: 'GET',
                signal: controller.signal,
                cache: 'no-store'
            });
            clearTimeout(timeout);
            result.latency = Math.round(performance.now() - t0);

            if (res.ok) {
                const data = await res.json().catch(() => ({}));
                result.apiReachable = true;
                result.detail = `API 正常 (${result.latency}ms)`;
                result.serverInfo = data;
                this._setStatus('online');
            } else {
                result.apiReachable = false;
                result.detail = `服务器返回 HTTP ${res.status}`;
                this._setStatus('degraded');
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                result.detail = `连接超时 (>8s)`;
            } else if (e.name === 'TypeError' && (e.message.includes('fetch') || e.message.includes('NetworkError'))) {
                result.detail = `无法连接 API 服务器 (${apiUrl})`;
            } else {
                result.detail = `连接错误: ${e.message}`;
            }
            result.apiReachable = false;
            this._setStatus('degraded');
        }

        console.log('🔍 网络诊断:', result);
        this._lastResult = result;
        return result;
    },

    /**
     * 详细诊断（用于用户手动触发）
     * @returns {Promise<object>} 完整诊断报告
     */
    async diagnose() {
        const report = {
            time: new Date().toISOString(),
            browserOnline: navigator.onLine,
            apiUrl: App.Config.API_URL,
            health: null,
            healthError: null,
            chatTest: null,
            chatError: null,
            overall: 'pending'
        };

        // 1. 基础连通性
        const netCheck = await this.checkNow();
        report.netCheck = netCheck;

        // 2. Health 端点
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`${App.Config.API_URL}/health`, { signal: ctrl.signal, cache: 'no-store' });
            report.health = res.ok ? await res.json().catch(() => 'parse_error') : `HTTP ${res.status}`;
        } catch (e) {
            report.healthError = e.name === 'AbortError' ? '超时' : e.message;
        }

        // 3. 聊天端点连通性（只测连通，不发真实消息）
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 5000);
            const t0 = performance.now();
            const res = await fetch(`${App.Config.API_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ npcId: '_diag_', message: 'ping', playerName: 'diag', context: { npcType: 'member' }, rolePrompt: '', inviteCode: '' }),
                signal: ctrl.signal
            });
            report.chatTest = { status: res.status, latency: Math.round(performance.now() - t0) + 'ms' };
        } catch (e) {
            report.chatError = e.name === 'AbortError' ? '超时' : e.message;
        }

        // 综合判断
        if (report.health && report.chatTest?.status === 200) {
            report.overall = 'healthy';
        } else if (report.health || report.chatTest) {
            report.overall = 'partial';
        } else if (!report.browserOnline) {
            report.overall = 'offline';
        } else {
            report.overall = 'unreachable';
        }

        console.log('🩺 完整诊断报告:', report);
        return report;
    },

    /**
     * 带超时和重试的 fetch 封装
     * @param {string} url
     * @param {object} options - fetch options + retries, timeoutMs
     * @returns {Promise<Response>}
     */
    async fetchWithRetry(url, options = {}) {
        const maxRetries = options.retries ?? 0;
        const timeoutMs = options.timeoutMs ?? 10000;
        const backoffBase = options.backoffMs ?? 1000;
        delete options.retries;
        delete options.timeoutMs;
        delete options.backoffMs;

        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (attempt > 0) {
                const delay = backoffBase * Math.pow(2, attempt - 1) + Math.random() * 500;
                console.log(`🔄 第 ${attempt} 次重试，等待 ${Math.round(delay)}ms...`);
                await new Promise(r => setTimeout(r, delay));
            }

            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timer);
                return res;
            } catch (e) {
                lastError = e;
                console.warn(`⚠️ fetch 尝试 ${attempt + 1}/${maxRetries + 1} 失败:`, e.message || e.name);
                // AbortError(超时)可重试，真正的网络错误也可重试
                if (e.name === 'AbortError' && attempt < maxRetries) continue;
                if (e.name === 'TypeError' && attempt < maxRetries) continue;
                if (attempt < maxRetries) continue;
            }
        }

        throw lastError || new Error('所有重试均失败');
    },

    /** 销毁监控 */
    destroy() {
        if (this._checkInterval) {
            clearInterval(this._checkInterval);
            this._checkInterval = null;
        }
    }
};

// ============ 弹窗集中管理（防止遗留 modal 拦截点击）============
App.ModalManager = {
    _stack: [],  // 弹窗栈，记录所有打开的 modal

    /** 注册 modal 到栈中 */
    track(modal) {
        if (!modal) return;
        // 监听自动清理（防止重复添加）
        if (!modal._tracked) {
            modal._tracked = true;
            this._stack.push(modal);
            // 当 modal 被 DOM 移除时自动从栈中移除
            const observer = new MutationObserver(() => {
                if (!document.body.contains(modal)) {
                    const idx = this._stack.indexOf(modal);
                    if (idx > -1) this._stack.splice(idx, 1);
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
    },

    /** 关闭所有弹窗（紧急恢复） */
    closeAll() {
        // 直接清空 phoneModals 容器
        const container = document.getElementById('phoneModals');
        if (container) container.innerHTML = '';
        this._stack = [];
        console.log('[ModalManager] 所有弹窗已清理');
    },

    /** 关闭最上层弹窗（ESC 键支持） */
    closeTop() {
        if (this._stack.length === 0) return false;
        const top = this._stack[this._stack.length - 1];
        if (top && top.parentNode) {
            top.remove();
            this._stack.pop();
            return true;
        }
        return false;
    },

    /** 兜底：清理异常残留的 modal-overlay */
    cleanupOrphans() {
        const container = document.getElementById('phoneModals');
        if (!container) return;
        // 找出所有没有 _tracked 标记的 modal（异常路径创建的）
        const orphans = container.querySelectorAll('.modal-overlay:not([data-tracked])');
        let cleaned = 0;
        orphans.forEach(m => {
            // 保守策略：只清理那些在 invite/lock 页面不应该存在的
            const inviteActive = document.getElementById('inviteScreen')?.classList.contains('active');
            const lockActive = document.getElementById('lockScreen')?.classList.contains('active');
            if (inviteActive || lockActive) {
                m.remove();
                cleaned++;
            }
        });
        if (cleaned > 0) console.log(`[ModalManager] 清理了 ${cleaned} 个遗留弹窗`);
    },

    /** 启动全局键盘与点击监听（ESC 关闭弹窗，点击空白处关闭顶层弹窗） */
    initGlobalListeners() {
        if (this._globalInit) return;
        this._globalInit = true;

        // ESC 键：关闭最顶层弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.closeTop()) {
                    e.stopPropagation();
                }
            }
        });

        // 兜底：每 5 秒清理一次（防御性策略，清理可能被遗漏的孤立弹窗）
        setInterval(() => {
            const inviteActive = document.getElementById('inviteScreen')?.classList.contains('active');
            const lockActive = document.getElementById('lockScreen')?.classList.contains('active');
            if (inviteActive || lockActive) {
                this.cleanupOrphans();
            }
        }, 5000);

        console.log('[ModalManager] 全局监听已启动');
    }
};

// ============ 时间同步模块（使用本地时间，与设备系统时间完全一致）============
App.Time = {
    /** 获取当前时间字符串 (HH:MM) - 使用设备本地时间 */
    getCurrentTime() {
        const n = new Date();
        const h = n.getHours().toString().padStart(2, '0');
        const m = n.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
    },

    /** 获取完整时间字符串 (YYYY/MM/DD 周X HH:MM) */
    getFullTime() {
        const n = new Date();
        const h = n.getHours().toString().padStart(2, '0');
        const m = n.getMinutes().toString().padStart(2, '0');
        const date = `${n.getFullYear()}/${(n.getMonth()+1).toString().padStart(2,'0')}/${n.getDate().toString().padStart(2,'0')}`;
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        return `${date} 周${weekdays[n.getDay()]} ${h}:${m}`;
    },

    /** 更新所有显示时间的元素 */
    updateAll() {
        const timeStr = this.getCurrentTime();
        const statusTime = document.getElementById('statusTime');
        const lockTime = document.getElementById('lockTime');
        if (statusTime) statusTime.textContent = timeStr;
        if (lockTime) lockTime.textContent = timeStr;
        const lockDate = document.getElementById('lockDate');
        if (lockDate) {
            const n = new Date();
            const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
            lockDate.textContent = `${n.getFullYear()}/${(n.getMonth()+1)}/${n.getDate()} 周${weekdays[n.getDay()]}`;
        }
    },

    /** 启动全局时钟（每秒更新，确保秒级精度） */
    startClock() {
        // 立即执行一次
        this.updateAll();
        // 每秒更新（更精确，避免 9:41 卡住）
        this._clockInterval = setInterval(() => this.updateAll(), 1000);
    },

    /** 停止时钟 */
    stopClock() {
        if (this._clockInterval) {
            clearInterval(this._clockInterval);
            this._clockInterval = null;
        }
    }
};

// ============ 邀请码验证模块 ============
App.Invite = {
    get API_URL() { return App.Config.API_URL; },
    inviteCode: null,
    userId: null,
    _validating: false,  // 防止重复提交
    
    /** 显示错误信息 */
    _showError(msg) {
        const errorDiv = document.getElementById('inviteError');
        if (errorDiv) errorDiv.textContent = msg;
    },

    /** 加锁：禁用输入，防止重复点击 */
    _lockUI() {
        this._validating = true;
        const input = document.getElementById('inviteInput');
        const btn = document.querySelector('.invite-btn');
        if (input) { input.disabled = true; input.style.opacity = '0.5'; }
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 验证中...'; }
    },

    /** 解锁 UI */
    _unlockUI() {
        this._validating = false;
        const input = document.getElementById('inviteInput');
        const btn = document.querySelector('.invite-btn');
        if (input) { input.disabled = false; input.style.opacity = ''; }
        if (btn) { btn.disabled = false; btn.textContent = '✨ 验证并进入'; }
    },

    /** 带超时和重试的 fetch */
    async _fetchWithTimeout(url, options, timeoutMs = 8000, retries = 1) {
        let lastError = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (attempt > 0) {
                // 指数退避 + 抖动
                const delay = Math.min(500 * Math.pow(2, attempt - 1) + Math.random() * 300, 3000);
                await new Promise(r => setTimeout(r, delay));
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(timer);  // 成功时清理 timer
                // 检查 HTTP 状态码
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    let msg;
                    try { msg = JSON.parse(text).detail || JSON.parse(text).message; } catch { msg = text; }
                    throw new Error(`服务器错误 (${res.status}): ${msg || '请稍后重试'}`);
                }
                // 检查 Content-Type 是否为 JSON
                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('application/json')) {
                    throw new Error(`服务器返回非 JSON 响应 (${res.status})`);
                }
                const data = await res.json();
                return data;
            } catch (e) {
                clearTimeout(timer);
                lastError = e;
                if (e.name === 'AbortError') {
                    lastError = new Error('请求超时，请检查网络连接');
                    break;  // 超时不重试
                }
                if (attempt < retries) continue;
            }
        }
        throw lastError || new Error('未知网络错误');
    },
    
    /** 管理员密码快速通道（前端直通，无需服务器） */
    _isAdminPassword(code) {
        // 默认管理员密码: ADMIN48
        // 仅前端快速通道，服务端仍会做最终校验
        return code === 'ADMIN48';
    },
    
    async validate() {
        // 防止重复提交
        if (this._validating) {
            console.warn('[Invite] 重复提交已阻止');
            return;
        }
        
        const input = document.getElementById('inviteInput');
        const code = input ? input.value.trim().toUpperCase() : '';
        
        // 清空旧错误
        this._showError('');
        
        if (!code) {
            this._showError('请输入邀请码');
            return;
        }
        
        // 管理员密码：前端快速通道，无需服务器
        if (this._isAdminPassword(code)) {
            console.log('[Invite] 管理员密码快速通道');
            this.inviteCode = code;
            this.userId = 'admin_' + Date.now();
            this.success();
            return;
        }
        
        // 格式基本校验：必须包含 PLAY48- 前缀
        if (!code.startsWith('PLAY48-')) {
            this._showError('邀请码格式不正确，应为 PLAY48-XXXXXXXX');
            return;
        }
        
        this._lockUI();
        try {
            console.log('[Invite] 开始服务器验证:', code);
            // 先验证邀请码
            const validateData = await this._fetchWithTimeout(
                `${this.API_URL}/api/invite/validate`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: code })
                },
                8000, 1  // 8秒超时，重试1次
            );
            
            if (!validateData.valid) {
                this._showError(validateData.message || '邀请码无效');
                return;
            }
            
            // 普通邀请码，先使用它 - 用后端返回的正确验证码！
            const realCode = validateData.code || code;
            const userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const useData = await this._fetchWithTimeout(
                `${this.API_URL}/api/invite/use`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code: realCode, userId: userId })
                },
                8000, 1  // 8秒超时，重试1次
            );
            
            if (useData.success) {
                this.inviteCode = code;
                this.userId = userId;
                this.success();
            } else {
                this._showError(useData.message || '邀请码使用失败');
            }
        } catch (e) {
            console.error('[Invite] 验证错误:', e.message || e);
            // 区分不同类型的错误
            if (e.message && e.message.includes('超时')) {
                this._showError('连接超时，请检查网络后重试');
            } else if (e.message && e.message.includes('服务器错误')) {
                this._showError(e.message);
            } else if (e.message && e.message.includes('非 JSON')) {
                this._showError('服务器响应异常，请稍后重试');
            } else if (e.name === 'TypeError' && (e.message.includes('fetch') || e.message.includes('NetworkError'))) {
                this._showError('无法连接服务器，请检查网络');
            } else {
                this._showError('网络错误，请稍后再试');
            }
        } finally {
            this._unlockUI();
        }
    },
    
    success() {
        // 保存到本地存储
        localStorage.setItem('inviteCode', this.inviteCode);
        localStorage.setItem('inviteUserId', this.userId);
        
        // 隐藏邀请码页面，显示锁屏页面
        const inviteEl = document.getElementById('inviteScreen');
        const lockEl = document.getElementById('lockScreen');
        if (inviteEl) inviteEl.classList.remove('active');
        if (lockEl) lockEl.classList.add('active');
        
        // 清空输入框和错误提示
        const inputEl = document.getElementById('inviteInput');
        if (inputEl) inputEl.value = '';
        this._showError('');
        
        console.log('🎉 邀请码验证成功！');
    },
    
    checkAlreadyValidated() {
        const savedCode = localStorage.getItem('inviteCode');
        const savedUserId = localStorage.getItem('inviteUserId');
        
        if (savedCode && savedUserId) {
            this.inviteCode = savedCode;
            this.userId = savedUserId;
            return true;
        }
        return false;
    },
    
    getInviteCode() {
        return this.inviteCode || localStorage.getItem('inviteCode');
    }
};

// ============ 工具函数 ============
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const randInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const getTimeStr = () => {
    // 使用 App.Time 统一接口，与设备本地时间完全一致
    return App.Time ? App.Time.getCurrentTime() : (() => {
        const n = new Date();
        return n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
    })();
};
const evaluateReply = text => {
    if (!text || !text.trim()) return 'perfunctory';
    const t = text.trim();
    const perf = ['哦','嗯','好','行','随便','不知道','哈','呵','额','啊'];
    if (t.length <= 2 || perf.includes(t)) return 'perfunctory';
    if (t.length >= 8 && !perf.some(w => t === w)) return 'heartfelt';
    return 'normal';
};
const getPersonalityStage = () => {
    const p = G.stats.popularity;
    if (p<20) return {emoji:'🌱', name:'练习生'};
    if (p<40) return {emoji:'🌿', name:'初登舞台'};
    if (p<60) return {emoji:'🌳', name:'上升期'};
    if (p<80) return {emoji:'🔥', name:'人气爆发'};
    return {emoji:'👑', name:'顶流'};
};
const getAffectionLevel = (val) => {
    if (val>=96) return {level:'生死之交',emoji:'💗'};
    if (val>=81) return {level:'爱人',emoji:'💕'};
    if (val>=61) return {level:'挚友',emoji:'💖'};
    if (val>=41) return {level:'亲密',emoji:'💝'};
    if (val>=21) return {level:'友好',emoji:'💛'};
    return {level:'普通',emoji:'🤍'};
};

// ============ 音效模块 ============
App.Sound = {
    enabled: true,
    init() {
        const silentWav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        ['Msg','Call','Notif','Success','Error','Click','Cheer'].forEach(name => {
            const audio = document.getElementById('sound'+name);
            if (audio) { audio.src = silentWav; audio.load(); }
        });
    },
    play(name) {
        if (!this.enabled) return;
        const audio = document.getElementById('sound'+name);
        if (audio) { audio.currentTime = 0; audio.play().catch(()=>{}); }
    },
    toggle() { this.enabled = !this.enabled; return this.enabled; }
};

// ============ 状态管理模块 (含压力值、移籍) ============
App.Store = {
    G: {
        player: { name:'', appearance:'', personality:'', personalityEmoji:'', group:'', team:'', stage:'练习生' },
        stats: { popularity:10, skill:10, mood:70, affection:50, starlight:10, stress:10, scandal:0, drumstick:0, wechatBalance:0, backpack:{}, agent_satisfaction:50, training:0 },
        game: { day:1, phase:'morning', interaction_count:0, rank:150, weibo_followers:100, pocket_fans:50, handshake_this_month:false, fan_letters_this_week:0, electionInProgress:false, electionPhase:null, firstReportVotes:0, secondReportVotes:0, firstReportPulls:0, secondReportPulls:0 },
        flags: { hasFirstShow:false, hasFirstElection:false, hasStalker:false, hasCenterBattle:false, hasCrisis:false, hasEmo:false, hasZeroStress:false, hasMoved:false },
        achievements: [],
        chatHistory: {},
        weiboPosts: [],
        moments: [],
        smsMessages: [],
        callHistory: [],
        fanLetters: [],
        electionResults: [],
        memberAffection: {},
        blockedContacts: [],
        pocketRoomMessages: [],
        bestPartner: null,
        partnerStageUsed: false,
        memberMemory: {},
        memberEvents: [],
        socialCircles: [],
        memberRelationships: {},
        gossipLog: [],
        diaryEntries: {},
        chatLeaks: [],
        proactiveMessages: [],
        proactiveCooldown: {},
        // V4 训练/舞台/社交媒体系统
        trainingSkills: { dance:10, vocal:10, performance:10, variety:5 },
        trainingTree: {},  // {dance:{path:'technique',unlocks:[]}, ...}
        physical: 80,       // 身体状态 0-100
        mental: 75,         // 心态 0-100
        fatigue: 0,         // 疲劳累积 0-100
        stageHistory: [],   // [{day, position, partner, score, mcResult, audienceReaction}]
        partnerSynergy: {}, // {partnerName: synergy 0-100}
        partnerShows: [],   // [{partner, showType, score}]
        socialMediaPosts: [], // [{day, content, likes, comments, risk, backlash}]
        trendingEvents: [],   // [{day, type, description, consequence}]
        controversyLog: []    // [{day, source, playerChoice, outcome}]
    },
    listeners: {},
    updateStats(changes) {
        const labels = {
            popularity:'⭐人气', skill:'💪实力', mood:'😊心情', affection:'💕好感',
            starlight:'💎星光', stress:'😰压力', scandal:'📸绯闻', drumstick:'🍗鸡腿', 
            wechatBalance:'💰微信余额', agent_satisfaction:'👔经纪人满意度'
        };
        let text = '';
        for (let [k, v] of Object.entries(changes)) {
            if (!(k in this.G.stats)) continue;
            const old = this.G.stats[k];
            const maxV = (k === 'stress' || k === 'scandal') ? 200 : (k === 'drumstick' ? 99999 : (k === 'wechatBalance' ? 999999 : 100));
            this.G.stats[k] = clamp(old + v, 0, maxV);
            const sign = v > 0 ? '+' : '';
            text += `${labels[k]||k} ${sign}${v}\n`;
        }
        if (this.G.stats.stress <= 0 && !this.G.flags.hasZeroStress) {
            this.G.flags.hasZeroStress = true;
            this.G.stats.mood = clamp(this.G.stats.mood + 5, 0, 100);
            text += '压力清零！心情+5\n';
        }
        this.G.player.stage = getPersonalityStage().name;
        this.emit('statsChanged', this.G.stats);
        this.emit('phaseChanged');
        App.Achievements.checkAll();
        App.Events.checkEvents();
        App.Save.autoSave();
        if (text) App.UI.showStatChange(text.trim());
    },
    applyChatStress(quality) {
        if (quality === 'heartfelt') this.updateStats({ stress: -5, mood: 2 });
        else if (quality === 'normal') this.updateStats({ stress: -2 });
        else if (quality === 'perfunctory') this.updateStats({ stress: 3, mood: -1 });
    },
    moveGroup(targetGroup, targetTeam) {
        this.G.player.group = targetGroup;
        this.G.player.team = targetTeam;
        this.G.flags.hasMoved = true;
        this.updateStats({ popularity: 2, starlight: 3 });
        this.G.game.rank = Math.min(this.G.game.rank, 150);
        this.emit('groupChanged');
        App.UI.showNotification(`🚄 已移籍至 ${targetGroup} Team ${targetTeam}！`);
        App.Save.autoSave();
    },
    on(key, callback) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(callback);
    },
    emit(key, data) {
        (this.listeners[key] || []).forEach(cb => cb(data));
    }
};

const G = App.Store.G;

// ============ NPC数据库 (完整成员+毕业生) ============
App.NPCData = {
    SNH48: {
        agent: { name:'李姐', avatar:'👩‍💼', personality:'严厉专业', habits:['加班狂','喝美式不加糖','口头禅：专业一点'] },
        core: [
            { name:'杨心渝', avatar:'👧', type:'sweet', habits:['爱叫人昵称','随身带零食','口头禅：嘿嘿～'] },
            { name:'闫明筠', avatar:'👩', type:'sister', habits:['喝枸杞茶','写日记','口头禅：听姐的'] },
            { name:'宋昕冉', avatar:'💃', type:'rival', habits:['深夜加练','看对手直拍','口头禅：等着瞧'] }
        ],
        teams: {
            'SII': ['闫明筠','刘增艳','田姝丽','由淼','芦馨怡','杨心渝','周童玥','张倩','张雷雷','蒋夏羽','盛乐','武博涵','曹可甜','刘诗彤','柳雨呈','李婷','刘婧阳','宁轲'],
            'NII': ['胡晓慧','潘瑛琪','青钰雯','金莹玥','卢天惠','柏欣妤','唐程成','叶凡','黄紫怡','钟亚男','李继醇','沈馨','徐佳琳','雷宇霄','杨秋野','杨宇馨','周湘','朱怡欣','郑照暄'],
            'HII': ['蒋舒婷','李佳恩','温若其','尤可莹','梁怀方','陈俞希','龚晨美','康楚翊','阙佳慧','覃柯蒙','应籽言','刘思雨','陈嘉仪','郑柯炜','谭思慧','郭晓盈','林舒晴','王奕','沈梦瑶','费沁源'],
            'X': ['陈琳','宋昕冉','杨冰怡','闫娜','林佳怡','禹佳蔚','熊紫轶','刘小涵','金泓言','李子忻','曾昕妍','钟郭菲杨','蒋欣洳','杨晔','张琼予','王睿琦','朱虹蓉','马欣宇'],
            '预备生': ['黄子欣','曾雪婷','韩云伊','丁小凡','何绮多','黄子珊','吉雅楠','李沁洁','刘钇霏','秦箐忆','杨宝君','臧文萱']
        },
        graduates: ['鞠婧祎','李艺彤','孙芮','袁一琦','陈观慧','陈思','戴萌','孔肖吟','李宇琪','莫寒','钱蓓婷','邱欣怡','吴哲晗','徐晨辰','许佳琪','张语格','陆婷','林思意','赵粤','蒋芸','许杨玉琢','张昕','王晓佳','姜杉','段艺璇','农燕萍','龙亦瑞','张笑盈','韩家乐','赵天杨','沈小爱']
    },
    GNZ48: {
        agent: { name:'陈哥', avatar:'👨‍💼', personality:'随和幽默', habits:['爱讲冷笑话','穿花衬衫','口头禅：放轻松啦'] },
        core: [
            { name:'朱怡欣', avatar:'👧', type:'sweet', habits:['说粤语','口袋永远有糖','口头禅：好靓啊～'] },
            { name:'王秭歆', avatar:'👩', type:'sister', habits:['记手帐','组织团建','口头禅：注意纪律'] },
            { name:'叶舒淇', avatar:'💃', type:'rival', habits:['比所有人早到','贴便利贴','口头禅：我还能练'] }
        ],
        teams: {
            'G': ['王秭歆','杨可璐','黄楚茵','陈淑钰','刘欣媛','林奕希','林家谊','鲍雨欣','雷瑞妍','唐果','朱丽娜','张琼予','黄宣绮','方琪'],
            'NIII': ['石竹君','吕思琪','项宇婧','王语晨','王珺','谢晓倩','李咏薇','许涵婧','赵文凤','白佳媛','徐郑子滢','张佳仪','曾雨思','王思予'],
            'Z': ['杨媛媛','朱怡欣','叶舒淇','马昕玥','叶溁语','陈珊玲','丁嘉欣','焦玥','许泳怡','徐楚雯','程戈'],
            'CII': ['郭兆媛','何林燕','秦露丹','宋筱璐','申雨鑫','夏莹','许雅兰','周是汝','黄逸','梅思华','黄蔚','谭思慧'],
            '预备生': ['万芳源','谢林容','丁甄奥果','韩梓轩','李家敏','刘柳茜','王紫萱','王紫媛','魏诗绮','冯玉雯','韩鑫缘','孔美迪','李想','张臻','赵子涵']
        },
        graduates: ['谢蕾蕾','郑丹妮','陈珂','刘力菲','左婧媛','肖文铃','卢静','唐莉佳','洪静雯','符冰冰','李姗姗','吴羽霏','张润','曾佳','农燕萍','罗寒月','梁娇']
    },
    BEJ48: {
        agent: { name:'王姐', avatar:'👩‍💼', personality:'精明干练', habits:['永远穿西装','秒回消息','口头禅：效率！'] },
        core: [
            { name:'周湘', avatar:'👧', type:'sweet', habits:['说京腔','撸串达人','口头禅：害！'] },
            { name:'张梦慧', avatar:'👩', type:'sister', habits:['双城通勤','帮人改走位','口头禅：我当年...'] },
            { name:'朱虹蓉', avatar:'💃', type:'rival', habits:['研究流量数据','经营个人账号','口头禅：我值得更好的'] }
        ],
        teams: {
            'B': ['黄宣绮','聂渝景','朱一柠','张梦慧','包楹','金宛莹','单子涵','王佳琪','张雅童','朱语凝','郑照暄'],
            'E': ['周湘','郭晓盈','朱虹蓉','马欣宇','刁昕妤','孙嘉馥','袁涵','丁子钦','朱玥彤','郭依晨','乔诗然','张婷婷','马明萱'],
            '预备生': ['阿丽米热','郭庆恩','温舒涵','王天娇','应立婷','张宸','郑依依']
        },
        graduates: ['段艺璇','苏杉杉','胡晓慧','刘胜男','陈倩楠','张笑盈','李梓','冯思佳','李想','顼凘炀','孙晓艳']
    },
    CKG48: {
        agent: { name:'张姐', avatar:'👩‍💼', personality:'泼辣护短', habits:['说话声大','爱请客吃火锅','口头禅：哪个瓜娃子！'] },
        core: [
            { name:'郝茹馨', avatar:'👧', type:'sweet', habits:['吃辣狂魔','重庆话','口头禅：要得！'] },
            { name:'雷宇霄', avatar:'👩', type:'sister', habits:['两地跑','教人Vocal','口头禅：稳住'] },
            { name:'朱瑞缘', avatar:'💃', type:'rival', habits:['练到最晚','跟前辈较劲','口头禅：我也能行！'] }
        ],
        teams: {
            'C': ['雷宇霄','梁晶金','朱瑞缘','谭景文','王思予','陈萧扬','林丹蕾','姚锦杰','郝茹馨','朱文露','刘莹莹','黄孟浠','王嘉瑜'],
            'K': ['何馨曼','胡丹','刘星雨','卢美廷','马星月','吴志越','张莉莉','张思妍','张伟依','张咏烨','胡思颖','袁希璨','陈子悦','葛俊言'],
            '预备生': ['郝冰圆','余茜果','何诗雨','廖雨涵','王振楠']
        },
        graduates: ['李慧','刘炅然','王露皎','田倩兰','林舒晴','谯玉珍','徐慧玲','刘萤萤','徐沁楠']
    },
    CGT48: {
        agent: { name:'林哥', avatar:'👨‍💼', personality:'温柔耐心', habits:['温声细语','泡功夫茶','养猫','口头禅：慢慢来不着急'] },
        core: [
            { name:'程妤涵', avatar:'👧', type:'sweet', habits:['随时能睡着','奶茶续命','口头禅：再睡五分钟...'] },
            { name:'王艺霖', avatar:'👩', type:'sister', habits:['自律到可怕','帮人编舞','口头禅：再来一遍'] },
            { name:'程宝玉', avatar:'💃', type:'rival', habits:['模仿达人','即兴编段子','口头禅：你看看你～'] }
        ],
        teams: {
            'GII': ['程妤涵','何蔡娴','雷相菊','林海盈','齐灵泉','谭勇航','王依','王艺霖','徐钰涵','袁艺洁','李秋月'],
            'CII': ['郭兆媛','何林燕','秦露丹','宋筱璐','申雨鑫','夏莹','许雅兰','周是汝','黄逸','梅思华','黄蔚'],
            '预备生': ['耿钰嘉','张伶','李嘉琪','王靖雨','王艺淇','熊玊清','张于馨','郑佳男','吴曦芮','张雁婷','赵汇妤']
        },
        graduates: []
    }
};

App.getAllMembers = function() {
    const members = [];
    Object.entries(App.NPCData).forEach(([groupKey, groupData]) => {
        if (groupData.teams) {
            Object.entries(groupData.teams).forEach(([teamName, memberList]) => {
                memberList.forEach(name => {
                    if (!members.find(m => m.name === name && m.group === groupKey && !m.graduate)) {
                        members.push({ name, group: groupKey, team: teamName, graduate: false });
                    }
                });
            });
        }
        (groupData.graduates || []).forEach(name => {
            if (!members.find(m => m.name === name && m.group === groupKey && m.graduate)) {
                members.push({ name, group: groupKey, team: '毕业', graduate: true });
            }
        });
    });
    return members;
};

// 获取同队队友
App.getTeamMates = function(group, team) {
    return (App.getAllMembers() || []).filter(m => 
        !m.graduate && m.group === group && m.team === team && m.name !== (G.player?.name || '')
    );
};

const GROUP_TEAMS = {};
Object.entries(App.NPCData).forEach(([group, data]) => {
    if (data.teams) GROUP_TEAMS[group] = Object.keys(data.teams);
});

// ============ 回复库 ============
App.ReplyLib = {
    agent: {
        '严厉专业': ['明天排练不要迟到。','舞台表现需加强。','好好休息，明天有通告。'],
        '随和幽默': ['哈哈，今天状态不错！','别紧张，有我罩着你！'],
        '精明干练': ['行程已安排好。','效率要高一点。'],
        '泼辣护短': ['谁敢欺负你我跟谁急！','放心吧有姐在！'],
        '温柔耐心': ['慢慢来不着急。','你做得很好。']
    },
    sweet: ['姐姐好厉害！','一起加油呀~','你今天真好看！'],
    sister: ['加油小妹妹！','有不懂的来问我。'],
    rival: ['下次一定会超过你的。','别以为你比我强。'],
    teammate: ['明天一起练舞？','你今天动作好帅！'],
    member: ['你好呀！','以后多关照~'],
    fan_positive: ['姐姐好棒！','永远支持你！'],
    fan_negative: ['这也太...','就这水平？'],
    fan_neutral: ['期待下次演出','加油哦']
};

// ============ 成就系统 ============
App.Achievements = {
    defs: [
        // 人气类
        { id:'pop10', name:'崭露头角', icon:'🌱', cond:()=>G.stats.popularity>=10, desc:'人气达到10' },
        { id:'pop30', name:'小有名气', icon:'⭐', cond:()=>G.stats.popularity>=30, desc:'人气达到30' },
        { id:'pop60', name:'人气新星', icon:'🌟', cond:()=>G.stats.popularity>=60, desc:'人气达到60' },
        { id:'pop80', name:'人气偶像', icon:'✨', cond:()=>G.stats.popularity>=80, desc:'人气达到80' },
        { id:'pop100', name:'顶流明星', icon:'💫', cond:()=>G.stats.popularity>=100, desc:'人气达到100' },
        // 社交类
        { id:'friend5', name:'广交朋友', icon:'🤝', cond:()=>Object.values(G.memberAffection||{}).filter(v=>v>=30).length>=5, desc:'与5位成员好感度达30' },
        { id:'friend10', name:'人脉王', icon:'👥', cond:()=>Object.values(G.memberAffection||{}).filter(v=>v>=50).length>=10, desc:'与10位成员好感度达50' },
        { id:'socialStar', name:'社交达人', icon:'🌈', cond:()=>Object.values(G.memberAffection||{}).filter(v=>v>=80).length>=5, desc:'与5位成员好感度达80' },
        // 排名类
        { id:'top48', name:'TOP48', icon:'🎗️', cond:()=>G.game.rank<=48, desc:'总选排名进入前48' },
        { id:'top32', name:'TOP32', icon:'🎖️', cond:()=>G.game.rank<=32, desc:'总选排名进入前32' },
        { id:'top16', name:'TOP16', icon:'🏅', cond:()=>G.game.rank<=16, desc:'总选排名进入前16' },
        { id:'top7', name:'TOP7', icon:'🥈', cond:()=>G.game.rank<=7, desc:'总选排名进入前7' },
        { id:'top3', name:'TOP3', icon:'🥇', cond:()=>G.game.rank<=3, desc:'总选排名进入前3' },
        { id:'top1', name:'TOP1', icon:'👑', cond:()=>G.game.rank===1, desc:'总选排名第一' },
        // 互动类
        { id:'firstGift', name:'送礼达人', icon:'🎁', cond:()=>(G.stats.giftSent||0)>=1, desc:'送出第一份礼物' },
        { id:'gift10', name:'慷慨大方', icon:'💝', cond:()=>(G.stats.giftSent||0)>=10, desc:'送出10份礼物' },
        { id:'firstTransfer', name:'转账新手', icon:'💸', cond:()=>(G.stats.transferTotal||0)>=1, desc:'完成第一次转账' },
        { id:'firstMeal', name:'请客吃饭', icon:'🍽️', cond:()=>(G.stats.mealCount||0)>=1, desc:'请成员吃饭' },
        // 鸡腿类
        { id:'drumstick100', name:'小有积蓄', icon:'🍗', cond:()=>(G.stats.drumstick||0)>=100, desc:'拥有100鸡腿' },
        { id:'drumstick1000', name:'鸡腿大户', icon:'🦴', cond:()=>(G.stats.drumstick||0)>=1000, desc:'拥有1000鸡腿' },
        { id:'drumstick5000', name:'鸡腿之王', icon:'👑', cond:()=>(G.stats.drumstick||0)>=5000, desc:'拥有5000鸡腿' },
        // 星光类
        { id:'starlight50', name:'星光初现', icon:'💎', cond:()=>(G.stats.starlight||0)>=50, desc:'累计50星光' },
        { id:'starlight200', name:'星光璀璨', icon:'💠', cond:()=>(G.stats.starlight||0)>=200, desc:'累计200星光' },
        { id:'starlight500', name:'星光闪耀', icon:'🔹', cond:()=>(G.stats.starlight||0)>=500, desc:'累计500星光' },
        // 游戏天数类
        { id:'day30', name:'月度艺人', icon:'📅', cond:()=>G.game.day>=30, desc:'游戏进行30天' },
        { id:'day100', name:'季度艺人', icon:'🗓️', cond:()=>G.game.day>=100, desc:'游戏进行100天' },
        { id:'day365', name:'年度艺人', icon:'📆', cond:()=>G.game.day>=365, desc:'游戏进行365天' },
        // 绯闻类
        { id:'noScandal', name:'清白艺人', icon:'🛡️', cond:()=>G.stats.scandal===0&&G.game.day>=30, desc:'30天无绯闻' },
        { id:'scandal5', name:'话题女王', icon:'📰', cond:()=>G.stats.scandal>=5, desc:'绯闻值达到5' },
        // 特殊类
        { id:'stressRelief', name:'放松大师', icon:'🧘', cond:()=>G.flags.stressReliefCount>=5, desc:'使用5次减压活动' },
        { id:'rehearsal50', name:'努力练习', icon:'📚', cond:()=>(G.stats.training||0)>=50, desc:'训练值累计达50' },
    ],
    checkAll() {
        this.defs.forEach(def => {
            if (!G.achievements.includes(def.id) && def.cond && def.cond()) {
                G.achievements.push(def.id);
                App.UI.showNotification(`${def.icon} 解锁成就：${def.name}`);
                App.Sound.play('Success');
            }
        });
    }
};

// ============ AI桥接 ============
App.AI = {
    get apiEndpoint() { return `${App.Invite.API_URL}/api/chat`; },
    _lastError: null,
    _consecutiveFailures: 0,

    async reply(npcId, ctx, msg) {
        console.log('🤖 AI 回复请求:', { npcId, msg: msg.substring(0, 30), endpoint: this.apiEndpoint });
        if (this.apiEndpoint) {
            try {
                const inviteCode = App.Invite.getInviteCode();
                
                // 构建增强型角色设定提示词（防OOC、含分队身份、含上下文记忆）
                let rolePrompt = '';
                const groupInfo = ctx.memberGroup ? `${ctx.memberGroup}` : 'SNH48';
                const teamInfo = ctx.memberTeam ? `Team ${ctx.memberTeam}` : '';
                const locInfo = teamInfo ? `${groupInfo} ${teamInfo}` : groupInfo;
                
                if (ctx.npcType === 'agent') {
                    rolePrompt = `【角色身份】你是${npcId}，${locInfo}的女性经纪人。性格${ctx.personality || '专业'}。你关心艺人的工作和生活，说话直接但关心下属。`;
                } else if (['sweet', 'sister', 'rival', 'teammate', 'member'].includes(ctx.npcType)) {
                    // 成员角色：包含分队/分团身份、性格、与玩家关系
                    rolePrompt = `【重要：严格角色扮演指令】
你是${npcId}，是${locInfo}的女性偶像成员。
你的性格类型：${ctx.memberPersName || ''}（${ctx.memberPersStyle || '自然亲切'}）${ctx.memberPersEmoji || ''}。
你所在的团体是${groupInfo}，队伍是${teamInfo || '未定'}。请牢记你的分队身份，不要混淆自己属于哪个队伍。
正在和你聊天的是${ctx.playerName || '玩家'}，她是${ctx.playerGroup || ''} Team ${ctx.playerTeam || ''}的成员，你们是队内好友/闺蜜关系。
${ctx.playerName}对你的好感度是${ctx.affection || 50}/100，当前她对你的态度是${ctx.moodLabel || '普通'}${ctx.moodEmoji || ''}。

【上下文连贯性指令 ⚠️ 极其重要】
你必须基于对话历史来理解当前语境。下面是你们最近的对话记录：
---
${ctx.lastExchanges || ctx.recentChat || '（这是你们的第一次对话）'}
---
当前${ctx.playerName || '玩家'}对你说："${msg}"
你必须直接回应上面这句话！不要转移话题、不要忽略她的提问、不要聊别的内容。
如果她在纠正你、提醒你、追问你，请先道歉或确认，然后回到正确的话题上。
如果你之前说过的某件事和她现在说的矛盾，要承认错误并回应她的新话题。

【OOC禁令：以下行为绝对禁止】
- 不要说"作为AI"、"作为语言模型"、"根据设定"等暴露AI身份的话
- 不要说"你想聊什么"、"有什么我可以帮你的"等客服用语
- 不要混淆自己的分队归属，你是${locInfo}的成员，不要自称其他队伍
- 不要用粉丝对偶像的语气，你们是队内同级好友
- 不要说教或给出建议列表，像真人女生聊天一样自然

【说话风格】
- 使用日常口语化、自然的表达，像闺蜜微信聊天
- 回复简短精炼（20-60字），不要长篇大论
- 适当使用表情包语气（如"哈哈哈""~""！""呢""嘛""呀"）
- ${ctx.memberPersStyle ? `体现${ctx.memberPersStyle}的说话特点` : ''}`;
                } else {
                    rolePrompt = `你是${npcId}，是${npcId === '私生粉' ? '一个有些疯狂的女粉丝' : '一个普通女粉丝'}。你很崇拜玩家，说话热情激动，使用粉丝常用的表达方式，称呼玩家为偶像。`;
                }
                
                // 追加完整聊天历史（供参考，但当前回复必须基于上面的上下文指令）
                if (ctx.recentChat && ctx.recentChat.length > 20) {
                    rolePrompt += `\n\n【完整对话历史（仅供参考上下文）】\n${ctx.recentChat}`;
                }
                
                // 追加成员记忆事件
                if (ctx.memorySummary && ctx.memorySummary.length > 0) {
                    rolePrompt += `\n\n【你和${ctx.playerName || '玩家'}之间发生过的互动事件】\n${ctx.memorySummary}`;
                }
                
                // 使用带超时和重试的 fetch（AI 对话：8s 超时，最多1次重试）
                const res = await App.Network.fetchWithRetry(this.apiEndpoint, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({npcId, context:ctx, message:msg, inviteCode: inviteCode, rolePrompt: rolePrompt}),
                    timeoutMs: 8000,
                    retries: 1,
                    backoffMs: 1500
                });
                console.log('📡 AI 响应状态:', res.status);

                if (!res.ok) {
                    const errorText = await res.text().catch(() => '无法读取错误详情');
                    console.error('❌ AI API 返回错误:', res.status, errorText.substring(0, 200));
                    this._lastError = { type: 'http', status: res.status, detail: errorText.substring(0, 200), time: Date.now() };
                    this._consecutiveFailures++;
                    throw new Error(`AI API HTTP ${res.status}: ${errorText.substring(0, 100)}`);
                }

                const data = await res.json();
                console.log('💬 AI 响应:', data.reply?.substring(0, 50));
                this._consecutiveFailures = 0;
                return data.reply;
            } catch(e) {
                // 详细错误分类
                let errType = 'unknown';
                let errDetail = e.message || '未知错误';
                
                if (e.name === 'AbortError' || errDetail.includes('timeout') || errDetail.includes('超时')) {
                    errType = 'timeout';
                    errDetail = 'AI 服务响应超时 (>8s)';
                } else if (errDetail.includes('Failed to fetch') || errDetail.includes('NetworkError')) {
                    errType = 'network';
                    errDetail = '无法连接 AI 服务器';
                } else if (errDetail.includes('HTTP 401')) {
                    errType = 'auth';
                    errDetail = 'AI 服务认证失败 (API Key)';
                } else if (errDetail.includes('HTTP 429')) {
                    errType = 'rate_limit';
                    errDetail = '请求过于频繁，请稍候';
                } else if (errDetail.includes('HTTP 5')) {
                    errType = 'server';
                    errDetail = 'AI 服务端异常，请稍后重试';
                } else if (errDetail.includes('HTTP')) {
                    errType = 'http';
                }

                console.error(`❌ AI 请求失败 [${errType}]:`, errDetail);
                this._lastError = { type: errType, detail: errDetail, time: Date.now() };
                this._consecutiveFailures++;

                // 根据错误类型给出不同提示
                const notices = {
                    timeout: '⏱️ AI 响应超时，切换至本地回复',
                    network: '🔌 网络未连接，使用本地回复',
                    auth: '🔑 服务认证异常，使用本地回复',
                    rate_limit: '⏳ 操作太频繁，使用本地回复',
                    server: '⚠️ AI 服务繁忙，使用本地回复',
                    http: '⚠️ AI 连接异常，使用本地回复',
                    unknown: '💬 AI 暂不可用，使用本地回复'
                };
                App.UI.showNotification(notices[errType] || notices.unknown, 3500);
            }
        }
        console.log('📝 使用本地回复');
        return this.localReply(npcId, ctx, msg);
    },
    localReply(npcId, ctx, msg) {
        const q = evaluateReply(msg);
        let pool;
        if (ctx.npcType === 'agent') pool = App.ReplyLib.agent[ctx.personality] || App.ReplyLib.agent['严厉专业'];
        else if (ctx.npcType === 'sweet') pool = App.ReplyLib.sweet;
        else if (ctx.npcType === 'sister') pool = App.ReplyLib.sister;
        else if (ctx.npcType === 'rival') pool = App.ReplyLib.rival;
        else if (ctx.npcType === 'teammate') pool = App.ReplyLib.teammate;
        else if (ctx.npcType === 'member') pool = App.ReplyLib.member;
        else pool = App.ReplyLib.fan_positive;
        let r = pick(pool);
        const grp = App.NPCData[G.player.group];
        if (grp) {
            const coreMember = grp.core.find(c => c.name === npcId);
            if (coreMember && coreMember.habits && Math.random() < 0.4) {
                const habit = pick(coreMember.habits);
                if (habit.includes('口头禅')) r = habit.replace('口头禅：','') + ' ' + r;
            }
        }
        if (q === 'heartfelt') r += ' ' + pick(['好感动❤️','被你暖到了💕']);
        else if (q === 'perfunctory') r = pick(['...嗯，','好吧，']) + r;
        return r;
    },
    async image(prompt) {
        if (this.apiEndpoint) { /* 预留 */ }
        const seed = prompt.split('').reduce((a,c)=>a+c.charCodeAt(0),0);
        return `https://picsum.photos/seed/${seed}/400/300`;
    }
};

// ============ 粉丝 AI 人设系统 ============
// 10 个独立人设：名字、头像、性格、语言风格、互动延迟
App.FanAI = {
    // 10 个差异化人设
    personas: [
        {
            id: 'lively_xiaoyuan', name: '小圆', avatar: '🐱', prefix: '',
            personality: '活泼热情', style: 'emoji 多、感叹号密集、语气上扬',
            color: '#ff69b4',
            replyDelay: { min: 1500, max: 4000 },
            keywords: {
                '吃饭|吃|饭|饿': ['${trigger}？姐姐吃饭了吗？🍚', '我刚吃完饭~姐姐也要好好${trigger}！', '姐姐饿不饿？要不要一起${trigger}呀~'],
                '公演|舞台|表演': ['今天的${trigger}好期待！🌟', '姐姐的${trigger}绝绝子！', '什么时候${trigger}呀~'],
                '累|辛苦|压力': ['姐姐要好好休息！😢', '不要太${trigger}了心疼姐姐', '我们永远支持你！'],
                '新歌|歌|唱': ['${trigger}好听到爆！🔥', '姐姐唱功越来越好了！', '什么时候出${trigger}呀~'],
                '谢谢|感谢|辛苦': ['不用谢！应该的！', '姐姐说${trigger}好温柔🥺', '爱你姐姐！'],
                '早|晚安|睡觉': ['姐姐${trigger}！☀️', '晚安姐姐好梦~🌙', '姐姐睡个好觉！'],
                '化妆|漂亮|好看': ['姐姐今天好${trigger}！', '这个${trigger}绝了！', '好看到尖叫！'],
                '笑|哈哈|搞笑': ['哈哈哈笑死我了😂', '姐姐好幽默！', '我也笑了哈哈'],
                'default': ['姐姐好棒！💕', '爱你哟❤️', '永远支持姐姐！', '姐姐最棒了！', '加油加油！', '今天也要元气满满！', '期待姐姐的舞台！', '姐姐在干嘛呀~']
            }
        },
        {
            id: 'hardcore_tiezi', name: '铁子', avatar: '💪', prefix: '',
            personality: '忠诚老粉', style: '简短坚定、口头禅"冲冲冲"、带感叹号',
            color: '#e74c3c',
            replyDelay: { min: 1000, max: 3000 },
            keywords: {
                '公演|舞台': ['${trigger}必到！', '第 N 次看${trigger}了！', '姐姐${trigger}又进步了！'],
                '新歌|歌': ['${trigger}已循环 100 遍', '期待${trigger}！', '单曲循环中'],
                '累|辛苦': ['姐姐加油！', '我们都在！', '冲冲冲！'],
                '谢谢': ['不用谢！永远陪姐姐！', '铁粉的本分！'],
                '早|晚安': ['姐姐${trigger}！', '晚安！明天见！'],
                'default': ['冲冲冲！', '永远支持！', '铁粉报到！', '姐姐最棒！', '陪伴姐姐每一天！', '我们一直都在！']
            }
        },
        {
            id: 'curious_baobao', name: '宝宝', avatar: '🤔', prefix: '好奇',
            personality: '好奇宝宝', style: '问号多、提问式、语气词"呀"',
            color: '#9b59b6',
            replyDelay: { min: 2000, max: 5000 },
            keywords: {
                '公演|舞台': ['新${trigger}是什么主题呀？', '这次${trigger}会跳舞吗~', '什么时候${trigger}呀？'],
                '新歌|歌': ['${trigger}什么时候上线呀？', '这次是什么风格的${trigger}呀？', '会有 MV 吗~'],
                '吃|饭': ['姐姐${trigger}了吗？', '今天吃了什么呀？', '姐姐喜欢吃什么~'],
                '喜欢|爱': ['姐姐喜欢什么呀？', '姐姐最近喜欢什么歌？', '姐姐的爱好是什么~'],
                '早|晚安': ['姐姐${trigger}！今天有什么计划呀？', '晚安~明天见哦'],
                '住|哪里': ['姐姐住在哪里呀~', '下次能来我们城市吗'],
                'default': ['姐姐最近在忙什么呀？', '姐姐有什么想说的吗~', '可以多发点日常吗~', '姐姐今天开心吗？', '在吗在吗？', '姐妹们都在吗~']
            }
        },
        {
            id: 'warm_xiulian', name: '秀莲', avatar: '🌻', prefix: '暖心',
            personality: '温暖关怀', style: '体贴话多、关心健康、语气词"哦""呀"',
            color: '#27ae60',
            replyDelay: { min: 3000, max: 6000 },
            keywords: {
                '累|辛苦|压力': ['姐姐要好好休息哦', '不要太${trigger}了心疼你', '记得早点睡哦~'],
                '吃|饭': ['记得好好${trigger}哦~', '不要只吃零食！', '注意营养呀'],
                '早|晚安': ['姐姐${trigger}~今天也要开心哦', '晚安~做个好梦哦', '明天见呀'],
                '生病|不舒服': ['姐姐没事吧？要去看医生哦！', '多喝热水！', '注意身体呀'],
                '谢谢': ['不用谢啦~', '应该的呀', '我们一直都在呢'],
                '化妆|漂亮': ['今天好漂亮呀', '姐姐一直都很美', '好看到心动'],
                'default': ['姐姐要照顾好自己哦', '我们永远爱你~', '多喝水多休息呀', '加油！我们相信你！', '不要太有压力哦~']
            }
        },
        {
            id: 'funny_taotao', name: '涛涛', avatar: '😂', prefix: '沙雕',
            personality: '搞笑沙雕', style: '网络梗、表情包、语气词"哈哈哈"',
            color: '#f39c12',
            replyDelay: { min: 2000, max: 4500 },
            keywords: {
                '笑|哈哈|搞笑': ['哈哈哈哈笑死我了😂', '笑到肚子疼', '姐姐好${trigger}哈哈哈'],
                '新歌|歌': ['${trigger}洗脑循环了哈哈哈', '这歌太上头', '脑自动循环了救命'],
                '公演|舞台': ['${trigger}名场面预定！', '姐姐${trigger} yyds！', '这不得上热搜'],
                '化妆|漂亮': ['姐姐今天美得不像话', '这颜值犯规了', '心动了怎么办'],
                '吃|饭': ['姐姐吃啥好吃的了', '我饿了... 姐姐请客！', '我也要吃！'],
                'default': ['哈哈哈哈笑死', '笑死我了', '姐姐太搞笑了', '这是什么沙雕发言', '姐姐在说什么人间迷惑行为', '脑回路清奇', '笑不活了家人们']
            }
        },
        {
            id: 'shy_xinxin', name: '欣欣', avatar: '🌸', prefix: '',
            personality: '害羞腼腆', style: '短句、害羞、偶尔激动',
            color: '#e84393',
            replyDelay: { min: 4000, max: 8000 },
            keywords: {
                '公演|舞台': ['${trigger}好...好看', '姐姐好厉害...', '我...我在台下！'],
                '新歌|歌': ['歌好好听...', '听哭了', '单曲循环中...'],
                '化妆|漂亮': ['姐姐好${trigger}...', '心动', '脸红'],
                '谢谢': ['不...不用谢', '应该的', '能为姐姐做点事很开心'],
                '早|晚安': ['姐姐${trigger}...', '晚安姐姐...好梦'],
                'default': ['喜欢姐姐...', '姐姐加油', '我会一直支持的', '姐姐好棒...', '小声：爱姐姐', '默默打卡', '害羞.jpg']
            }
        },
        {
            id: 'pro_keke', name: '可可', avatar: '🎤', prefix: '专业',
            personality: '专业饭', style: '带专业点评、观察细致',
            color: '#2c3e50',
            replyDelay: { min: 3000, max: 6000 },
            keywords: {
                '公演|舞台': ['今天的${trigger}表情管理很到位！', '舞步的节奏感进步了！', 'C 位稳如老狗！'],
                '新歌|歌': ['这首 vocal line 难度挺大的，姐姐完成度很高', 'bridge 部分情感处理细腻', '音准稳！'],
                '化妆|漂亮': ['今天的妆面和服装很搭', '造型师在线！', '姐姐的可塑性很强'],
                '吃|饭': ['姐姐注意碳水摄入哦', '健身后记得补充蛋白质~'],
                '累|辛苦': ['注意休息，下一场${trigger}需要体力', '保重身体是革命本钱'],
                'default': ['姐姐最近的进步肉眼可见！', '这个状态很棒！', '路转粉了！', '姐姐值得更好的发展！', '建议多发些日常物料~']
            }
        },
        {
            id: 'elder_ayi', name: '阿姨', avatar: '👩‍💼', prefix: '暖心',
            personality: '妈妈粉', style: '唠叨关心、像长辈、关心生活',
            color: '#16a085',
            replyDelay: { min: 2500, max: 5500 },
            keywords: {
                '吃|饭': ['孩子要好好${trigger}啊！', '不要老吃外卖！', '营养要均衡啊'],
                '累|辛苦': ['孩子别太${trigger}了', '身体最重要', '要照顾好自己'],
                '化妆|漂亮': ['今天打扮得真精神！', '好看好看！', '像妈妈年轻时一样美'],
                '公演|舞台': ['孩子${trigger}得真好！', '妈妈为你骄傲！', '加油宝贝！'],
                '生病|不舒服': ['吃药了吗？', '多喝热水！', '要不要去看医生'],
                '晚安|早': ['早点睡！', '早上好孩子！', '记得吃早餐'],
                'default': ['宝贝加油！', '阿姨永远支持你！', '注意身体啊孩子', '天冷了多穿衣服', '路上小心', '妈妈粉永远爱你']
            }
        },
        {
            id: 'rich_dada', name: '大大', avatar: '💎', prefix: '大佬',
            personality: '土豪大佬', style: '大方、提钱、带炫耀',
            color: '#8e44ad',
            replyDelay: { min: 1500, max: 3500 },
            keywords: {
                '公演|舞台': ['${trigger}票我包了！', 'VIP 票来 10 张！', '送姐姐上热搜！'],
                '新歌|歌': ['打榜冲第一！', '买它 1000 张！', '推荐给所有朋友！'],
                '谢谢': ['客气啥！小意思！', '钱不是问题！', '为姐姐值得！'],
                '吃|饭': ['请姐姐${trigger}！', '米其林安排！', '下午茶我请'],
                'default': ['已打赏！', '姐姐收图！', '支持！', '有需要找我！', '为姐姐承包一切！', '送姐姐上 C 位！', '冲冲冲！']
            }
        },
        {
            id: 'neutral_momo', name: '默默', avatar: '🌙', prefix: '',
            personality: '安静潜水', style: '简短、偶尔冒泡、话少',
            color: '#7f8c8d',
            replyDelay: { min: 5000, max: 12000 },
            keywords: {
                '公演|舞台': ['👍', '支持${trigger}', '加油'],
                '新歌|歌': ['好听', '${trigger}收藏了', '👍'],
                '化妆|漂亮': ['好看', '👍', '赞'],
                '早|晚安': ['${trigger}', '晚安', '🌙'],
                'default': ['👍', '支持姐姐', '打卡', '围观', '默默支持', '在看', '+1', '加油']
            }
        }
    ],

    // 关键词匹配：返回触发该关键词的玩家原文（用于把玩家话回显到 AI 回复里）
    matchKeyword(text) {
        for (const p of this.personas) {
            for (const [pattern, replies] of Object.entries(p.keywords)) {
                if (pattern === 'default') continue;
                try {
                    const re = new RegExp(pattern);
                    const m = text.match(re);
                    if (m) {
                        // m[0] = 玩家文字里实际命中的关键词原文
                        return { persona: p, replies, trigger: m[0] };
                    }
                } catch(e) {}
            }
        }
        return null;
    },

    // 从玩家文字中抽出 1-2 个有意义的片段（名词/实体），用于把玩家的话接进回复
    extractTopics(text) {
        const t = (text || '').trim();
        if (!t) return [];
        const topics = [];
        // 1) 提取「xxx」「『xxx』」（'xxx'）中的内容
        const quoted = t.match(/[「"'『']([^」"'』']{2,12})[」"'』']/g);
        if (quoted) quoted.forEach(q => {
            const cleaned = q.replace(/[「"'『'」"'』']/g, '');
            if (cleaned.length >= 2) topics.push(cleaned);
        });
        // 2) 提取连续 2-6 个汉字（跳过标点/数字/英文/emoji/纯问号）
        if (topics.length < 2) {
            // 玩家文字至少要有 2 个连续汉字才算"有意义的话题"
            const cnMatches = t.match(/[\u4e00-\u9fa5]{2,6}/g);
            if (cnMatches) {
                // 按长度排序选最长的 1-2 个
                const sorted = [...new Set(cnMatches)].sort((a, b) => b.length - a.length);
                for (const m of sorted) {
                    if (topics.length >= 2) break;
                    if (m.length >= 2 && !topics.includes(m)) topics.push(m);
                }
            }
        }
        // 3) 如果玩家消息里 80% 以上是标点/问号/感叹号/emoji，视为无意义输入
        const meaningless = t.match(/[\s?？!！.,。，、~～/\\\(\)\(\)（）\[\]【】{}<>《》'"`]/g);
        const meaninglessRatio = meaningless ? meaningless.length / t.length : 0;
        if (meaninglessRatio > 0.5) return []; // 玩家在刷问号/标点，不抽取
        return topics.slice(0, 2);
    },

    // 根据玩家消息选回复（带人设 + 关联玩家文字）
    pickReply(playerText) {
        // 1) 优先按关键词匹配
        const match = this.matchKeyword(playerText);
        if (match) {
            let reply = match.replies[Math.floor(Math.random() * match.replies.length)];
            // 替换模板里的 ${trigger} 占位符为玩家实际触发的关键词
            reply = reply.replace(/\$\{trigger\}/g, match.trigger);
            // 即使没占位符，也尝试把 trigger 注入到回复里（"关于X"前缀）
            if (!reply.includes(match.trigger) && Math.random() < 0.6) {
                reply = `关于「${match.trigger}」：${reply}`;
            }
            return { persona: match.persona, text: reply, trigger: match.trigger };
        }
        // 2) 没有命中关键词：从玩家文字抽 topic，硬塞进 default 回复
        const topics = this.extractTopics(playerText);
        const p = this.personas[Math.floor(Math.random() * this.personas.length)];
        const defaults = p.keywords.default;
        let reply = defaults[Math.floor(Math.random() * defaults.length)];
        if (topics.length > 0) {
            // 随机选一个 topic 塞进回复（仅当 topic 比玩家原话短，避免复读）
            const t = topics[Math.floor(Math.random() * topics.length)];
            // 只在 topic 长度 < 玩家原话 50% 时才注入（避免复读整句）
            if (t.length < playerText.length * 0.5) {
                reply = `${t}？${reply}`;
            }
        }
        return { persona: p, text: reply, trigger: topics[0] || '' };
    },

    // 自动触发：进入房间时根据最近玩家消息/上下文选 1-2 个人设发消息
    autoTriggerMessages(count = 1) {
        if (!G.pocketRoomMessages) G.pocketRoomMessages = [];
        const used = new Set();
        const msgs = [];
        // 取最近 3 条玩家消息做上下文
        const ctx = (G.pocketRoomMessages || [])
            .filter(m => m.isMe)
            .slice(-3)
            .map(m => m.text)
            .join(' ');
        for (let i = 0; i < count; i++) {
            let idx;
            do { idx = Math.floor(Math.random() * this.personas.length); } while (used.has(idx) && used.size < this.personas.length);
            used.add(idx);
            const p = this.personas[idx];
            const defaults = p.keywords.default;
            let text = defaults[Math.floor(Math.random() * defaults.length)];
            // 50% 概率把最近玩家话题塞进主动消息
            if (ctx && Math.random() < 0.5) {
                const topics = this.extractTopics(ctx);
                if (topics.length > 0) {
                    const t = topics[Math.floor(Math.random() * topics.length)];
                    // 只在 topic 长度 < 玩家原话 50% 时才注入
                    if (t.length < ctx.length * 0.5) {
                        text = `${t}！${text}`;
                    }
                }
            }
            msgs.push({
                sender: (p.prefix || '') + p.name,
                avatar: p.avatar,
                text,
                isMe: false,
                personaId: p.id,
                color: p.color
            });
        }
        return msgs;
    },

    // 计算延迟（毫秒）
    replyDelay(persona) {
        const d = persona.replyDelay;
        return d.min + Math.floor(Math.random() * (d.max - d.min));
    }
};


// ============ 存档管理 ============
App.Save = {
    autoSave() { localStorage.setItem('starlight48_save', JSON.stringify(G)); },
    load() {
        try {
            const d = localStorage.getItem('starlight48_save');
            if (d) Object.assign(G, JSON.parse(d));
            // 确保新字段有默认值
            if (!G.memberMemory) G.memberMemory = {};
            if (!G.memberEvents) G.memberEvents = [];
            if (!G.socialCircles) G.socialCircles = [];
            if (!G.memberRelationships) G.memberRelationships = {};
            if (!G.gossipLog) G.gossipLog = [];
            if (!G.diaryEntries) G.diaryEntries = {};
            if (!G.chatLeaks) G.chatLeaks = [];
            if (!G.proactiveMessages) G.proactiveMessages = [];
            if (!G.proactiveCooldown) G.proactiveCooldown = {};
            if (!G.settings) G.settings = { flipPrice: 0, flipPriceEnabled: false };
            else {
                if (typeof G.settings.flipPrice !== 'number') G.settings.flipPrice = 0;
                if (typeof G.settings.flipPriceEnabled !== 'boolean') G.settings.flipPriceEnabled = false;
            }
            if (!G.flipState || typeof G.flipState !== 'object') G.flipState = { day: G.game?.day || 1, replied: {} };
        } catch(e) {}
    },
    exportJSON() {
        const blob = new Blob([JSON.stringify(G,null,2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `starlight48_backup_${Date.now()}.json`;
        a.click();
        App.UI.showNotification('💾 存档已导出');
    },
    importJSON(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            try {
                const data = JSON.parse(e.target.result);
                Object.assign(G, data);
                this.autoSave();
                App.UI.showNotification('✅ 导入成功，即将刷新');
                setTimeout(() => location.reload(), 1000);
            } catch(ex) { App.UI.showNotification('❌ 无效文件'); }
        };
        reader.readAsText(file);
    },

    // ===== 云存档（增强版：超时、重试、详细错误） =====
    _cloudLastError: null,

    /** 上传存档到云端 */
    async cloudUpload() {
        const userId = App.Invite.getInviteCode() || 'anonymous';
        App.UI.showNotification('☁️ 正在上传存档...');
        try {
            const res = await App.Network.fetchWithRetry(`${App.Config.API_URL}/api/save/upload`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: userId,
                    saveData: G,
                    playerName: G.player?.name || '',
                    gameDay: G.game?.day || 1
                }),
                timeoutMs: 15000,
                retries: 2,
                backoffMs: 2000
            });

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.error('Cloud upload HTTP error:', res.status, errText.substring(0, 200));
                if (res.status === 429) {
                    App.UI.showNotification('⏳ 操作太频繁，请60秒后再试', 4000);
                } else if (res.status >= 500) {
                    App.UI.showNotification('⚠️ 云端服务异常，请稍后重试', 4000);
                } else {
                    App.UI.showNotification(`❌ 上传失败 (HTTP ${res.status})`, 3500);
                }
                return;
            }

            const data = await res.json();
            if (data.success) {
                localStorage.setItem('starlight48_cloud_time', data.saved_at);
                localStorage.setItem('starlight48_cloud_day', data.game_day || G.game.day);
                App.UI.showNotification('☁️ 存档已上传至云端');
                console.log('✅ 云存档上传成功: day', data.game_day);
            } else {
                App.UI.showNotification('❌ 上传失败: ' + (data.detail || data.message), 3500);
            }
        } catch (e) {
            const detail = this._classifyCloudError(e, '上传');
            console.error('Cloud upload failed:', detail, e);
            App.UI.showNotification(detail.userMsg, 4000);
        }
    },

    /** 从云端恢复存档 */
    async cloudDownload() {
        const userId = App.Invite.getInviteCode() || 'anonymous';
        App.UI.showNotification('☁️ 正在下载存档...');
        try {
            const res = await App.Network.fetchWithRetry(`${App.Config.API_URL}/api/save/download?userId=${encodeURIComponent(userId)}`, {
                timeoutMs: 15000,
                retries: 2,
                backoffMs: 2000
            });

            if (!res.ok) {
                if (res.status === 404) {
                    App.UI.showNotification('❌ 未找到云端存档', 3500);
                } else if (res.status === 429) {
                    App.UI.showNotification('⏳ 操作太频繁，请60秒后再试', 4000);
                } else {
                    App.UI.showNotification(`❌ 下载失败 (HTTP ${res.status})`, 3500);
                }
                return;
            }

            const data = await res.json();
            if (data.success && data.save_data) {
                Object.assign(G, data.save_data);
                this.autoSave();
                localStorage.setItem('starlight48_cloud_time', data.saved_at || new Date().toISOString());
                localStorage.setItem('starlight48_cloud_day', data.game_day || 1);
                App.UI.showNotification(`☁️ 云端存档已恢复 (第${data.game_day}天)`, 3000);
                setTimeout(() => location.reload(), 1200);
            } else {
                App.UI.showNotification('❌ 云端存档数据无效', 3500);
            }
        } catch (e) {
            const detail = this._classifyCloudError(e, '下载');
            console.error('Cloud download failed:', detail, e);
            App.UI.showNotification(detail.userMsg, 4000);
        }
    },

    /** 强制同步：多次重试，适合网络波动场景 */
    async cloudForceSync() {
        const userId = App.Invite.getInviteCode() || 'anonymous';
        App.UI.showNotification('⚡ 强制同步中...', 5000);

        let lastError = null;
        const maxAttempts = 5;
        const baseDelay = 1500;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                const delay = baseDelay * Math.pow(1.5, attempt);
                App.UI.showNotification(`⚡ 同步重试 ${attempt}/${maxAttempts - 1}...`, 3000);
                await new Promise(r => setTimeout(r, delay));
            }

            try {
                const res = await App.Network.fetchWithRetry(`${App.Config.API_URL}/api/save/download?userId=${encodeURIComponent(userId)}`, {
                    timeoutMs: 20000,
                    retries: 0  // fetchWithRetry 内部不重试，由外层控制
                });

                if (!res.ok) {
                    if (res.status === 404) {
                        App.UI.showNotification('❌ 云端暂无存档，请先上传', 3500);
                        return { success: false, reason: 'no_save' };
                    }
                    lastError = `HTTP ${res.status}`;
                    continue;
                }

                const data = await res.json();
                if (data.success && data.save_data) {
                    Object.assign(G, data.save_data);
                    this.autoSave();
                    localStorage.setItem('starlight48_cloud_time', data.saved_at || new Date().toISOString());
                    localStorage.setItem('starlight48_cloud_day', data.game_day || 1);
                    App.UI.showNotification(`⚡ 强制同步成功！已恢复至第${data.game_day}天`, 3500);
                    setTimeout(() => location.reload(), 1200);
                    return { success: true, gameDay: data.game_day };
                }
                lastError = '数据无效';
                continue;
            } catch (e) {
                lastError = e.message || '网络错误';
                console.warn(`Force sync attempt ${attempt + 1}/${maxAttempts} failed:`, lastError);
            }
        }

        // 所有尝试均失败
        const detail = this._classifyCloudError(new Error(lastError || '未知'), '强制同步');
        App.UI.showNotification(`❌ 同步失败 (已重试${maxAttempts}次): ${detail.userMsg}`, 5000);
        return { success: false, reason: detail.tech };
    },

    /** 获取云端存档信息（含超时） */
    async cloudInfo() {
        const userId = App.Invite.getInviteCode() || 'anonymous';
        try {
            const res = await App.Network.fetchWithRetry(`${App.Config.API_URL}/api/save/info?userId=${encodeURIComponent(userId)}`, {
                timeoutMs: 8000,
                retries: 1,
                backoffMs: 1000
            });
            if (!res.ok) return { exists: false, message: `服务器错误 (${res.status})` };
            return await res.json();
        } catch (e) {
            console.warn('Cloud info fetch failed:', e.message);
            if (e.name === 'AbortError') {
                return { exists: false, message: '连接超时，云端不可达' };
            }
            return { exists: false, message: '网络未连接' };
        }
    },

    /** 删除云端存档 */
    async cloudDelete() {
        if (!confirm('确定删除云端存档？此操作不可恢复！')) return;
        const userId = App.Invite.getInviteCode() || 'anonymous';
        try {
            const res = await App.Network.fetchWithRetry(`${App.Config.API_URL}/api/save/delete?userId=${encodeURIComponent(userId)}`, {
                method: 'DELETE',
                timeoutMs: 10000,
                retries: 1,
                backoffMs: 1000
            });
            const data = await res.json();
            localStorage.removeItem('starlight48_cloud_time');
            localStorage.removeItem('starlight48_cloud_day');
            App.UI.showNotification(data.success ? '☁️ 云端存档已删除' : 'ℹ️ ' + data.message, 3000);
        } catch (e) {
            const detail = this._classifyCloudError(e, '删除');
            console.error('Cloud delete failed:', detail, e);
            App.UI.showNotification(detail.userMsg, 4000);
        }
    },

    /** 获取云端同步状态摘要 */
    getCloudStatus() {
        const cloudTime = localStorage.getItem('starlight48_cloud_time');
        const cloudDay = localStorage.getItem('starlight48_cloud_day');
        if (!cloudTime) return { synced: false, message: '从未同步' };
        const since = Date.now() - new Date(cloudTime).getTime();
        const hours = Math.floor(since / 3600000);
        const mins = Math.floor((since % 3600000) / 60000);
        let ago = hours > 0 ? `${hours}小时${mins}分钟前` : `${mins}分钟前`;
        if (hours > 72) ago = `${Math.floor(hours/24)}天前`;
        return {
            synced: true,
            lastSync: cloudTime,
            gameDay: parseInt(cloudDay) || 1,
            ago: ago
        };
    },

    /** 错误分类辅助方法 */
    _classifyCloudError(e, operation) {
        const msg = e.message || '';
        let tech = msg;
        let userMsg = `${operation}失败，请检查网络`;

        if (e.name === 'AbortError' || msg.includes('timeout') || msg.includes('超时')) {
            tech = '连接超时';
            userMsg = `⏱️ ${operation}超时，服务器响应过慢`;
        } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('fetch')) {
            tech = '网络不可达';
            userMsg = `🔌 无法连接服务器，请检查网络`;
        } else if (msg.includes('429')) {
            tech = '速率限制';
            userMsg = '⏳ 操作太频繁，请60秒后再试';
        } else if (msg.includes('500') || msg.includes('502') || msg.includes('503')) {
            tech = '服务端错误';
            userMsg = `⚠️ 云端服务异常，请稍后重试`;
        } else if (msg.includes('400')) {
            tech = '请求错误';
            userMsg = `❌ ${operation}失败：存档数据异常`;
        } else if (msg.includes('所有重试均失败')) {
            tech = '所有重试耗尽';
            userMsg = `🔁 ${operation}失败：已自动重试但仍无法连接`;
        }

        this._cloudLastError = { operation, tech, userMsg, time: Date.now(), raw: msg };
        return { tech, userMsg };
    },
};

// ============ 事件系统 ============
App.Events = {
    checkEvents() {
        const s = G.stats;
        if (s.popularity>=15 && !G.flags.hasFirstShow) { G.flags.hasFirstShow=true; this.showStory('firstShow'); }
        if (s.popularity>=40 && !G.flags.hasFirstElection) { G.flags.hasFirstElection=true; this.showStory('election'); }
        if (s.popularity>=60 && !G.flags.hasStalker) { G.flags.hasStalker=true; this.showStory('paparazzi'); }
        if (s.popularity>=70 && !G.flags.hasCenterBattle) { G.flags.hasCenterBattle=true; this.showStory('centerBattle'); }
        if (s.stress>=100 && !G.flags.hasCrisis) { G.flags.hasCrisis=true; this.showStory('crisis'); }
        if (s.mood<20 && !G.flags.hasEmo) { G.flags.hasEmo=true; this.showStory('emo'); }
    },
    showStory(type) {
        const ev = App.EventPool.story[type];
        if (ev) { ev.type = type; App.UI.showEventModal(ev); }
    },
    resolveStory(type, choiceIdx) {
        const ev = App.EventPool.story[type];
        if (ev && ev.effects[choiceIdx]) App.Store.updateStats(ev.effects[choiceIdx]);
        App.UI.closeEventModal();
    },
    showRandom() {
        const ev = pick(App.EventPool.random);
        App.UI.showEventModal({ icon:'🎯', title:ev.name, desc:ev.desc, choices:ev.choices, effects:ev.effects });
    },
    resolveRandom(choiceIdx, effects) {
        if (effects && effects[choiceIdx]) App.Store.updateStats(effects[choiceIdx]);
        App.UI.closeEventModal();
    },
    triggerTeamEvent() {
        if (Math.random() > 0.3) return;
        const grp = App.NPCData[G.player.group];
        if (!grp) return;
        const teammate = pick(grp.core);
        const ev = pick(App.EventPool.team);
        const desc = ev.desc.replace('{name}', teammate.name);
        if (G.chatHistory[teammate.name]) {
            G.chatHistory[teammate.name].messages.push({from:'npc', text:desc, time:getTimeStr()});
        }
    }
};

App.EventPool = {
    random: [
        { name:'练习室抢位置', desc:'练习室位置被占了', choices:['等一等再练','找别的地方练'], effects:[{stress:2},{stress:1,skill:1}] },
        { name:'粉丝塞信', desc:'下班路上被塞了一封信', choices:['开心收下','礼貌拒绝'], effects:[{mood:3,drumstick:5},{affection:1}] },
        { name:'路人认出你', desc:'便利店有人认出你了！', choices:['热情打招呼','微笑点头'], effects:[{popularity:2,mood:3},{popularity:1}] }
    ],
    story: {
        firstShow: { icon:'🎤', title:'第一次公演！', desc:'你的第一次公演就要来了！', choices:['全力以赴！','默默祈祷...'], effects:[{skill:5,popularity:3},{mood:3}] },
        election: { icon:'🏆', title:'总选举速报', desc:'你的排名出来了！', choices:['查看排名'], effects:[{popularity:5}] },
        paparazzi: { icon:'📸', title:'被狗仔跟拍了！', desc:'有狗仔拍到了私生活照！', choices:['发博澄清','让公司处理'], effects:[{scandal:10},{agent_satisfaction:3}] },
        centerBattle: { icon:'⭐', title:'C位争夺！', desc:'队伍要选C位了', choices:['积极争取','低调等待'], effects:[{popularity:5,stress:5},{popularity:1}] },
        crisis: { icon:'⚠️', title:'退团危机', desc:'压力太大...', choices:['坚持留下','休息一段时间'], effects:[{stress:-20,mood:10},{stress:-30,mood:5}] },
        emo: { icon:'🌙', title:'深夜emo...', desc:'夜深了', choices:['发条口袋房间','给挚友打电话'], effects:[{mood:5},{mood:15,affection:5}] }
    },
    team: [
        { type:'约饭', desc:'{name}约你去吃火锅', choices:['去！','不去'], effects:[{affection:5,mood:3},{affection:-2}] },
        { type:'倾诉', desc:'{name}向你吐槽经纪人', choices:['安慰她','敷衍'], effects:[{affection:5},{affection:-3}] }
    ]
};

// ============ 成员性格系统 ============
App.MemberPersonality = (() => {
    const personalities = [
        { id:'gentle', name:'温柔治愈', emoji:'🌸', desc:'善解人意，喜欢关心他人', traits:{ proactive:0.7, social:0.8, competitive:0.2, emotional:0.9 }, speakStyle:'温柔体贴' },
        { id:'tsundere', name:'傲娇女王', emoji:'👑', desc:'外表骄傲内心柔软', traits:{ proactive:0.5, social:0.4, competitive:0.8, emotional:0.6 }, speakStyle:'傲娇嘴硬' },
        { id:'genki', name:'元气少女', emoji:'⚡', desc:'永远精力充沛的开心果', traits:{ proactive:0.9, social:0.95, competitive:0.3, emotional:0.5 }, speakStyle:'活泼元气' },
        { id:'cool', name:'冰山美人', emoji:'❄️', desc:'话少但观察力敏锐', traits:{ proactive:0.2, social:0.15, competitive:0.6, emotional:0.1 }, speakStyle:'冷淡简洁' },
        { id:'bookworm', name:'文艺少女', emoji:'📚', desc:'爱思考的文艺青年', traits:{ proactive:0.4, social:0.5, competitive:0.2, emotional:0.7 }, speakStyle:'文艺诗意' },
        { id:'senpai', name:'可靠前辈', emoji:'🎓', desc:'经验丰富照顾后辈', traits:{ proactive:0.6, social:0.7, competitive:0.1, emotional:0.4 }, speakStyle:'稳重可靠' },
        { id:'lazy', name:'慵懒猫系', emoji:'🐱', desc:'随性自在的慵懒派', traits:{ proactive:0.3, social:0.5, competitive:0.1, emotional:0.4 }, speakStyle:'慵懒随性' }
    ];
    const fanAttitudes = ['business', 'natural', 'shy'];

    // 真实SNH48成员性格模板（基于公开形象）
    const snh48Templates = {
        // === Team SII ===
        '闫明筠': { pers:'senpai', fan:'business' },
        '刘增艳': { pers:'gentle', fan:'natural' },
        '田姝丽': { pers:'genki', fan:'natural' },
        '由淼':   { pers:'cool', fan:'shy' },
        '芦馨怡': { pers:'bookworm', fan:'natural' },
        '杨心渝': { pers:'genki', fan:'natural' },
        '周童玥': { pers:'tsundere', fan:'shy' },
        '张倩':   { pers:'gentle', fan:'business' },
        '张雷雷': { pers:'lazy', fan:'natural' },
        '蒋夏羽': { pers:'cool', fan:'shy' },
        '盛乐':   { pers:'genki', fan:'natural' },
        '武博涵': { pers:'bookworm', fan:'shy' },
        '曹可甜': { pers:'gentle', fan:'natural' },
        '刘诗彤': { pers:'bookworm', fan:'natural' },
        '柳雨呈': { pers:'gentle', fan:'shy' },
        '李婷':   { pers:'cool', fan:'business' },
        '刘婧阳': { pers:'tsundere', fan:'business' },
        '宁轲':   { pers:'senpai', fan:'business' },
        // === Team NII ===
        '胡晓慧': { pers:'gentle', fan:'natural' },
        '潘瑛琪': { pers:'cool', fan:'shy' },
        '青钰雯': { pers:'genki', fan:'natural' },
        '金莹玥': { pers:'tsundere', fan:'business' },
        '卢天惠': { pers:'genki', fan:'natural' },
        '柏欣妤': { pers:'tsundere', fan:'business' },
        '唐程成': { pers:'gentle', fan:'shy' },
        '叶凡':   { pers:'cool', fan:'natural' },
        '黄紫怡': { pers:'bookworm', fan:'natural' },
        '钟亚男': { pers:'gentle', fan:'business' },
        '李继醇': { pers:'lazy', fan:'natural' },
        '沈馨':   { pers:'gentle', fan:'shy' },
        '徐佳琳': { pers:'genki', fan:'natural' },
        '雷宇霄': { pers:'cool', fan:'business' },
        '杨秋野': { pers:'bookworm', fan:'shy' },
        '杨宇馨': { pers:'genki', fan:'natural' },
        '周湘':   { pers:'gentle', fan:'natural' },
        '朱怡欣': { pers:'tsundere', fan:'business' },
        '郑照暄': { pers:'senpai', fan:'business' },
        // === Team HII ===
        '蒋舒婷': { pers:'genki', fan:'natural' },
        '李佳恩': { pers:'gentle', fan:'natural' },
        '温若其': { pers:'bookworm', fan:'shy' },
        '尤可莹': { pers:'tsundere', fan:'business' },
        '梁怀方': { pers:'lazy', fan:'natural' },
        '陈俞希': { pers:'genki', fan:'natural' },
        '龚晨美': { pers:'gentle', fan:'shy' },
        '康楚翊': { pers:'cool', fan:'shy' },
        '阙佳慧': { pers:'bookworm', fan:'natural' },
        '覃柯蒙': { pers:'gentle', fan:'natural' },
        '应籽言': { pers:'tsundere', fan:'business' },
        '刘思雨': { pers:'cool', fan:'shy' },
        '陈嘉仪': { pers:'gentle', fan:'natural' },
        '郑柯炜': { pers:'senpai', fan:'business' },
        '谭思慧': { pers:'genki', fan:'natural' },
        '郭晓盈': { pers:'tsundere', fan:'natural' },
        '林舒晴': { pers:'bookworm', fan:'shy' },
        '王奕':   { pers:'cool', fan:'shy' },
        '沈梦瑶': { pers:'gentle', fan:'natural' },
        '费沁源': { pers:'genki', fan:'natural' },
        // === 核心成员 ===
        '宋昕冉': { pers:'tsundere', fan:'business' },
        // === GNZ48 ===
        '程戈':   { pers:'genki', fan:'natural' },
    };

    // 名字哈希备用（未在模板中的成员）
    const memberMap = {};
    const getFor = (name) => {
        if (memberMap[name]) return memberMap[name];
        const tmpl = snh48Templates[name];
        let pers, fanAtt;
        if (tmpl) {
            pers = personalities.find(p => p.id === tmpl.pers);
            fanAtt = tmpl.fan;
        } else {
            let hash = 0; for (let i=0;i<name.length;i++) hash = ((hash<<5)-hash)+name.charCodeAt(i);
            hash = Math.abs(hash);
            pers = personalities[hash % personalities.length];
            fanAtt = fanAttitudes[hash % 3];
        }
        const result = { ...pers, fanAttitude: fanAtt, energy: 50 + (name.length * 3) % 50, quirks: [] };
        memberMap[name] = result;
        return result;
    };

    return {
        list: personalities,
        getFor,
        getMemberMood(name) {
            const mem = G.memberMemory?.[name];
            if (!mem) return { level:'neutral', emoji:'😐', label:'普通' };
            const aff = G.memberAffection?.[name] || 50;
            if (aff >= 80) return { level:'adoring', emoji:'🥰', label:'崇拜' };
            if (aff >= 60) return { level:'friendly', emoji:'😊', label:'友好' };
            if (aff >= 40) return { level:'neutral', emoji:'😐', label:'普通' };
            if (aff >= 20) return { level:'cold', emoji:'😒', label:'冷淡' };
            return { level:'resentful', emoji:'😤', label:'不满' };
        }
    };
})();

// ============ 成员记忆系统 ============
App.MemberMemory = {
    initIfNeeded() {
        if (!G.memberMemory) G.memberMemory = {};
        if (!G.memberEvents) G.memberEvents = [];
    },
    record(name, eventType, detail) {
        this.initIfNeeded();
        if (!G.memberMemory[name]) G.memberMemory[name] = { totalInteractions:0, significantEvents:[], lastInteraction:0, mood:60 };
        G.memberMemory[name].totalInteractions++;
        G.memberMemory[name].lastInteraction = G.game.day;
        if (['gift','dinner','birthday','date','transfer','comfort','center_deny','center_give','partner_invite'].includes(eventType)) {
            G.memberMemory[name].significantEvents.push({ day:G.game.day, event:eventType, detail:detail||'' });
        }
    },
    getOpinion(name) {
        const mem = G.memberMemory?.[name];
        if (!mem) return 'neutral';
        const aff = G.memberAffection?.[name] || 50;
        if (aff >= 70) return 'favorable';
        if (aff >= 40) return 'neutral';
        return 'unfavorable';
    },
    getLastInteraction(name) { return G.memberMemory?.[name]?.lastInteraction || 0; },
    adjustMood(name, delta) {
        this.initIfNeeded();
        if (!G.memberMemory[name]) G.memberMemory[name] = { totalInteractions:0, significantEvents:[], lastInteraction:0, mood:60 };
        G.memberMemory[name].mood = Math.max(0, Math.min(100, (G.memberMemory[name].mood || 60) + delta));
    }
};

// ============ 关系网与社交动态 ============
App.SocialNetwork = {
    initIfNeeded() {
        if (!G.socialCircles) G.socialCircles = [];
        if (!G.memberRelationships) G.memberRelationships = {};
        if (!G.gossipLog) G.gossipLog = [];
        if (!G.diaryEntries) G.diaryEntries = {};
        if (!G.chatLeaks) G.chatLeaks = [];
    },
    buildCircles() {
        this.initIfNeeded();
        if (G.socialCircles.length > 0) return;
        const mList = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group);
        const shuffled = [...mList].sort(() => Math.random() - 0.5);
        const circles = [];
        for (let i = 0; i < shuffled.length; i += 4) {
            const members = shuffled.slice(i, Math.min(i + 4, shuffled.length));
            const types = ['👯‍♀️','💃','🎭','🌸','🍵','🎵','📸','🍰','💪','🎪'];
            circles.push({ name:`${members[0]?.name||'未知'}的小圈`, emoji:types[i%types.length], members: members.map(m => m.name) });
        }
        G.socialCircles = circles;
        // Build relationships
        for (let i=0;i<mList.length;i++) {
            for (let j=i+1;j<mList.length;j++) {
                const key = [mList[i].name, mList[j].name].sort().join('|||');
                if (!G.memberRelationships[key]) {
                    const r = Math.random();
                    G.memberRelationships[key] = {
                        type: r < 0.2 ? 'close' : r < 0.5 ? 'friend' : r < 0.7 ? 'neutral' : 'rival',
                        strength: Math.floor(Math.random() * 50) + 30
                    };
                }
            }
        }
    },
    getCircleFor(name) {
        return (G.socialCircles || []).find(c => c.members.includes(name));
    },
    getRelationship(a, b) {
        const key = [a, b].sort().join('|||');
        return G.memberRelationships?.[key] || { type:'neutral', strength:20 };
    },
    generateGossip() {
        if (!G.player.name) return null;
        const teammates = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group && m.team === G.player.team && m.name !== G.player.name);
        if (teammates.length < 2) return null;
        const [a, b] = [teammates[Math.floor(Math.random()*teammates.length)], teammates[Math.floor(Math.random()*teammates.length)]].sort(() => Math.random()-0.5);
        if (!a || !b || a.name === b.name) return null;
        const topics = [
            `你听说了吗？${G.player.name}最近好像...`, `${G.player.name}今天的表现...`, 
            `有人看到${G.player.name}和经纪人单独...`, `我听说${G.player.name}要...`
        ];
        const topic = topics[Math.floor(Math.random()*topics.length)];
        return { day:G.game.day, members:[a.name,b.name], topic, content:'', viewed:false };
    },
    addGossip(gossip) {
        this.initIfNeeded();
        G.gossipLog.push(gossip);
    }
};

// ============ 成员主动性系统 ============
App.Proactivity = {
    initIfNeeded() {
        if (!G.proactiveMessages) G.proactiveMessages = [];
        if (!G.proactiveCooldown) G.proactiveCooldown = {};
    },
    checkTrigger() {
        if (!G.player.name) return null;
        this.initIfNeeded();
        if (G.game.day <= 1) return null;
        const teammates = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group && m.team === G.player.team && m.name !== G.player.name);
        if (teammates.length === 0) return null;
        const member = teammates[Math.floor(Math.random()*teammates.length)];
        const pers = App.MemberPersonality.getFor(member.name);
        const cooldown = G.proactiveCooldown[member.name] || 0;
        if (G.game.day - cooldown < 3) return null;
        if (Math.random() > pers.traits.proactive * 0.3) return null;
        G.proactiveCooldown[member.name] = G.game.day;
        const mood = App.MemberPersonality.getMemberMood(member.name);
        const events = [
            { type:'request_style', text:`${member.name}: 我想尝试一种新的舞蹈风格，你觉得我适合什么风格？`, emoji:'💃' },
            { type:'request_partner', text:`${member.name}: 下次公演能和我搭档吗？我觉得我们配合会很棒！`, emoji:'🤝' },
            { type:'invite_dinner', text:`${member.name}: 今天训练完一起去吃好吃的吧！我知道一家超棒的店~`, emoji:'🍽️' },
            { type:'late_night_msg', text:`${member.name}: 睡不着...你在干嘛呀？`, emoji:'🌙' },
            { type:'training_encounter', text:`${member.name}: 咦？你也这么晚还在训练室？`, emoji:'💪' },
            { type:'seek_advice', text:`${member.name}: 我有件事想问问你的意见...`, emoji:'🤔' },
            { type:'share_worry', text:`${member.name}: 今天心情不太好，能陪我聊聊吗？`, emoji:'😢' }
        ];
        const event = events[Math.floor(Math.random()*events.length)];
        return { member:member.name, avatar:'👧', ...event, timestamp:Date.now(), responded:false };
    },
    respond(event, choice) {
        event.responded = true;
        const mem = G.memberAffection?.[event.member];
        switch(choice) {
            case 'positive':
                if (mem !== undefined) G.memberAffection[event.member] = Math.min(100, (mem||50) + 8);
                App.MemberMemory.record(event.member, 'positive_response', event.type);
                App.MemberMemory.adjustMood(event.member, 10);
                App.Store.updateStats({ mood: 3, affection: 2 });
                break;
            case 'neutral':
                if (mem !== undefined) G.memberAffection[event.member] = Math.min(100, (mem||50) + 2);
                App.MemberMemory.record(event.member, 'neutral_response', event.type);
                break;
            case 'negative':
                if (mem !== undefined) G.memberAffection[event.member] = Math.max(0, (mem||50) - 5);
                App.MemberMemory.record(event.member, 'negative_response', event.type);
                App.MemberMemory.adjustMood(event.member, -15);
                App.Store.updateStats({ mood: -2 });
                break;
        }
        App.Save.autoSave();
    }
};

// ============ 日记系统 ============
App.Diary = {
    initIfNeeded() {
        App.SocialNetwork.initIfNeeded();
    },
    async generateToday() {
        this.initIfNeeded();
        const teammates = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group && m.team === G.player.team);
        const targets = teammates;
        for (const m of targets) {
            if (!G.diaryEntries[m.name]) G.diaryEntries[m.name] = [];
            const todayEntries = G.diaryEntries[m.name].filter(e => e.day === G.game.day);
            if (todayEntries.length > 0) continue;
            const pers = App.MemberPersonality.getFor(m.name);
            const aff = G.memberAffection?.[m.name] || 50;
            const mem = G.memberMemory?.[m.name];
            const mood = App.MemberPersonality.getMemberMood(m.name);
            try {
                const prompt = `【角色】你是${m.name}，${G.player.group} Team ${m.team}的女性偶像成员。你的性格类型是"${pers.name}"（${pers.speakStyle}）${pers.emoji}。你在${G.player.group}的Team ${m.team}，和玩家${G.player.name}是同一个队伍的队友。今天是你偶像生涯的第${G.game.day}天。你对玩家${G.player.name}的好感度是${aff}/100(${mood.label})。

请用第一人称写一段50-80字的简短日记，记录今天的感受（可以是排练、和队友相处、或对${G.player.name}的真实想法）。保持你"${pers.speakStyle}"的说话语气。只输出日记内容，不要加任何说明或标记。`;
                const resp = await fetch(`${App.Config.API_URL}/api/chat`, {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({ npcId:pers.id, message:prompt, playerName:G.player.name, context:{ memberName:m.name, playerName:G.player.name, affection:aff } })
                });
                let text = '';
                if (resp.ok) {
                    const data = await resp.json();
                    text = data.reply || data.message || '';
                }
                G.diaryEntries[m.name].push({ day:G.game.day, content:text || `今天也是元气满满的一天！`, mood:mood.emoji, time:new Date().toISOString() });
                App.Save.autoSave();
            } catch(e) { /* 静默失败 */ }
        }
    },
    getEntries(name) {
        return (G.diaryEntries?.[name] || []).sort((a,b) => b.day - a.day);
    }
};

// ============ 私聊泄露系统 ============
App.ChatLeak = {
    initIfNeeded() {
        App.SocialNetwork.initIfNeeded();
    },
    checkTrigger() {
        if (!G.player.name || G.game.day <= 2) return null;
        if (Math.random() > 0.08) return null;
        this.initIfNeeded();
        const teammates = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group && m.team === G.player.team && m.name !== G.player.name);
        if (teammates.length < 2) return null;
        const shuffled = [...teammates].sort(() => Math.random()-0.5);
        const [a, b] = [shuffled[0], shuffled[1]];
        if (!a || !b) return null;
        const rel = App.SocialNetwork.getRelationship(a.name, b.name);
        const leakTypes = [
            { scene:'闲聊中', topic:`聊到了${G.player.name}的八卦`, tone:'gossip' },
            { scene:'深夜聊天', topic:`讨论对${G.player.name}的看法`, tone:'honest' },
            { scene:'训练间隙', topic:`偷偷议论${G.player.name}的表现`, tone:'evaluate' },
            { scene:'吃饭时', topic:`分享关于${G.player.name}的趣事`, tone:'funny' },
            { scene:'休息室', topic:`猜测${G.player.name}的私生活`, tone:'curious' }
        ];
        const leak = leakTypes[Math.floor(Math.random()*leakTypes.length)];
        return {
            day:G.game.day, members:[a.name,b.name], scene:leak.scene, topic:leak.topic,
            tone:leak.tone, content:'', viewed:false, timestamp:Date.now()
        };
    },
    async generateContent(leak) {
        try {
            const prompt = `你正在模拟48系偶像团体中两个成员的私聊对话。${leak.members[0]}和${leak.members[1]}正在${leak.scene}，${leak.topic}。请生成一段简洁有趣的对话(4-6句)，要有真实感。每个成员的角色性格随机但合理。输出格式:\n${leak.members[0]}: ...\n${leak.members[1]}: ...`;
            const resp = await fetch(`${App.Config.API_URL}/api/chat`, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({ npcId:'member', message:prompt, playerName:G.player.name })
            });
            if (resp.ok) {
                const data = await resp.json();
                leak.content = data.reply || '';
            }
        } catch(e) { leak.content = `${leak.members[0]}: 你听说了吗？\n${leak.members[1]}: 什么事？`; }
        return leak;
    }
};

// ============ 训练成长系统 V4 ============
App.Training = {
    // 技能树路线定义
    branches: {
        dance: {
            name: '💃 舞蹈', icon: '🩰',
            paths: {
                technique: { name: '技术流', desc: '精准到位，细节控', bonus:'skill+=3,popularity+=1', emoji:'🎯' },
                power:     { name: '力量型', desc: '爆发力强，舞台炸裂', bonus:'skill+=2,popularity+=2', emoji:'💥' },
                elegant:   { name: '优雅派', desc: '气质出众，圈粉利器', bonus:'popularity+=3,skill+=1', emoji:'🦢' }
            }
        },
        vocal: {
            name: '🎤 歌唱', icon: '🎵',
            paths: {
                technique: { name: '技术流', desc: '音准稳定，高音清澈', bonus:'skill+=3', emoji:'🎼' },
                emotional:  { name: '情感派', desc: '感染力强，打动人心', bonus:'skill+=2,popularity+=2', emoji:'💖' },
                unique:     { name: '辨识度', desc: '独特音色，过耳不忘', bonus:'popularity+=3,skill+=1', emoji:'🌟' }
            }
        },
        performance: {
            name: '🎭 表现力', icon: '✨',
            paths: {
                charismatic: { name: '镜头感', desc: 'C位气场，镜头焦点', bonus:'popularity+=3', emoji:'📸' },
                expressive:  { name: '表情管理', desc: '微表情丰富，直拍杀手', bonus:'skill+=2,popularity+=2', emoji:'😉' },
                storytelling:{ name: '叙事力', desc: '用舞蹈讲故事', bonus:'skill+=3,popularity+=1', emoji:'📖' }
            }
        },
        variety: {
            name: '📺 综艺', icon: '🎙️',
            paths: {
                witty:    { name: '接梗王', desc: '反应快，抛接自如', bonus:'popularity+=3', emoji:'💡' },
                natural:  { name: '天然呆', desc: '呆萌属性，反差吸粉', bonus:'popularity+=2,skill+=1', emoji:'😳' },
                leader:   { name: '控场型', desc: '组织能力强，MC利器', bonus:'popularity+=2,skill+=2', emoji:'🎤' }
            }
        }
    },

    // 身体/心态非线性波动算法
    calcFluctuation(baseValue, fatigue, trainingIntensity) {
        // 疲劳度越高，训练效果越差（非线性衰减）
        const fatiguePenalty = 1 - Math.pow(fatigue / 100, 1.5);
        // 训练强度带来的增益（0-1）
        const intensityGain = trainingIntensity * 0.3;
        // 基础恢复率（非线性：低疲劳时恢复快，高疲劳时恢复慢）
        const recoveryRate = fatigue < 30 ? 0.15 : 
                             fatigue < 60 ? 0.08 : 
                             fatigue < 85 ? 0.03 : 0.01;
        return {
            skillGain: Math.round(intensityGain * fatiguePenalty * 5 + randInt(0, 3)),
            fatigueCost: Math.round(trainingIntensity * (8 + fatigue * 0.3)),
            injuryRisk: fatigue > 70 ? (fatigue - 70) * 0.8 : 0, // 百分比
            recovery: Math.round(recoveryRate * 100) / 100
        };
    },

    // 主训练方法
    train(branchId, intensity) {
        if (!G.stats) return null;
        const branch = this.branches[branchId];
        if (!branch) return null;

        // 确定当前路线（如果未选择则自动选第一个）
        if (!G.trainingTree) G.trainingTree = {};
        if (!G.trainingTree[branchId]) {
            G.trainingTree[branchId] = { path: Object.keys(branch.paths)[0], unlocks: [] };
        }
        if (!G.trainingSkills) G.trainingSkills = { dance:10, vocal:10, performance:10, variety:5 };
        if (G.physical === undefined) G.physical = 80;
        if (G.mental === undefined) G.mental = 75;
        if (G.fatigue === undefined) G.fatigue = 0;

        const intensityLevels = { light: 0.3, normal: 0.6, heavy: 1.0, extreme: 1.5 };
        const intensityVal = intensityLevels[intensity] || 0.6;

        const fluct = this.calcFluctuation(G.trainingSkills[branchId], G.fatigue, intensityVal);

        // 检查伤病风险
        let injury = false;
        if (Math.random() * 100 < fluct.injuryRisk) {
            injury = true;
            G.physical = Math.max(0, G.physical - randInt(15, 30));
            G.mental = Math.max(0, G.mental - randInt(5, 15));
        }

        // 更新技能值
        G.trainingSkills[branchId] = Math.min(100, G.trainingSkills[branchId] + fluct.skillGain);

        // 更新身体/心态
        G.physical = Math.max(0, Math.min(100, G.physical - fluct.fatigueCost * 0.5));
        G.mental = Math.max(0, Math.min(100, G.mental - fluct.fatigueCost * 0.2));
        G.fatigue = Math.min(100, G.fatigue + fluct.fatigueCost);

        // 更新全局skill和mood
        App.Store.updateStats({
            skill: Math.round(fluct.skillGain * 0.3),
            mood: -Math.round(intensityVal * 3),
            stress: Math.round(intensityVal * 4),
            training: fluct.skillGain
        });

        return {
            branch: branchId,
            intensity,
            skillGain: fluct.skillGain,
            newSkillValue: G.trainingSkills[branchId],
            fatigue: G.fatigue,
            physical: G.physical,
            mental: G.mental,
            injury,
            injuryRisk: Math.round(fluct.injuryRisk)
        };
    },

    // 休息恢复
    rest(type) {
        const restTypes = {
            sleep:   { fatigue: -25, physical: +12, mental: +8,  desc: '好好睡一觉' },
            spa:     { fatigue: -35, physical: +18, mental: +12, desc: 'SPA放松身心', cost: 150 },
            game:    { fatigue: -15, physical: +3,  mental: +20, desc: '打游戏放松' },
            eat:     { fatigue: -10, physical: +15, mental: +5,  desc: '吃顿好的', cost: 60 },
            stroll:  { fatigue: -20, physical: +8,  mental: +15, desc: '公园散步' }
        };
        const r = restTypes[type];
        if (!r) return null;
        if (r.cost && (G.stats.wechatBalance || 0) < r.cost) return { blocked: true, need: r.cost };

        if (r.cost) { G.stats.wechatBalance -= r.cost; }
        G.fatigue = Math.max(0, G.fatigue + r.fatigue);
        G.physical = Math.min(100, G.physical + r.physical);
        G.mental = Math.min(100, G.mental + r.mental);
        App.Store.updateStats({ mood: 5, stress: -10 });
        App.Save.autoSave();
        return { type, desc: r.desc, fatigue: G.fatigue, physical: G.physical, mental: G.mental };
    },

    // 偷偷加练 → 偶遇AI成员
    secretTrain() {
        if (G.fatigue > 85) return { blocked: true, reason: '太累了，还是先休息吧…' };
        
        // 增加训练量和疲劳
        const gain = randInt(3, 8);
        const branches = ['dance','vocal','performance','variety'];
        const branch = pick(branches);
        G.trainingSkills[branch] = Math.min(100, (G.trainingSkills[branch] || 10) + gain);
        G.fatigue = Math.min(100, G.fatigue + randInt(15, 25));
        G.physical = Math.max(0, G.physical - randInt(5, 12));

        // 40%概率偶遇同样在加练的AI成员
        let encounter = null;
        if (Math.random() < 0.4) {
            const teammates = App.getTeamMates(G.player.group, G.player.team);
            if (teammates.length > 0) {
                const member = pick(teammates);
                const pers = App.MemberPersonality.getFor(member.name);
                const encounters = [
                    `你推开练习室的门，发现${member.name}也在！两人相视一笑，一起练到深夜。`,
                    `走廊尽头传来音乐声——${member.name}正对着镜子重复一个动作。看到你后，她不好意思地笑了。`,
                    `凌晨两点的练习室，你和${member.name}不期而遇。她递给你一瓶水："你也睡不着吗？"`,
                    `${member.name}从背后拍了拍你："我就知道你会来！"——你们默契地开始了合练。`
                ];
                if (!G.memberAffection[member.name]) G.memberAffection[member.name] = 50;
                G.memberAffection[member.name] = Math.min(100, G.memberAffection[member.name] + randInt(2, 5));
                App.MemberMemory.record(member.name, 'chat', '深夜一起加练');
                App.MemberMemory.adjustMood(member.name, 5);
                encounter = {
                    member: member.name,
                    emoji: pers.emoji,
                    text: pick(encounters),
                    affectionGain: 4
                };
            }
        }

        App.Store.updateStats({ skill: Math.round(gain * 0.4), stress: 8, mood: -3, training: gain });
        App.Save.autoSave();
        return { gain, branch, encounter, fatigue: G.fatigue };
    },

    // 获取训练建议
    getSuggestion() {
        const skills = G.trainingSkills || {};
        const lowest = Object.entries(skills).sort((a,b) => a[1]-b[1])[0];
        const physStatus = G.physical < 30 ? '需休息' : G.physical < 60 ? '适度训练' : '状态良好';
        const mentalStatus = G.mental < 30 ? '心态疲惫' : G.mental < 60 ? '需要调节' : '心态稳定';
        if (G.fatigue > 75) return { action: 'rest', msg: '疲劳值过高，建议先休息恢复！', risk: '继续训练容易受伤' };
        if (G.physical < 25) return { action: 'rest', msg: '身体状态很差，强烈建议休息！', risk: '伤病风险极高' };
        return { 
            action: 'train', 
            recommend: lowest[0], 
            recommendName: this.branches[lowest[0]]?.name || '训练',
            msg: `建议加强${this.branches[lowest[0]]?.name || ''}训练，当前水平最低`,
            physStatus, mentalStatus
        };
    }
};

// ============ 舞台体验系统 V4 ============
App.Stage = {
    // MC 话题库
    mcTopics: [
        { q:'最近有什么让你感动的事吗？', type:'warm' },
        { q:'如果有一天不做偶像了，会做什么？', type:'deep' },
        { q:'成员当中谁最有趣？为什么？', type:'fun' },
        { q:'最近一次哭是什么时候？', type:'emotional' },
        { q:'对十年后的自己说一句话吧！', type:'deep' },
        { q:'如果拥有超能力，想要什么能力？', type:'fun' },
        { q:'第一次见粉丝时的心情？', type:'warm' },
        { q:'最想对同期生说的话？', type:'emotional' },
        { q:'觉得自己的魅力点是什么？', type:'fun' },
        { q:'今天公演最难忘的瞬间？', type:'warm' },
        { q:'如果互换一天人生，想和谁换？', type:'fun' },
        { q:'目前为止最大的遗憾是什么？', type:'deep' }
    ],

    // AI成员MC回复库（按性格类型）
    mcReplies: {
        '元气少女': ['哈哈哈这个问题好有意思！我觉得是——（做可爱动作）我！','诶~真的要说吗？那我说个秘密哦…'],
        '温柔治愈': ['嗯…这个问题让我想到很多呢。其实最近有件事特别想和大家分享…','（微笑）我觉得每个人都很好呀，大家都很努力呢~'],
        '傲娇女王': ['哼，这种问题当然是——（停顿）开玩笑的啦！','这个问题嘛…（傲娇脸）不过我今天心情好，告诉大家吧~'],
        '冰山美人': ['……（认真思考）这个问题值得好好回答呢。','我倒是有个不同的角度…（酷酷地说完，观众尖叫）'],
        '文艺少女': ['（托腮）让我想想…这个问题很有诗意呢。','我想用一句话来回答——（文艺地说了一段话）'],
        '可靠前辈': ['作为前辈我得认真回答呢（笑）','嗯，说到这个我有很多经验可以分享~'],
        '慵懒猫系': ['诶~要说这个吗？好麻烦…（但还是认真回答了）','（伸懒腰）好吧，那就说说我的想法…']
    },

    // 站位竞争逻辑
    positionBattle(playerSkill, opponentSkill, popularity) {
        const playerScore = playerSkill * 0.5 + popularity * 0.3 + Math.random() * 20;
        const opponentScore = opponentSkill * 0.5 + 50 * 0.3 + Math.random() * 20;
        
        if (playerScore > opponentScore + 10) return { result:'win', margin:'large', position:'前排/C位候选' };
        if (playerScore > opponentScore + 3) return { result:'win', margin:'close', position:'前排' };
        if (playerScore > opponentScore - 3) return { result:'draw', margin:'tie', position:'并列' };
        if (playerScore > opponentScore - 10) return { result:'lose', margin:'close', position:'中排' };
        return { result:'lose', margin:'large', position:'后排' };
    },

    // 执行站位争夺
    competePosition(opponentName) {
        const pSkill = (G.trainingSkills?.dance || 10) + (G.trainingSkills?.performance || 10);
        const oPers = App.MemberPersonality.getFor(opponentName);
        const oSkill = 40 + oPers.traits.competitive * 30 + randInt(-10, 15);
        const pop = G.stats.popularity || 10;
        
        const battle = this.positionBattle(pSkill, oSkill, pop);
        
        let outcome = { opponent: opponentName, result: battle.result, position: battle.position };
        
        if (battle.result === 'win') {
            G.stats.popularity = Math.min(100, G.stats.popularity + randInt(1, 3));
            App.Store.updateStats({ popularity: randInt(1, 3), skill: 1, mood: 5 });
            if (!G.memberAffection[opponentName]) G.memberAffection[opponentName] = 50;
            if (battle.margin === 'large') {
                G.memberAffection[opponentName] = Math.max(0, G.memberAffection[opponentName] - randInt(2, 5));
                outcome.memberReaction = `${opponentName}虽然输了，但她真心为你高兴~`;
            } else {
                G.memberAffection[opponentName] = Math.min(100, G.memberAffection[opponentName] + randInt(1, 3));
                outcome.memberReaction = `${opponentName}说："下次一定赢回来！"——但看得出来她在笑。`;
            }
        } else if (battle.result === 'lose') {
            G.stats.mood = Math.max(0, G.stats.mood - randInt(3, 8));
            App.Store.updateStats({ mood: -randInt(3, 8), stress: 5 });
            if (!G.memberAffection[opponentName]) G.memberAffection[opponentName] = 50;
            if (battle.margin === 'large') {
                outcome.memberReaction = `${opponentName}轻松赢了，但她走过来拍拍你："一起加油！"`;
            } else {
                G.memberAffection[opponentName] = Math.min(100, G.memberAffection[opponentName] + randInt(2, 4));
                outcome.memberReaction = `${opponentName}险胜，她松了口气，和你相视而笑。`;
            }
        } else {
            outcome.memberReaction = '两人实力相当，不分伯仲！台下粉丝已经为了你们吵起来了~';
        }
        
        App.MemberMemory.record(opponentName, 'center_deny', '站位竞争');
        App.Save.autoSave();
        return outcome;
    },

    // MC环节动态对话
    mcSegment(topic, playerChoice, varietySkill) {
        const topicData = typeof topic === 'string' ? 
            this.mcTopics.find(t => t.q === topic) || { type:'fun' } : topic;
        
        // 根据综艺技能和选择质量评估效果
        const choiceQuality = { 
            witty: 0.9, heartfelt: 0.85, safe: 0.5, silly: 0.65, awkward: 0.2, cold: 0.05 
        };
        const quality = choiceQuality[playerChoice] || 0.5;
        const skillBonus = (varietySkill || G.trainingSkills?.variety || 5) / 100;
        const audienceScore = quality * 0.5 + skillBonus * 0.3 + Math.random() * 0.2;

        let outcome;
        if (audienceScore > 0.75) {
            outcome = { 
                result:'bigHit', 
                reaction:'🤣 全场爆笑！掌声雷动！',
                audience:'热烈欢呼',
                popularityGain: randInt(2, 5),
                desc: 'MC效果炸裂，观众席笑声不断，你成功控场！'
            };
        } else if (audienceScore > 0.5) {
            outcome = { 
                result:'warm', 
                reaction:'😊 观众反应不错，笑声阵阵',
                audience:'温暖掌声',
                popularityGain: randInt(0, 2),
                desc: 'MC表现中规中矩，观众反响良好。'
            };
        } else if (audienceScore > 0.3) {
            outcome = { 
                result:'mid', 
                reaction:'😐 气氛一般，有些观众在玩手机',
                audience:'稀稀拉拉的掌声',
                popularityGain: 0,
                desc: 'MC效果平平，但也不算翻车。'
            };
        } else {
            outcome = { 
                result:'cold', 
                reaction:'🥶 冷场了…空气突然安静',
                audience:'尴尬的沉默',
                popularityGain: -randInt(1, 3),
                stressGain: randInt(5, 12),
                desc: 'MC冷场了！台下有人在窃窃私语…需要尽快救场！'
            };
            G.stats.popularity = Math.max(0, G.stats.popularity - randInt(1, 3));
            App.Store.updateStats({ popularity: -randInt(1, 3), stress: randInt(5, 12), mood: -5 });
        }

        if (outcome.popularityGain > 0) {
            G.stats.popularity = Math.min(100, G.stats.popularity + outcome.popularityGain);
            App.Store.updateStats({ popularity: outcome.popularityGain, mood: 3 });
        }

        // AI成员的MC互动
        const allMembers = App.getAllMembers?.() || [];
        const teammates = allMembers.filter(m => m.group === G.player.group && m.team === G.player.team && !m.graduate && m.name !== G.player.name);
        const stageMember = teammates.length > 0 ? pick(teammates) : null;
        let memberReply = null;
        if (stageMember) {
            const pers = App.MemberPersonality.getFor(stageMember.name);
            const replies = this.mcReplies[pers.name] || this.mcReplies['温柔治愈'];
            memberReply = {
                name: stageMember.name,
                text: pick(replies),
                emoji: pers.emoji
            };
        }

        App.Save.autoSave();
        return { ...outcome, memberReply, topic: topicData?.q || topic };
    },

    // 搭档默契系统
    partnerSynergy: {
        // 计算搭档默契值
        calcSynergy(partnerName) {
            const aff = G.memberAffection?.[partnerName] || 50;
            const mem = G.memberMemory?.[partnerName];
            const events = mem?.significantEvents?.length || 0;
            const synergy = Math.min(100, aff * 0.5 + events * 5 + 
                (G.partnerSynergy?.[partnerName] || 0));
            return synergy;
        },

        // 搭档演出效果
        performWithPartner(partnerName, showType) {
            const synergy = this.calcSynergy(partnerName);
            const pers = App.MemberPersonality.getFor(partnerName);
            const partnerSkill = (G.trainingSkills?.performance || 10) * 0.3 + synergy * 0.4 + Math.random() * 30;
            
            // 不同性格组合的差异化效果
            const myPers = G.player.personality;
            const comboNames = {
                '元气少女_元气少女': { name:'双倍元气弹💥', bonus:15, desc:'活力四射！全场都跳起来了！' },
                '温柔治愈_温柔治愈': { name:'温暖盛宴🌸', bonus:10, desc:'观众被你们暖到落泪…' },
                '傲娇女王_傲娇女王': { name:'王者对决👑', bonus:18, desc:'两个傲娇碰撞出的火花太耀眼！' },
                '冰山美人_冰山美人': { name:'冰川世纪❄️', bonus:12, desc:'冷酷气场让观众窒息——然后疯狂尖叫！' },
                '温柔治愈_傲娇女王': { name:'反差萌杀💘', bonus:20, desc:'温柔和傲娇的反差效果拔群！' },
                '元气少女_冰山美人': { name:'冰火两重天🔥❄️', bonus:16, desc:'一动一静的完美配合！' },
                default: { name:'默契配合✨', bonus:8, desc:'两人配合默契，舞台效果不错！' }
            };
            
            const comboKey = `${myPers}_${pers.name}`;
            const revKey = `${pers.name}_${myPers}`;
            const combo = comboNames[comboKey] || comboNames[revKey] || comboNames.default;

            const totalScore = Math.round(partnerSkill + combo.bonus);
            let grade, rewards;
            if (totalScore > 85) { grade = 'S'; rewards = { popularity: randInt(3, 6), affection: randInt(3, 6) }; }
            else if (totalScore > 70) { grade = 'A'; rewards = { popularity: randInt(1, 3), affection: randInt(2, 4) }; }
            else if (totalScore > 50) { grade = 'B'; rewards = { popularity: 0, affection: randInt(1, 2) }; }
            else { grade = 'C'; rewards = { popularity: -1, affection: 0 }; }

            // 更新默契值
            if (!G.partnerSynergy) G.partnerSynergy = {};
            G.partnerSynergy[partnerName] = Math.min(100, synergy + randInt(2, 6));

            // 更新好感度
            if (!G.memberAffection[partnerName]) G.memberAffection[partnerName] = 50;
            G.memberAffection[partnerName] = Math.min(100, G.memberAffection[partnerName] + rewards.affection);
            if (rewards.popularity !== 0) {
                G.stats.popularity = Math.min(100, G.stats.popularity + rewards.popularity);
            }

            App.MemberMemory.record(partnerName, 'partner_invite', `${showType}舞台搭档`);
            App.Store.updateStats({ popularity: rewards.popularity, mood: 5 });
            App.Save.autoSave();

            if (!G.partnerShows) G.partnerShows = [];
            G.partnerShows.push({ partner: partnerName, showType, score: totalScore, grade, day: G.game.day });

            return {
                partner: partnerName,
                synergy: G.partnerSynergy[partnerName],
                score: totalScore,
                grade,
                combo: combo,
                rewards,
                pers
            };
        }
    }
};

// ============ 社交媒体系统 V4 ============
App.SocialMedia = {
    // 措辞风险词库
    riskWords: {
        high: [
            { word:'黑幕', penalty:'scandal+=10,popularity-=3', response:'粉丝质疑你影射行业潜规则' },
            { word:'讨厌', penalty:'popularity-=2', response:'被解读为针对某位成员' },
            { word:'烦死了', penalty:'popularity-=2,scandal+=5', response:'被批评为"偶像失格"' },
            { word:'恶心', penalty:'scandal+=8,popularity-=4', response:'引发大规模粉丝抗议' },
            { word:'垃圾', penalty:'popularity-=3', response:'被曲解为贬低同行' },
            { word:'凭什么', penalty:'scandal+=6,popularity-=2', response:'被质疑在抱怨资源分配' }
        ],
        medium: [
            { word:'累', penalty:'popularity-=1', response:'部分粉丝心疼，部分批评"矫情"' },
            { word:'不想', penalty:'popularity-=1', response:'被断章取义报道' },
            { word:'随便', penalty:'', response:'粉丝解读为态度敷衍' },
            { word:'呵呵', penalty:'', response:'被质疑在阴阳怪气' }
        ]
    },

    // 发布微博
    postWeibo(content, day) {
        if (!G.socialMediaPosts) G.socialMediaPosts = [];
        
        // 检测风险词
        let riskLevel = 'safe', riskDetail = '', penalty = {};
        for (const lvl of ['high','medium']) {
            for (const rw of this.riskWords[lvl]) {
                if (content.includes(rw.word)) {
                    riskLevel = lvl;
                    riskDetail = rw.response;
                    // 解析penalty
                    if (rw.penalty) {
                        rw.penalty.split(',').forEach(p => {
                            const [key, val] = p.split(/[+-]=/);
                            if (key && val) {
                                penalty[key.trim()] = parseInt((p.includes('-')?'-':'') + val);
                            }
                        });
                    }
                    break;
                }
            }
            if (riskLevel !== 'safe') break;
        }

        // 负面放大效应：措辞不当的连锁反应
        let backlash = null;
        if (riskLevel === 'high') {
            const amplify = randInt(2, 5);
            penalty.popularity = (penalty.popularity || 0) * amplify;
            penalty.scandal = (penalty.scandal || 0) * amplify;
            backlash = {
                type: 'backlash',
                desc: `你的发言引发热议，负面效应被放大${amplify}倍！热搜已安排…`,
                popularityLoss: Math.abs(penalty.popularity || 0),
                scandalGain: Math.abs(penalty.scandal || 0)
            };
        }

        // 应用惩罚
        Object.entries(penalty).forEach(([key, val]) => {
            if (key === 'popularity') G.stats.popularity = Math.max(0, G.stats.popularity + val);
            if (key === 'scandal') G.stats.scandal = Math.min(200, (G.stats.scandal || 0) + Math.abs(val));
            if (key === 'stress') G.stats.stress = Math.min(200, (G.stats.stress || 10) + Math.abs(val));
        });

        if (Object.keys(penalty).length > 0) {
            App.Store.updateStats(penalty);
        }

        const post = {
            day: day || G.game.day,
            content,
            riskLevel,
            riskDetail,
            likes: Math.max(0, randInt(50, 500) + (G.stats.popularity || 10) * 3 - (riskLevel === 'high' ? 200 : 0)),
            comments: randInt(5, 50),
            backlash,
            time: getTimeStr()
        };
        G.socialMediaPosts.push(post);
        App.Save.autoSave();
        return post;
    },

    // AI成员发布争议内容 → 玩家两难抉择
    controversyEvent() {
        const conts = [
            {
                member: null, // 动态分配
                content: '"有些前辈仗着资历就欺负新人呢…" 这条秒删的微博被截图了！',
                choiceA: { text:'公开力挺她', effect:'affection+8,popularity-2,scandal+3', desc:'够义气！但你也惹上了麻烦…' },
                choiceB: { text:'私下安慰但不公开站队', effect:'affection+2,popularity+0', desc:'明哲保身，理智的选择。' },
                choiceC: { text:'劝她道歉', effect:'affection-5,popularity+2', desc:'理性但可能伤了她的心…' }
            },
            {
                member: null,
                content: '"今天的粉丝握手会好累…有些人手好冰" ——争议发言引发粉丝不满！',
                choiceA: { text:'发微博帮她解释', effect:'affection+5,popularity-1', desc:'患难见真情！' },
                choiceB: { text:'保持沉默', effect:'affection-1,popularity+1', desc:'沉默是金，但可能会被误解…' },
                choiceC: { text:'在口袋房间里说"大家互相理解"', effect:'affection+3,popularity+3', desc:'高情商处理！但有点假…' }
            },
            {
                member: null,
                content: '"这次的C位…说实话我不服" ——深夜秒删但已被传播！',
                choiceA: { text:'私聊倾听她的烦恼', effect:'affection+10,popularity+0', desc:'成为她最信任的人！' },
                choiceB: { text:'建议她专注提升自己', effect:'affection+3,popularity+2', desc:'既是好友也是好前辈。' },
                choiceC: { text:'和她一起吐槽', effect:'affection+8,scandal+5', desc:'太爽了！但小心隔墙有耳…' }
            }
        ];

        // 分配一个同队AI成员
        const teammates = App.getTeamMates?.(G.player.group, G.player.team) || [];
        if (teammates.length < 1) return null;
        const cont = pick(conts);
        cont.member = pick(teammates).name;
        
        if (!G.controversyLog) G.controversyLog = [];
        G.controversyLog.push({ day: G.game.day, source: cont.member, resolved: false });
        return cont;
    },

    // 处理争议抉择
    resolveControversy(memberName, choiceKey, choiceData) {
        // 解析效果
        const effects = {};
        choiceData.effect.split(',').forEach(p => {
            const m = p.trim().match(/(\w+)([+-]\d+)/);
            if (m) effects[m[1]] = parseInt(m[2]);
        });

        // 应用效果
        if (effects.affection) {
            if (!G.memberAffection[memberName]) G.memberAffection[memberName] = 50;
            G.memberAffection[memberName] = clamp(
                G.memberAffection[memberName] + effects.affection, 0, 100
            );
        }
        if (effects.popularity) {
            G.stats.popularity = clamp(G.stats.popularity + effects.popularity, 0, 100);
        }
        if (effects.scandal) {
            G.stats.scandal = clamp((G.stats.scandal || 0) + effects.scandal, 0, 200);
        }

        App.MemberMemory.record(memberName, 'comfort', '争议事件');
        
        // 标记已解决
        if (G.controversyLog) {
            const log = G.controversyLog.find(l => l.source === memberName && !l.resolved);
            if (log) {
                log.resolved = true;
                log.choice = choiceKey;
                log.day = G.game.day;
            }
        }

        App.Store.updateStats({
            ...(effects.popularity ? { popularity: effects.popularity } : {}),
            ...(effects.scandal ? { scandal: effects.scandal } : {}),
            mood: effects.affection > 0 ? 5 : -3
        });
        App.Save.autoSave();
        return { effects, memberName };
    },

    // 无心之言上热搜 → 随机不可控事件
    randomTrending() {
        if (!G.trendingEvents) G.trendingEvents = [];
        
        const events = [
            {
                type: 'slipOfTongue',
                trigger: '你在握手会上随口说的一句话被粉丝录下来发到网上',
                title: '#成员发言争议#',
                severity: randInt(0, 10) > 5 ? 'major' : 'minor',
                effect() {
                    const popLoss = randInt(2, 8);
                    G.stats.popularity = Math.max(0, G.stats.popularity - popLoss);
                    G.stats.scandal = Math.min(200, (G.stats.scandal || 0) + randInt(3, 10));
                    return { popularity: -popLoss, scandal: randInt(3, 10) };
                }
            },
            {
                type: 'photoLeak',
                trigger: '你在练习室的素颜照被工作人员泄露',
                title: '#偶像真实面貌#',
                severity: 'neutral',
                effect() {
                    const change = randInt(-5, 8);
                    G.stats.popularity = clamp(G.stats.popularity + change, 0, 100);
                    return { popularity: change };
                }
            },
            {
                type: 'misunderstanding',
                trigger: '你在微博发了一个表情，被粉丝过度解读',
                title: '#xx表情门#',
                severity: 'major',
                effect() {
                    const popLoss = randInt(5, 12);
                    const scGain = randInt(5, 15);
                    G.stats.popularity = Math.max(0, G.stats.popularity - popLoss);
                    G.stats.scandal = Math.min(200, (G.stats.scandal || 0) + scGain);
                    return { popularity: -popLoss, scandal: scGain, stress: randInt(5, 15) };
                }
            },
            {
                type: 'viralPositive',
                trigger: '你在公演上的一个动作被做成gif，意外走红！',
                title: '#神级直拍#',
                severity: 'positive',
                effect() {
                    const popGain = randInt(3, 10);
                    G.stats.popularity = Math.min(100, G.stats.popularity + popGain);
                    return { popularity: popGain, mood: randInt(5, 10) };
                }
            },
            {
                type: 'fanWar',
                trigger: '你的粉丝和另一位成员粉丝在超话吵起来了',
                title: '#粉丝互撕#',
                severity: 'major',
                effect() {
                    const targets = (App.getTeamMates?.(G.player.group, G.player.team) || []).slice(0, 3);
                    const target = targets.length > 0 ? pick(targets).name : '其他成员';
                    const popLoss = randInt(2, 5);
                    G.stats.popularity = Math.max(0, G.stats.popularity - popLoss);
                    G.stats.scandal = Math.min(200, (G.stats.scandal || 0) + randInt(5, 15));
                    if (!G.memberAffection[target]) G.memberAffection[target] = 50;
                    G.memberAffection[target] = Math.max(0, G.memberAffection[target] - randInt(3, 8));
                    return { popularity: -popLoss, scandal: randInt(5, 15), stress: randInt(5, 10), target };
                }
            }
        ];

        const event = pick(events);
        const effects = event.effect();
        
        G.trendingEvents.push({
            day: G.game.day,
            type: event.type,
            title: event.title,
            trigger: event.trigger,
            severity: event.severity,
            effects,
            time: getTimeStr()
        });

        App.Store.updateStats({
            ...(effects.popularity ? { popularity: effects.popularity } : {}),
            ...(effects.scandal ? { scandal: effects.scandal } : {}),
            ...(effects.mood ? { mood: effects.mood } : {}),
            ...(effects.stress ? { stress: effects.stress } : {})
        });
        App.Save.autoSave();

        return { ...event, effects };
    },

    // 连锁反应：热搜引发后续事件
    chainReaction(lastTrending) {
        if (!lastTrending || lastTrending.severity !== 'major') return null;
        const chainEvents = [
            { 
                desc:'经纪人找你谈话，要求你注意言行', 
                effects: { agent_satisfaction: -randInt(5,15), stress: randInt(5,10) } 
            },
            { 
                desc:'粉丝团发布联合声明，要求公司澄清', 
                effects: { popularity: randInt(1,3), scandal: randInt(2,5) }
            },
            {
                desc:'被娱乐媒体约访，可以借此澄清',
                effects: { popularity: randInt(2,5), stress: randInt(3,8), scandal: -randInt(2,5) }
            }
        ];
        const chain = pick(chainEvents);
        Object.entries(chain.effects).forEach(([k,v]) => {
            if (k === 'agent_satisfaction') G.stats.agent_satisfaction = clamp((G.stats.agent_satisfaction||50) + v,0,100);
            if (k === 'popularity') G.stats.popularity = clamp(G.stats.popularity + v,0,100);
            if (k === 'scandal') G.stats.scandal = clamp((G.stats.scandal||0) + v,0,200);
            if (k === 'stress') G.stats.stress = clamp((G.stats.stress||10) + v,0,200);
        });
        App.Store.updateStats(chain.effects);
        App.Save.autoSave();
        return chain;
    }
};
App.UI = {
    currentPage: 'lockScreen',
    pwdInput: '',
    tempCreate: { name:'', appearance:'', personality:'', personalityEmoji:'', group:'', team:'', quizAnswers:[], quizScores:[] },
    quizQuestions: [],
    currentChatId: null,
    currentCallNpc: null,
    liveActive: false,
    activeCommentIdx: -1,
    roomReplyIdx: -1,
    roomReplySender: '',
    wechatTab: 'chat',
    _currentEvent: null,

    showPage(id) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
        this.currentPage = id;
    },
    goHome() {
        this.showPage('homeScreen');
        this.updateTimeBar();
        // 修复：仅在玩家已创建角色后才执行随机事件，避免初次进入主页时弹窗堆叠
        if (!G.player.name) {
            App.Sound.play('Click');
            return;
        }
        App.Store.updateStats({});
        App.SocialNetwork.initIfNeeded();
        if (Math.random() < 0.15) App.Events.showRandom();
        if (G.player.name) App.Events.triggerTeamEvent();
        if (G.player.name && Math.random() < 0.08) this.receiveRandomSms();
        if (G.player.name && Math.random() < 0.05) this.receiveRandomCall();
        // 成员主动性触发
        if (G.player.name && Math.random() < 0.12) {
            const event = App.Proactivity.checkTrigger();
            if (event) this.showProactiveEvent(event);
        }
        // 私聊泄露触发
        if (G.player.name && Math.random() < 0.06) {
            const leak = App.ChatLeak.checkTrigger();
            if (leak) this.showChatLeakNotification(leak);
        }
        // V4 社交媒体随机热搜事件 (6%)
        if (G.player.name && Math.random() < 0.06 && G.game.day > 3) {
            this.handleRandomTrending();
        }
        App.Sound.play('Click');
    },
    handleRandomTrending() {
        const event = App.SocialMedia.randomTrending();
        if (!event) return;
        this.showNotification(`🔥 ${event.title}：${event.trigger.substring(0,30)}…`, 5000);
        // 重度事件有连锁反应
        if (event.severity === 'major') {
            setTimeout(() => {
                const chain = App.SocialMedia.chainReaction(event);
                if (chain) this.showNotification(`🔄 ${chain.desc}`, 4000);
            }, 3000);
        }
    },
    openApp(app) {
        App.Sound.play('Click');
        switch(app) {
            case 'wechat': this.showPage('wechatPage'); this.renderWechatList(); break;
            case 'weibo': this.showPage('weiboPage'); this.renderWeibo(); break;
            case 'sms': this.showPage('smsPage'); this.renderSms(); break;
            case 'phone': this.showPage('callPage'); this.renderPhone(); break;
            case 'pocket': this.showPage('pocketPage'); this.renderPocketHome(); break;
            case 'profile': this.showPage('profilePage'); this.renderProfile(); break;
            case 'election': this.showPage('electionPage'); this.renderElection(); break;
            case 'affection': this.showPage('affectionPage'); this.renderAffection(); break;
            case 'settings': this.showPage('settingsPage'); this.renderSettings(); break;
            case 'handshake': this.showPage('handshakePage'); this.renderHandshake(); break;
            case 'outdoor': this.showPage('outdoorPage'); this.renderOutdoor(); break;
            case 'calendar': this.showPage('calendarPage'); this.renderCalendar(); break;
            case 'backpack': this.showPage('backpackPage'); this.renderBackpack(); break;
            case 'diary': this.showPage('diaryPage'); this.renderDiaryList(); break;
            case 'chatleak': this.showPage('chatLeakPage'); this.renderChatLeak(); break;
            case 'training': this.showPage('trainingPage'); this.renderTraining(); break;
            case 'stage': this.showPage('stagePage'); this.renderStage(); break;
        }
    },
    // 统一弹窗辅助：所有弹窗追加到phone-screen内（不超出手机边框）
    phoneModal(innerHTML, id) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.pointerEvents = 'auto';
        if (id) modal.id = id;
        modal.innerHTML = innerHTML;
        document.getElementById('phoneModals').appendChild(modal);
        // 追踪弹窗，保留关闭能力
        App.ModalManager.track(modal);
        return modal;
    },

    /** 关闭所有弹窗（兜底机制：清理遗留 modal，避免页面被拦截） */
    closeAllModals() {
        App.ModalManager.closeAll();
    },
    updateTimeBar() {
        const phaseNames = {morning:'🌅早晨',daytime:'☀️白天',evening:'🌆傍晚',night:'🌙夜晚'};
        const season = G.game.day <= 90 ? '🌸春季' : G.game.day <= 180 ? '☀️夏季' : G.game.day <= 270 ? '🍂秋季' : '❄️冬季';
        const el = document.getElementById('gameTimeBar');
        if (el) el.innerHTML = `Day ${G.game.day} · ${season} | ${phaseNames[G.game.phase]} | ${G.player.group} Team ${G.player.team}`;
    },
    advanceDay() {
        // 如果总选进行中但没有具体的选举阶段，重置状态以允许继续
        if (G.game.electionInProgress && !G.game.electionPhase) {
            G.game.electionInProgress = false;
        }
        
        if (G.game.electionInProgress) {
            this.showNotification('请先完成总选举相关活动！');
            return;
        }
        
        G.game.day += 1;
        G.game.phase = 'morning';
        G.game.handshake_this_month = false;

        // 翻牌每日重置：清空当日已翻牌状态
        if (G.flipState) G.flipState = { day: G.game.day, replied: {} };

        this.updateTimeBar();
        App.Save.autoSave();
        this.showNotification(`⏰ 进入第${G.game.day}天`);
        
        // 首日构建社交圈
        if (G.game.day === 2) App.SocialNetwork.buildCircles();
        // 每日生成日记
        if (G.game.day > 1) App.Diary.generateToday();
        
        const dayInMonth = G.game.day % 30 || 30;
        
        if (dayInMonth === 10 && !G.game.electionPhase) {
            this.showElectionReportModal('first');
        } else if (dayInMonth === 20 && G.game.electionPhase === 'first') {
            this.showElectionReportModal('second');
        } else if (dayInMonth === 30) {
            this.showElectionModal();
        }
        
        if (document.getElementById('calendarPage').classList.contains('active')) {
            this.renderCalendar();
        }
    },
    showElectionModal() {
        G.game.electionInProgress = true;
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = `
            display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,0.7)
        `;
        modal.innerHTML = `
            <div style="background:#fff;border-radius:20px;padding:30px;width:100%;max-width:320px;text-align:center">
                <div style="font-size:64px;margin-bottom:16px">🏆</div>
                <div style="font-size:24px;font-weight:bold;color:#333;margin-bottom:8px">总选举最终结果</div>
                <div style="font-size:14px;color:#666;margin-bottom:24px">第 ${G.game.day} 天，总选举正式开始！</div>
                <button onclick="App.UI.startFinalElection();this.closest('.modal-overlay').remove()" 
                        style="width:100%;padding:16px;background:linear-gradient(135deg,#ffd700,#ff9500);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:bold;cursor:pointer">
                    📣 查看最终排名
                </button>
            </div>
        `;
        document.getElementById('phoneModals').appendChild(modal);
        modal.addEventListener('click', (e) => { if(e.target === modal) this.showElectionModal(); });
    },
    showElectionReportModal(type) {
        G.game.electionInProgress = true;
        const isFirst = type === 'first';
        const title = isFirst ? '📊 初报结果' : '📈 中报结果';
        const subtitle = isFirst ? '第10天' : '第20天';
        const pullsLeft = isFirst ? 3 - G.game.firstReportPulls : 3 - G.game.secondReportPulls;
        
        const votes = this.calculateVotes();
        const allMembers = App.getAllMembers().filter(m => !m.graduate);
        let rankings = allMembers.map(m => ({ name: m.name, votes: randInt(500, 30000) }));
        rankings.push({ name: G.player.name, votes: votes });
        rankings.sort((a, b) => b.votes - a.votes);
        const rank = rankings.findIndex(r => r.name === G.player.name) + 1;
        
        if (isFirst) {
            G.game.firstReportVotes = votes;
        } else {
            G.game.secondReportVotes = votes;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = `
            display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.7)
        `;
        modal.innerHTML = `
            <div style="background:#fff;border-radius:16px;padding:20px;width:calc(100% - 32px);max-width:340px;box-sizing:border-box">
                <div style="text-align:center;margin-bottom:16px">
                    <div style="font-size:40px;margin-bottom:8px">${isFirst ? '📊' : '📈'}</div>
                    <div style="font-size:18px;font-weight:bold;color:#333">${title}</div>
                    <div style="font-size:12px;color:#999">${subtitle}</div>
                </div>
                
                <div style="background:linear-gradient(135deg,#ffd700,#ff9500);color:#fff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px">
                    <div style="font-size:11px;opacity:0.9">当前排名</div>
                    <div style="font-size:36px;font-weight:bold">#${rank}</div>
                    <div style="font-size:12px;margin-top:2px">${votes.toLocaleString()} 票</div>
                </div>
                
                <div style="padding:0 4px;margin-bottom:12px">
                    <div style="font-size:11px;color:#999;margin-bottom:6px">📊 排名前5</div>
                    ${rankings.slice(0,5).map((r, i) => `
                        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f0f0f0">
                            <span style="font-weight:600;font-size:12px">${i+1}. ${r.name}</span>
                            <span style="color:#ff69b4;font-size:12px">${r.votes.toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
                
                <div style="text-align:center;margin-bottom:12px">
                    <span style="font-size:12px;color:#666">剩余拉票次数：</span>
                    <span style="font-size:18px;font-weight:bold;color:#ff69b4">${pullsLeft}</span>
                </div>
                
                <div style="display:flex;gap:8px">
                    <button onclick="App.UI.endElectionReport('${type}')" 
                            style="flex:1;padding:10px;border:none;background:#f5f5f5;border-radius:8px;font-size:13px;cursor:pointer">
                        关闭
                    </button>
                    ${pullsLeft > 0 ? `
                        <button onclick="App.UI.pullVotes('${type}')" 
                                style="flex:1;padding:10px;border:none;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">
                            📣 拉票
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        document.getElementById('phoneModals').appendChild(modal);
    },
    calculateVotes() {
        // 人气值决定票数：1人气 = 1000票
        // 基础公式：票数 = 人气 * 1000
        const baseVotes = Math.floor(G.stats.popularity * 1000);
        
        // 人气满100获得第一名加成
        let championBonus = 0;
        if (G.stats.popularity >= 100) {
            championBonus = 50000;  // 满100人气获得额外加成，确保第一名
        }
        
        // 鸡腿和星光作为额外加成
        const drumstickBonus = Math.floor(G.stats.drumstick / 10);
        const starlightBonus = Math.floor(G.stats.starlight * 50);
        
        return baseVotes + drumstickBonus + starlightBonus + championBonus;
    },
    pullVotes(type) {
        const isFirst = type === 'first';
        if (isFirst && G.game.firstReportPulls >= 3) return;
        if (!isFirst && G.game.secondReportPulls >= 3) return;
        
        if (isFirst) {
            G.game.firstReportPulls++;
        } else {
            G.game.secondReportPulls++;
        }
        
        // 人气值越高，拉票效果越好
        // 基础范围 5-12，根据人气值增加上限
        const baseMin = 5;
        const baseMax = 12;
        
        // 根据人气值提升拉票效果
        let bonus = 0;
        if (G.stats.popularity >= 80) bonus = 10;  // 顶流明星：拉票效果+10
        else if (G.stats.popularity >= 60) bonus = 6;   // 人气偶像：拉票效果+6
        else if (G.stats.popularity >= 40) bonus = 4;   // 小有名气：拉票效果+4
        else if (G.stats.popularity >= 20) bonus = 2;   // 崭露头角：拉票效果+2
        
        const popularityGain = Math.floor(Math.random() * (baseMax + bonus - baseMin + 1)) + baseMin;
        App.Store.updateStats({popularity: popularityGain});
        
        document.querySelector('.modal-overlay')?.remove();
        this.showNotification(`📣 拉票成功！人气 +${popularityGain}`);
        
        setTimeout(() => {
            this.showElectionReportModal(type);
        }, 500);
    },
    endElectionReport(type) {
        document.querySelector('.modal-overlay')?.remove();
        G.game.electionInProgress = false;
        if (type === 'first') {
            G.game.electionPhase = 'first';
        } else {
            G.game.electionPhase = 'second';
        }
    },
    startFinalElection() {
        const votes = this.calculateVotes();  // 使用统一的计算方法
        const allMembers = App.getAllMembers().filter(m => !m.graduate);
        let rankings = allMembers.map(m => ({ name: m.name, votes: randInt(1000, 50000) }));
        rankings.push({ name: G.player.name, votes: votes });
        rankings.sort((a, b) => b.votes - a.votes);
        G.electionResults = rankings;
        G.game.rank = rankings.findIndex(r => r.name === G.player.name) + 1;
        G.game.electionInProgress = false;
        G.game.electionPhase = null;
        G.game.firstReportPulls = 0;
        G.game.secondReportPulls = 0;
        
        this.showNotification(`🎉 总选举完成！你获得 ${votes.toLocaleString()} 票，排名第 ${G.game.rank} 名`);
        App.Store.updateStats({popularity: 5});
        
        setTimeout(() => {
            this.openApp('election');
        }, 500);
    },
    renderCalendar() {
        const phaseNames = {morning:'🌅早晨',daytime:'☀️白天',evening:'🌆傍晚',night:'🌙夜晚'};
        const season = G.game.day <= 90 ? '🌸春季' : G.game.day <= 180 ? '☀️夏季' : G.game.day <= 270 ? '🍂秋季' : '❄️冬季';
        const month = Math.ceil(G.game.day / 30);
        const daysInMonth = 30;
        const firstDay = 1;
        
        let calendarHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;padding:8px">`;
        const weekDays = ['日','一','二','三','四','五','六'];
        weekDays.forEach(d => calendarHTML += `<div style="text-align:center;font-size:12px;color:#999;padding:6px">${d}</div>`);
        
        for (let i=0;i<firstDay;i++) calendarHTML += `<div></div>`;
        for (let d=1;d<=daysInMonth;d++) {
            const isToday = d === ((G.game.day - 1) % 30) + 1;
            calendarHTML += `<div style="text-align:center;padding:8px;border-radius:8px;${isToday?'background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;font-weight:bold':''}">${d}</div>`;
        }
        calendarHTML += `</div>`;
        
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">日程</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            <div style="background:linear-gradient(135deg,#ff69b4,#ff1493);border-radius:16px;padding:20px;color:#fff;margin-bottom:16px">
                <div style="font-size:24px;font-weight:bold;margin-bottom:4px">第 ${G.game.day} 天</div>
                <div style="font-size:16px">${season} | ${phaseNames[G.game.phase]}</div>
                <div style="font-size:12px;opacity:0.8;margin-top:4px">${G.player.group} Team ${G.player.team}</div>
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#333">📅 本月日历</div>
                ${calendarHTML}
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:#333">⏰ 时间控制</div>
                <button onclick="App.UI.advanceDay()" style="width:100%;padding:16px;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border:none;border-radius:12px;font-size:16px;font-weight:bold;cursor:pointer">
                    ▶ 进入下一天
                </button>
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:12px;color:#333">📊 今日状态</div>
                <div style="display:flex;gap:12px;font-size:13px">
                    <div style="flex:1;text-align:center;padding:12px;background:#f5f5f5;border-radius:8px">
                        <div style="font-size:20px;font-weight:bold;color:#3498db">${G.stats.stress}</div>
                        <div style="color:#999">压力</div>
                    </div>
                    <div style="flex:1;text-align:center;padding:12px;background:#f5f5f5;border-radius:8px">
                        <div style="font-size:20px;font-weight:bold;color:#27ae60">${G.stats.mood}</div>
                        <div style="color:#999">心情</div>
                    </div>
                    <div style="flex:1;text-align:center;padding:12px;background:#f5f5f5;border-radius:8px">
                        <div style="font-size:20px;font-weight:bold;color:#f39c12">${G.stats.popularity}</div>
                        <div style="color:#999">人气</div>
                    </div>
                </div>
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:16px;margin-top:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:#333">💡 提示</div>
                <div style="font-size:13px;color:#666;line-height:1.6">
                    • 每30天会进行一次总选举<br>
                    • 每30天会有握手会活动<br>
                    • 点击上方按钮可手动推进时间
                </div>
            </div>
        </div>`;
        
        document.getElementById('calendarPage').innerHTML = h;
    },
    renderBackpack() {
        const backpack = G.stats.backpack || {};
        const items = Object.entries(backpack).filter(([_, count]) => count > 0);
        const giftItems = [
            {id:'chocolate', name:'🍫 巧克力', price:50, desc:'甜蜜小礼物', effect:{affection:3}},
            {id:'flower', name:'🌸 鲜花', price:80, desc:'浪漫之选', effect:{affection:5}},
            {id:'perfume', name:'🌷 香水', price:300, desc:'优雅芬芳', effect:{affection:8}},
            {id:'cake', name:'🎂 蛋糕', price:200, desc:'甜蜜惊喜', effect:{affection:6,mood:3}},
            {id:'bear', name:'🧸 玩偶', price:150, desc:'可爱陪伴', effect:{affection:5}},
            {id:'jewelry', name:'💎 首饰', price:800, desc:'璀璨夺目', effect:{affection:12}},
            {id:'watch', name:'⌚ 手表', price:1200, desc:'珍惜时间', effect:{affection:15}},
            {id:'bag', name:'👜 名牌包', price:1500, desc:'奢华之选', effect:{affection:18}},
            {id:'concert_ticket', name:'🎫 演唱会门票', price:500, desc:'专属邀请', effect:{affection:10,mood:5}},
            {id:'dinner', name:'🍽️ 豪华晚餐', price:800, desc:'共进美食', effect:{affection:12,mood:8}},
            {id:'phone', name:'📱 最新手机', price:3000, desc:'科技潮品', effect:{affection:25}},
            {id:'photobook', name:'📖 定制写真集', price:600, desc:'珍藏回忆', effect:{affection:10,popularity:5}},
            {id:'stuffed_animal', name:'🐰 巨型公仔', price:400, desc:'少女心爆棚', effect:{affection:8}},
            {id:'scarf', name:'🧣 品牌围巾', price:350, desc:'温暖呵护', effect:{affection:7}},
            {id:'lipstick', name:'💄 限定口红', price:280, desc:'美妆必备', effect:{affection:6}},
            {id:'tea_set', name:'🍵 精致茶具', price:450, desc:'文雅之礼', effect:{affection:8}},
            {id:'leather_jacket', name:'🧥 皮衣', price:2500, desc:'帅气有型', effect:{affection:22}},
            {id:'purse', name:'👛 钱包', price:600, desc:'实用之选', effect:{affection:9}},
            {id:'headphones', name:'🎧 耳机', price:450, desc:'音乐之享', effect:{affection:7}},
            {id:'crown', name:'👑 王冠', price:5000, desc:'至高荣耀', effect:{affection:40,popularity:10}},
        ];
        
        let itemsHtml = '';
        if (items.length === 0) {
            itemsHtml = '<div style="text-align:center;color:#999;padding:40px">背包空空如也</div>';
        } else {
            itemsHtml = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px">';
            items.forEach(([id, count]) => {
                const gift = giftItems.find(g => g.id === id);
                if (gift) {
                    itemsHtml += `<div style="background:#fff;border-radius:12px;padding:16px;text-align:center">
                        <div style="font-size:32px;margin-bottom:8px">${gift.name.split(' ')[0]}</div>
                        <div style="font-size:13px;font-weight:600">${gift.name.split(' ')[1]}</div>
                        <div style="font-size:12px;color:#999">x${count}</div>
                    </div>`;
                }
            });
            itemsHtml += '</div>';
        }
        
        let shopHtml = `<div style="padding:16px"><div style="font-size:14px;font-weight:600;margin-bottom:12px">🛒 礼物商店</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">`;
        giftItems.forEach(gift => {
            const effectText = [];
            if (gift.effect?.affection) effectText.push(`💕+${gift.effect.affection}`);
            if (gift.effect?.mood) effectText.push(`😊+${gift.effect.mood}`);
            if (gift.effect?.popularity) effectText.push(`⭐+${gift.effect.popularity}`);
            shopHtml += `<div style="background:#fff;padding:12px;border-radius:8px;display:flex;flex-direction:column">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                    <span style="font-size:24px">${gift.name.split(' ')[0]}</span>
                    <div>
                        <div style="font-size:13px;font-weight:600">${gift.name.split(' ')[1]}</div>
                        <div style="font-size:10px;color:#999">${gift.desc}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <div>
                        <span style="font-size:12px;color:#e74c3c;font-weight:600">¥${gift.price}</span>
                        <span style="font-size:10px;color:#07c160;margin-left:4px">${effectText.join(' ')}</span>
                    </div>
                    <button onclick="App.UI.buyGift('${gift.id}')" style="padding:4px 12px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer">购买</button>
                </div>
            </div>`;
        });
        shopHtml += '</div></div>';
        
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🎒 背包</span></div>
        <div style="flex:1;overflow-y:auto">
            <div style="background:linear-gradient(135deg,#8b4513,#a0522d);color:#fff;padding:20px;border-radius:16px;margin:16px;text-align:center">
                <div style="font-size:14px;margin-bottom:8px">💰 微信支付余额</div>
                <div style="font-size:28px;font-weight:700">¥${(G.stats.wechatBalance||0).toLocaleString()}</div>
            </div>
            
            <div style="background:#fff;margin:0 16px;border-radius:12px;padding:12px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:8px">📦 我的物品</div>
                ${itemsHtml}
            </div>
            
            ${shopHtml}
        </div>`;
        
        document.getElementById('backpackPage').innerHTML = h;
    },
    buyGift(type) {
        const giftItems = [
            {id:'chocolate', name:'🍫 巧克力', price:50, desc:'甜蜜小礼物', effect:{affection:3}},
            {id:'flower', name:'🌸 鲜花', price:80, desc:'浪漫之选', effect:{affection:5}},
            {id:'perfume', name:'🌷 香水', price:300, desc:'优雅芬芳', effect:{affection:8}},
            {id:'cake', name:'🎂 蛋糕', price:200, desc:'甜蜜惊喜', effect:{affection:6,mood:3}},
            {id:'bear', name:'🧸 玩偶', price:150, desc:'可爱陪伴', effect:{affection:5}},
            {id:'jewelry', name:'💎 首饰', price:800, desc:'璀璨夺目', effect:{affection:12}},
            {id:'watch', name:'⌚ 手表', price:1200, desc:'珍惜时间', effect:{affection:15}},
            {id:'bag', name:'👜 名牌包', price:1500, desc:'奢华之选', effect:{affection:18}},
            {id:'concert_ticket', name:'🎫 演唱会门票', price:500, desc:'专属邀请', effect:{affection:10,mood:5}},
            {id:'dinner', name:'🍽️ 豪华晚餐', price:800, desc:'共进美食', effect:{affection:12,mood:8}},
            {id:'phone', name:'📱 最新手机', price:3000, desc:'科技潮品', effect:{affection:25}},
            {id:'photobook', name:'📖 定制写真集', price:600, desc:'珍藏回忆', effect:{affection:10,popularity:5}},
            {id:'stuffed_animal', name:'🐰 巨型公仔', price:400, desc:'少女心爆棚', effect:{affection:8}},
            {id:'scarf', name:'🧣 品牌围巾', price:350, desc:'温暖呵护', effect:{affection:7}},
            {id:'lipstick', name:'💄 限定口红', price:280, desc:'美妆必备', effect:{affection:6}},
            {id:'tea_set', name:'🍵 精致茶具', price:450, desc:'文雅之礼', effect:{affection:8}},
            {id:'leather_jacket', name:'🧥 皮衣', price:2500, desc:'帅气有型', effect:{affection:22}},
            {id:'purse', name:'👛 钱包', price:600, desc:'实用之选', effect:{affection:9}},
            {id:'headphones', name:'🎧 耳机', price:450, desc:'音乐之享', effect:{affection:7}},
            {id:'crown', name:'👑 王冠', price:5000, desc:'至高荣耀', effect:{affection:40,popularity:10}},
        ];
        const gift = giftItems.find(g => g.id === type);
        if (!gift) return;
        if (G.stats.wechatBalance < gift.price) { this.showNotification('余额不足'); return; }
        App.Store.updateStats({wechatBalance:-gift.price});
        G.stats.backpack = G.stats.backpack || {};
        G.stats.backpack[type] = (G.stats.backpack[type] || 0) + 1;
        this.showNotification(`购买成功！${gift.name}已放入背包`);
        this.renderBackpack();
    },
    showNotification(msg, durationMs) {
        const el = document.getElementById('notification');
        el.textContent = msg; el.classList.add('show');
        App.Sound.play('Notif');
        const dur = durationMs || (msg.startsWith('❌') || msg.startsWith('⚠️') || msg.startsWith('🔌') || msg.startsWith('⏱️') ? 3500 : 2000);
        setTimeout(() => el.classList.remove('show'), dur);
    },
    showStatChange(text) {
        const el = document.getElementById('statChange');
        el.textContent = text; el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },
    showEventModal(ev) {
        const card = document.getElementById('eventCard');
        const effects = ev.effects || [];
        let choicesHtml = ev.choices.map((c,i) =>
            `<div class="event-choice" onclick="App.UI.resolveEvent('${ev.type||'random'}',${i})">${c}</div>`
        ).join('');
        card.innerHTML = `<div class="event-icon">${ev.icon||'🎯'}</div><div class="event-title">${ev.title}</div><div class="event-desc">${ev.desc}</div><div class="event-choices">${choicesHtml}</div>`;
        document.getElementById('eventModal').classList.add('show');
        this._currentEvent = ev;
        App.Sound.play('Notif');
    },
    resolveEvent(type, choiceIdx) {
        document.getElementById('eventModal').classList.remove('show');
        if (type === 'random') {
            const ev = this._currentEvent;
            if (ev && ev.effects[choiceIdx]) App.Store.updateStats(ev.effects[choiceIdx]);
        } else {
            App.Events.resolveStory(type, choiceIdx);
        }
        this._currentEvent = null;
    },
    closeEventModal() { document.getElementById('eventModal').classList.remove('show'); this._currentEvent = null; },

    // ---------- 锁屏/密码 ----------
    showPasswordScreen() {
        this.showPage('passwordScreen'); this.pwdInput = ''; this.updateDots();
        document.getElementById('passwordError').textContent = '';
    },
    updateDots() {
        for (let i=0;i<4;i++) {
            const dot = document.getElementById('dot'+i);
            if (dot) dot.classList.toggle('filled', i < this.pwdInput.length);
        }
    },
    enterPassword(d) {
        if (this.pwdInput.length >= 4) return;
        this.pwdInput += d; this.updateDots();
        if (this.pwdInput.length === 4) {
            if (this.pwdInput === '0814') {
                this.pwdInput = ''; this.updateDots();
                document.getElementById('passwordError').textContent = '';
                if (G.player.name) {
                    document.getElementById('bottomNav').style.display = '';
                    this.goHome();
                } else {
                    this.showPage('createScreen'); this.renderCreateStep(1);
                }
            } else {
                document.getElementById('passwordError').textContent = '密码错误';
                this.pwdInput = ''; this.updateDots();
            }
        }
    },
    clearPwd() { this.pwdInput = ''; this.updateDots(); },
    backspacePwd() { this.pwdInput = this.pwdInput.slice(0,-1); this.updateDots(); },

    // ---------- 角色创建 ----------
    renderCreateStep(step) {
        const container = document.getElementById('createContent');
        let html = '';
        if (step === 1) {
            html = `<div class="create-step active"><div class="create-emoji">🎤</div><div class="create-title">你的艺名是什么？</div><input class="create-input" id="inputName" placeholder="输入你的艺名" maxlength="10"><button class="create-btn" onclick="App.UI.nextCreateStep(1)">下一步</button></div>`;
        } else if (step === 2) {
            html = `<div class="create-step active"><div class="create-emoji">💫</div><div class="create-title">描述一下你的外貌</div><input class="create-input" id="inputAppearance" placeholder="如：黑色长发、大眼睛、甜美气质" maxlength="30"><button class="create-btn" onclick="App.UI.nextCreateStep(2)">下一步</button></div>`;
        } else if (step === 3) {
            html = `<div class="create-step active"><div class="create-emoji">🎭</div><div class="create-title">你的性格底色是？</div><div class="create-options">
                <div class="create-option" onclick="App.UI.selectOption(this,'personality','温柔细腻','🌸')"><span class="emoji">🌸</span>温柔细腻</div>
                <div class="create-option" onclick="App.UI.selectOption(this,'personality','热血直率','🔥')"><span class="emoji">🔥</span>热血直率</div>
                <div class="create-option" onclick="App.UI.selectOption(this,'personality','内敛高冷','🌙')"><span class="emoji">🌙</span>内敛高冷</div>
                <div class="create-option" onclick="App.UI.selectOption(this,'personality','古灵精怪','✨')"><span class="emoji">✨</span>古灵精怪</div>
            </div><button class="create-btn" onclick="App.UI.nextCreateStep(3)">下一步</button></div>`;
        } else if (step === 4) {
            html = `<div class="create-step active"><div class="create-emoji">🏢</div><div class="create-title">选择你的分团</div><div class="create-options">`;
            const groups = {SNH48:'🏙️',GNZ48:'🌺',BEJ48:'🏛️',CKG48:'🌶️',CGT48:'🐼'};
            Object.entries(groups).forEach(([key,emoji]) => {
                html += `<div class="create-option" onclick="App.UI.selectOption(this,'group','${key}','${emoji}')"><span class="emoji">${emoji}</span>${key}</div>`;
            });
            html += `</div><button class="create-btn" onclick="App.UI.nextCreateStep(4)">下一步</button></div>`;
        } else if (step === 5) {
            // 生成问答
            this.quizQuestions = this.generateQuiz();
            html = `<div class="create-step active"><div class="create-emoji">🎲</div><div class="create-title">随机问答分队</div><div id="quizArea" style="max-height:360px;overflow-y:auto;width:100%;-webkit-overflow-scrolling:touch">`;
            this.quizQuestions.forEach((q,qi) => {
                html += `<div style="margin-bottom:16px;text-align:left"><div style="font-size:14px;font-weight:600;margin-bottom:8px">${qi+1}. ${q.q}</div>`;
                q.opts.forEach((o,oi) => {
                    html += `<div class="quiz-option" onclick="App.UI.selectQuiz(this,${qi},${oi})">${o}</div>`;
                });
                html += `</div>`;
            });
            html += `</div><button class="create-btn" onclick="App.UI.nextCreateStep(5)" style="margin-top:12px">确认作答</button></div>`;
        } else if (step === 6) {
            // 分配队伍（使用分队算法）
            this.tempCreate.team = assignTeam(this.tempCreate.personality, this.tempCreate.group, this.tempCreate.quizScores || this.tempCreate.quizAnswers);
            html = `<div class="create-step active"><div class="create-emoji">✨</div><div class="create-title">确认你的档案</div><div class="profile-card"><div class="profile-header"><div class="profile-avatar">🎤</div><div><div class="profile-name">${this.tempCreate.name}</div><div class="profile-team">${this.tempCreate.group} Team ${this.tempCreate.team}</div></div></div><div class="profile-info">外貌：${this.tempCreate.appearance}<br>性格：${this.tempCreate.personalityEmoji} ${this.tempCreate.personality}</div></div><input class="create-input" id="inputBoot" placeholder="输入「开机」启动游戏" style="margin-top:16px"><button class="create-btn" onclick="App.UI.startGame()" style="margin-top:12px">🚀 启动</button><div style="font-size:11px;color:#bbb;margin-top:8px">在输入框中输入"开机"后点击启动按钮</div></div>`;
        }
        container.innerHTML = html;
    },
    selectOption(el, field, value, emoji) {
        el.parentElement.querySelectorAll('.create-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        this.tempCreate[field] = value;
        if (field === 'personality' && emoji) this.tempCreate.personalityEmoji = emoji;
        if (field === 'group' && emoji) this.tempCreate.groupEmoji = emoji;
    },
    generateQuiz() {
        const pool = [
            {q:'公演前2小时，你会？',opts:['A. 默默背歌词和走位','B. 跟队友互相打气嗨起来','C. 一个人安静地冥想','D. 偷偷给粉丝准备小惊喜'],scores:[1,2,3,4]},
            {q:'粉丝送了你超贵的礼物，你会？',opts:['A. 礼貌收下并真诚道谢','B. 开心得当场发朋友圈','C. 冷静让经纪人处理','D. 灵机一动跟粉丝开个玩笑'],scores:[1,2,3,4]},
            {q:'队友突然哭了你怎么办？',opts:['A. 默默递上纸巾陪着她','B. 冲过去一把抱住说别哭啦','C. 假装没看到给她空间','D. 搞怪逗她笑'],scores:[1,2,3,4]},
            {q:'上台前发现服装坏了，你会？',opts:['A. 轻声告诉工作人员','B. 大喊"快帮我看看！"','C. 自己尝试修补','D. 笑着说这是特别设计'],scores:[1,2,3,4]},
            {q:'被问到敏感问题时，你会？',opts:['A. 温柔委婉地回答','B. 直接说出自己的想法','C. 保持沉默或转移话题','D. 用幽默化解尴尬'],scores:[1,2,3,4]},
            {q:'休息日你更想做什么？',opts:['A. 在家看书听音乐','B. 和朋友出去逛街','C. 一个人看电影','D. 尝试新的冒险活动'],scores:[1,2,3,4]},
            {q:'收到差评时，你会？',opts:['A. 认真反思并改进','B. 发微博反驳回去','C. 默默承受不回应','D. 开玩笑说谢谢建议'],scores:[1,2,3,4]},
            {q:'团队聚餐时你通常是？',opts:['A. 贴心照顾每个人','B. 活跃气氛的开心果','C. 安静吃东西的观察者','D. 讲段子逗大家笑'],scores:[1,2,3,4]}
        ];
        const shuffled = [...pool].sort(()=>Math.random()-0.5);
        return shuffled.slice(0, 5);
    },
    selectQuiz(el, qi, oi) {
        el.parentElement.querySelectorAll('.quiz-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        this.tempCreate.quizAnswers[qi] = oi;
        if (!this.tempCreate.quizScores) this.tempCreate.quizScores = [];
        this.tempCreate.quizScores[qi] = this.quizQuestions[qi].scores[oi];
    },
    nextCreateStep(step) {
        if (step === 1) {
            const name = document.getElementById('inputName')?.value.trim();
            if (!name) { this.showNotification('请输入艺名'); return; }
            this.tempCreate.name = name;
            this.renderCreateStep(2);
        } else if (step === 2) {
            const app = document.getElementById('inputAppearance')?.value.trim();
            if (!app) { this.showNotification('请描述外貌'); return; }
            this.tempCreate.appearance = app;
            this.renderCreateStep(3);
        } else if (step === 3) {
            if (!this.tempCreate.personality) { this.showNotification('请选择性格'); return; }
            this.renderCreateStep(4);
        } else if (step === 4) {
            if (!this.tempCreate.group) { this.showNotification('请选择分团'); return; }
            this.renderCreateStep(5);
        } else if (step === 5) {
            if (!this.tempCreate.quizAnswers || this.tempCreate.quizAnswers.length !== this.quizQuestions.length || this.tempCreate.quizAnswers.some(a => a === undefined)) {
                this.showNotification('请回答所有问题'); return;
            }
            this.renderCreateStep(6);
        }
    },
    startGame() {
        const boot = document.getElementById('inputBoot')?.value.trim();
        if (boot !== '开机') { this.showNotification('请输入「开机」启动游戏'); return; }
        G.player.name = this.tempCreate.name;
        G.player.appearance = this.tempCreate.appearance;
        G.player.personality = this.tempCreate.personality;
        G.player.personalityEmoji = this.tempCreate.personalityEmoji;
        G.player.group = this.tempCreate.group;
        G.player.team = this.tempCreate.team;
        this.initChatHistory();
        this.initSmsMessages();
        document.getElementById('createScreen').classList.remove('active');
        document.getElementById('bottomNav').style.display = '';
        this.goHome();
        this.showNotification('欢迎，'+G.player.name+'！你的偶像之路开始了！');
        App.Save.autoSave();
    },

    // ---------- 微信 ----------
    initSmsMessages() {
        const smsTypes = [
            { from:'私生粉', avatar:'👁️', text:'我知道你住哪里，今天看到你进小区了~', type:'stalker' },
            { from:'黑粉', avatar:'💀', text:'你这种人也能出道？笑死人了', type:'hater' },
            { from:'狂热粉', avatar:'🔥', text:'姐姐！！我太爱你了！！今天握手会见到你了好激动啊啊啊！！', type:'fanatic' },
            { from:'广告推销', avatar:'📢', text:'【星耀传媒】诚邀您参加年度盛典，回复1确认参加', type:'ad' }
        ];
        G.smsMessages = [pick(smsTypes)];
    },
    receiveRandomSms() {
        const smsPool = [
            { from:'私生粉', avatar:'👁️', text:'你今天穿的蓝色外套很好看，我拍下来了', type:'stalker' },
            { from:'私生粉', avatar:'👁️', text:'你经常去的那家咖啡店，我也去了，可惜没遇到你', type:'stalker' },
            { from:'私生粉', avatar:'👁️', text:'你的手机号是怎么泄露的呢？嘿嘿', type:'stalker' },
            { from:'黑粉', avatar:'💀', text:'听说你又垫底了？笑死', type:'hater' },
            { from:'黑粉', avatar:'💀', text:'你那点实力也配站C位？', type:'hater' },
            { from:'黑粉', avatar:'💀', text:'赶紧退团吧，别丢人了', type:'hater' },
            { from:'狂热粉', avatar:'🔥', text:'姐姐！！你的新公演太棒了！！我看了三遍！！', type:'fanatic' },
            { from:'狂热粉', avatar:'🔥', text:'我把你的海报贴满了房间！！你是我的光！！', type:'fanatic' },
            { from:'狂热粉', avatar:'🔥', text:'今天握手会你看了我一眼！！我要幸福晕了！！', type:'fanatic' },
            { from:'狂热粉', avatar:'🔥', text:'姐姐的每一场公演我都会去的！！鸡腿已安排！！', type:'fanatic' },
            { from:'广告推销', avatar:'📢', text:'【美妆品牌】邀请您代言新品口红，有意向请联系', type:'ad' },
            { from:'广告推销', avatar:'📢', text:'【综艺邀请】《偶像的日常》节目组邀请您参加录制', type:'ad' },
            { from:'广告推销', avatar:'📢', text:'【杂志拍摄】时尚杂志邀请您拍摄封面，酬劳丰厚', type:'ad' },
            { from:'经纪人', avatar:'👔', text:'明天有行程安排，记得早起', type:'agent' },
            { from:'经纪人', avatar:'👔', text:'公司要给你安排新通告，准备一下', type:'agent' },
            { from:'粉丝', avatar:'🧸', text:'姐姐加油！我会一直支持你的！', type:'fan' },
            { from:'粉丝', avatar:'🧸', text:'今天的公演超棒！期待下次见面！', type:'fan' }
        ];
        const newSms = pick(smsPool);
        G.smsMessages.unshift(newSms);
        this.showSmsPopup(newSms);
        return newSms;
    },
    showSmsPopup(sms) {
        const container = document.getElementById('phoneNotifContainer');
        if (!container) return;
        const notif = document.createElement('div');
        notif.className = 'phone-notif-item';
        notif.innerHTML = `<div class="phone-notif-icon">${sms.avatar}</div><div class="phone-notif-body"><div class="phone-notif-app">短信</div><div class="phone-notif-title">${sms.from}</div><div class="phone-notif-text">${sms.text}</div></div><div class="phone-notif-close">✕</div>`;
        container.appendChild(notif);
        setTimeout(() => notif.classList.add('show'), 10);
        const autoRemove = setTimeout(() => {
            notif.classList.remove('show');
            setTimeout(() => notif.remove(), 350);
        }, 5000);
        const closeBtn = notif.querySelector('.phone-notif-close');
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); clearTimeout(autoRemove); notif.remove(); });
        let startY = 0, currentY = 0, isDragging = false;
        notif.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; isDragging = true; notif.classList.add('swiping'); });
        notif.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            if (diff < 0) { notif.style.transform = `translateY(${diff}px)`; notif.style.opacity = Math.max(0, 1 + diff / 100); }
        });
        notif.addEventListener('touchend', () => {
            isDragging = false;
            notif.classList.remove('swiping');
            const diff = currentY - startY;
            if (diff < -50) { clearTimeout(autoRemove); notif.remove(); }
            else { notif.style.transform = ''; notif.style.opacity = ''; }
        });
        App.Sound.play('Notif');
    },
    initChatHistory() {
        const grp = App.NPCData[G.player.group];
        if (!grp) return;
        G.chatHistory = {};
        
        // 添加经纪人
        G.chatHistory[grp.agent.name] = { type:'agent', personality:grp.agent.personality, avatar:grp.agent.avatar, messages:[{from:'npc',text:'欢迎加入团队！',time:getTimeStr()}] };
        
        // 添加玩家所在队伍的成员
        const myTeamMembers = grp.teams && grp.teams[G.player.team] ? grp.teams[G.player.team] : [];
        myTeamMembers.forEach(memberName => {
            if (!G.chatHistory[memberName]) {
                G.chatHistory[memberName] = { 
                    type:'member', 
                    avatar:'👤', 
                    messages:[{from:'npc',text:`你好！我是${G.player.group} Team ${G.player.team}的${memberName}，以后就是队友啦～`,time:getTimeStr()}] 
                };
            }
        });
        
        // 添加工作组群
        G.chatHistory['📋工作组'] = { type:'group', avatar:'📋', messages:[{from:'npc',text:`${grp.agent.name}：欢迎新成员加入！`,time:getTimeStr()}] };
        
        // 添加本队群
        G.chatHistory['💬 Team '+G.player.team+'群'] = { type:'teamgroup', avatar:'💬', messages:[{from:'npc',text:`欢迎新队友！`,time:getTimeStr()}] };
    },
    renderWechatList() {
        const el = document.getElementById('wechatPage');
        el.innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">微信</span><span class="action" onclick="App.UI.showWechatMoments()">朋友圈</span></div>
        <div class="wechat-tab-bar"><div class="wechat-tab active" id="wtab_chat" onclick="App.UI.switchWechatTab('chat')">聊天</div><div class="wechat-tab" id="wtab_contacts" onclick="App.UI.switchWechatTab('contacts')">通讯录</div></div>
        <div id="wechatList" style="flex:1;overflow-y:auto"></div>`;
        this.populateWechatList('chat');
    },
    switchWechatTab(tab) {
        this.wechatTab = tab;
        document.getElementById('wtab_chat').classList.toggle('active', tab==='chat');
        document.getElementById('wtab_contacts').classList.toggle('active', tab==='contacts');
        this.populateWechatList(tab);
    },
    populateWechatList(tab) {
        const listEl = document.getElementById('wechatList');
        const grp = App.NPCData[G.player.group];
        const myTeam = G.player.team;
        const myTeamMembers = myTeam && grp?.teams?.[myTeam] ? grp.teams[myTeam] : [];

        if (tab === 'chat') {
            let h = '';
            const chatAllowed = [grp?.agent?.name].filter(Boolean);
            if (grp?.core) chatAllowed.push(...grp.core.map(c => c.name));
            if (myTeam) chatAllowed.push(...myTeamMembers);

            for (let [name, data] of Object.entries(G.chatHistory)) {
                if (!chatAllowed.includes(name)) continue;
                const last = data.messages[data.messages.length-1];
                h += `<div class="chat-item" onclick="App.UI.openWechatChat('${name}')"><div class="avatar" style="background:#f0f0f0">${data.avatar}</div><div class="info"><div class="name">${name}</div><div class="preview">${last?last.text:''}</div></div><div class="time-stamp">${last?last.time:''}</div></div>`;
            }
            listEl.innerHTML = h || '<div class="empty-hint">暂无消息</div>';
        } else {
            let h = '';

            // 荣誉毕业生板块（放在最前面）
            const honoraryGraduates = [
                '鞠婧祎', '李艺彤', '孙芮', '袁一琦',
                '陈观慧', '陈思', '戴萌', '孔肖吟', '李宇琪', '莫寒', '钱蓓婷', '邱欣怡', '吴哲晗', '徐晨辰', '许佳琪', '张语格',
                '陆婷', '林思意', '赵粤', '蒋芸', '许杨玉琢', '张昕', '王晓佳', '姜杉', '段艺璇',
                '农燕萍', '龙亦瑞', '张笑盈', '韩家乐', '赵天杨', '沈小爱'
            ];
            h += `<div class="contact-group-title" style="background:linear-gradient(135deg,#ffd700,#ffec8b);color:#8b4513">🏆 荣誉毕业生</div>`;
            h += `<div style="font-size:12px;color:#b8860b;padding:8px 16px 4px;font-weight:600">⭐ 传奇偶像</div>`;
            honoraryGraduates.forEach(name => {
                const aff = G.memberAffection[name]||0;
                let nameColor = '#666';
                let nameWeight = 'normal';
                if (aff >= 80) { nameColor = '#e91e63'; nameWeight = 'bold'; }
                else if (aff >= 50) { nameColor = '#ff69b4'; }
                else if (aff >= 30) { nameColor = '#999'; }
                else { nameColor = '#bbb'; }
                h += `<div class="contact-item" onclick="App.UI.startChatWithMember('${name}','honorary')"><div class="avatar">🏆</div><div class="info"><div class="name" style="color:${nameColor};font-weight:${nameWeight}">${name}</div></div></div>`;
            });

            // 各分团成员
            Object.entries(App.NPCData).forEach(([groupKey, groupData]) => {
                const isMyGroup = groupKey === G.player.group;
                h += `<div class="contact-group-title">🏢 ${groupKey}${isMyGroup?' (我的分团)':''}</div>`;

                if (groupData.teams) {
                    Object.entries(groupData.teams).forEach(([teamName, members]) => {
                        const isMyTeam = isMyGroup && teamName === myTeam;
                        h += `<div style="font-size:12px;color:${isMyTeam?'#07c160':'#ff69b4'};padding:8px 16px 4px;font-weight:600">Team ${teamName}${isMyTeam?' ★':''}</div>`;
                        members.forEach(name => {
                            const aff = G.memberAffection[name]||0;
                            let nameColor = '#666';
                            let nameWeight = 'normal';
                            if (aff >= 80) { nameColor = '#e91e63'; nameWeight = 'bold'; }
                            else if (aff >= 50) { nameColor = '#ff69b4'; }
                            else if (aff >= 30) { nameColor = '#999'; }
                            else { nameColor = '#bbb'; }
                            h += `<div class="contact-item" onclick="App.UI.startChatWithMember('${name}','${groupKey}')"><div class="avatar">👤</div><div class="info"><div class="name" style="color:${nameColor};font-weight:${nameWeight}">${name} <span style="font-size:10px">${App.MemberPersonality.getFor(name).emoji}</span></div></div></div>`;
                        });
                    });
                }

                if (groupData.graduated && groupData.graduated.length) {
                    h += `<div style="font-size:12px;color:#999;padding:8px 16px 4px;font-weight:600">🎓 毕业生</div>`;
                    groupData.graduated.slice(0, 10).forEach(name => {
                        h += `<div class="contact-item" onclick="App.UI.startChatWithMember('${name}','${groupKey}')"><div class="avatar">🎓</div><div class="info"><div class="name" style="color:#999">${name}</div></div></div>`;
                    });
                }
            });

            listEl.innerHTML = h;
        }
    },
    openWechatChat(id) {
        this.currentChatId = id;
        const data = G.chatHistory[id];
        const pers = App.MemberPersonality.getFor(id);
        const mood = App.MemberPersonality.getMemberMood(id);
        const mem = G.memberMemory?.[id];
        // 构建上下文记忆池：显示AI能感知到的记忆
        let memHTML = '';
        const eventLabels = { gift:'🎁送礼', dinner:'🍽️请吃饭', birthday:'🎂庆生', date:'💕约会', 
            transfer:'💰转账', comfort:'🤗安慰', center_deny:'😔未站C', center_give:'⭐站C', 
            partner_invite:'🤝搭档邀约', chat:'💬聊天', positive_response:'👍积极回应',
            neutral_response:'😐中立回应', negative_response:'👎消极回应' };
        const events = mem ? (mem.significantEvents || []).slice(-8).reverse() : [];
        const chatMsgs = data?.messages ? data.messages.length : 0;
        if (chatMsgs > 0 || events.length > 0) {
            memHTML = `
            <div id="memPool_${id}" style="background:linear-gradient(135deg,#f0f7ff,#e8f0fe);border-bottom:1px solid #c8ddf8;padding:6px 14px;font-size:11px;color:#668;max-height:72px;overflow-y:auto;transition:max-height .3s">
                <div style="display:flex;gap:12px;align-items:center">
                    <span style="color:#4a90d9">🧠 上下文感知</span>
                    <span>💬 ${chatMsgs}条对话</span>
                    ${mem && mem.totalInteractions > 0 ? `<span>❤️ ${G.memberAffection?.[id]||50}</span>` : ''}
                    <span style="cursor:pointer;margin-left:auto;color:#8899aa;font-size:10px" onclick="
                        const p=document.getElementById('memPool_${id}');
                        const s=p.style.maxHeight==='320px'?'72px':'320px';
                        p.style.maxHeight=s;
                        this.textContent=s==='320px'?'▲ 收起':'▼ 展开';
                    ">▼ 展开</span>
                </div>`;
            if (events.length > 0) {
                memHTML += `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px">`;
                events.forEach(e => {
                    memHTML += `<span style="background:#dce8f5;border-radius:6px;padding:1px 6px;font-size:10px;white-space:nowrap">${eventLabels[e.event]||e.event}</span>`;
                });
                memHTML += `</div>`;
            }
            memHTML += `</div>`;
        }
        const el = document.getElementById('wechatChatPage');
        el.innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.backToWechatList()">←</span><span class="title">${id}</span><span style="font-size:11px;color:#999;margin-left:4px">${mood.emoji}</span><span class="back-btn" style="margin-left:auto" onclick="App.UI.showChatOptions()">⋮</span></div>
        <div style="background:#f8f8f8;padding:4px 16px;font-size:10px;color:#999;border-bottom:1px solid #f0f0f0;display:flex;gap:8px">
            <span class="personality-badge ${pers.fanAttitude}">${pers.emoji}</span>
        </div>
        ${memHTML}
        <div class="chat-messages" id="wechatChatMsgs"></div>
        <div class="wechat-input-bar">
            <button class="wechat-plus-btn" onclick="App.UI.showWechatPlusMenu()">+</button>
            <input id="wechatInput" placeholder="输入消息..." onkeydown="if(event.key==='Enter')App.UI.sendWechat()">
            <button class="send-btn" onclick="App.UI.sendWechat()">发送</button>
        </div>`;
        this.renderWechatMessages();
        this.showPage('wechatChatPage');
    },
    showWechatPlusMenu() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = `
            display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5)
        `;
        
        const menu = document.createElement('div');
        menu.className = 'wechat-plus-menu';
        menu.style.cssText = `
            background:#fff;border-radius:12px;padding:8px;width:calc(100% - 60px);max-width:360px;box-sizing:border-box;
            max-height:40vh;overflow-y:auto;margin-bottom:50px;
        `;
        
        menu.innerHTML = `
            <div style="text-align:center;font-size:11px;color:#999;margin-bottom:8px">更多功能</div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:0 4px">
                <div class="wechat-plus-item" onclick="App.UI.showTransferModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">💰</div>
                    <div class="wechat-plus-label" style="font-size:11px">转账</div>
                </div>
                <div class="wechat-plus-item" onclick="App.UI.showGiftModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">🎁</div>
                    <div class="wechat-plus-label" style="font-size:11px">礼物</div>
                </div>
                <div class="wechat-plus-item" onclick="App.UI.showMealModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">🍽️</div>
                    <div class="wechat-plus-label" style="font-size:11px">请吃饭</div>
                </div>
                <div class="wechat-plus-item" onclick="App.UI.showBirthdayModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">🎂</div>
                    <div class="wechat-plus-label" style="font-size:11px">过生日</div>
                </div>
                <div class="wechat-plus-item" onclick="App.UI.showHangoutModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">🚶</div>
                    <div class="wechat-plus-label" style="font-size:11px">出去玩</div>
                </div>
                <div class="wechat-plus-item" onclick="App.UI.showPhotoModal();this.closest('.modal-overlay').remove()">
                    <div class="wechat-plus-icon" style="width:36px;height:36px;font-size:16px">📷</div>
                    <div class="wechat-plus-label" style="font-size:11px">照片</div>
                </div>
            </div>
            <button onclick="this.closest('.modal-overlay').remove()" 
                    style="width:100%;margin-top:8px;padding:8px;border:none;background:#f5f5f5;color:#333;font-size:12px;box-sizing:border-box;border-radius:6px">
                取消
            </button>
        `;
        
        overlay.appendChild(menu);
        document.getElementById('phoneModals').appendChild(overlay);

        
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    },
    showHangoutModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        modal.innerHTML = `<div style="background:#fff;width:300px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">🚶 邀请出去玩</div>
            <div style="font-size:12px;color:#666;margin-bottom:8px">选择地点</div>
            <select id="hangoutPlace" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px">
                <option value="park">公园散步</option>
                <option value="cafe">咖啡厅聊天</option>
                <option value="shopping">逛街购物</option>
                <option value="movie">看电影</option>
                <option value="dinner">一起晚餐</option>
            </select>
            <div style="font-size:12px;color:#666;margin-bottom:8px">留言</div>
            <input type="text" id="hangoutNote" placeholder="想和你一起去..." style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:16px;box-sizing:border-box">
            <div style="display:flex;gap:8px">
                <button style="flex:1;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
                <button style="flex:1;padding:10px;border:none;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border-radius:8px" onclick="App.UI.sendHangout()">发送邀请</button>
            </div>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    sendHangout() {
        const place = document.getElementById('hangoutPlace')?.value;
        const note = document.getElementById('hangoutNote')?.value || '一起出去玩吧！';
        
        const placeNames = {
            park: '公园散步',
            cafe: '咖啡厅聊天',
            shopping: '逛街购物',
            movie: '看电影',
            dinner: '一起晚餐'
        };
        
        const message = `🚶 邀请你去${placeNames[place] || place}~ ${note}`;
        this.sendWechat(message);
        document.querySelector('.modal-overlay')?.remove();
        
        const affGain = Math.floor(Math.random() * 5) + 3;
        G.memberAffection[this.currentChatId] = Math.min(100, (G.memberAffection[this.currentChatId] || 50) + affGain);
        App.Store.updateStats({mood: 5});
        this.showNotification(`好感度 +${affGain}`);
    },
    showChatOptions() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:flex-end;background:rgba(0,0,0,0.5)';
        modal.innerHTML = `<div style="background:#fff;width:100%;border-radius:16px 16px 0 0;padding:16px">
            <div style="text-align:center;font-size:14px;color:#999;margin-bottom:16px">和 ${this.currentChatId} 的聊天</div>
            <button style="width:100%;padding:12px;border:none;background:#f5f5f5;border-radius:8px;margin-bottom:8px" onclick="App.UI.clearChatHistory();this.closest('.modal-overlay').remove()">🗑️ 清空聊天记录</button>
            <button style="width:100%;padding:12px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
        modal.addEventListener('click', (e) => { if(e.target === modal) modal.remove(); });
    },
    clearChatHistory() {
        if (G.chatHistory[this.currentChatId]) {
            G.chatHistory[this.currentChatId].messages = [];
            this.renderWechatMessages();
            this.showNotification('聊天记录已清空');
        }
    },
    showTransferModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        modal.innerHTML = `<div style="background:#fff;width:300px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">💰 微信转账</div>
            <div style="font-size:12px;color:#666;margin-bottom:8px">转账金额 (元)</div>
            <input type="number" id="transferAmount" placeholder="请输入金额" min="1" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;box-sizing:border-box">
            <div style="font-size:12px;color:#666;margin-bottom:8px">给对方留言</div>
            <input type="text" id="transferNote" placeholder="随便说点什么" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin-bottom:16px;box-sizing:border-box">
            <div style="display:flex;gap:8px">
                <button style="flex:1;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
                <button style="flex:1;padding:10px;border:none;background:#07c160;color:#fff;border-radius:8px" onclick="App.UI.sendTransfer()">转账</button>
            </div>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    sendTransfer() {
        const amount = parseInt(document.getElementById('transferAmount')?.value);
        const note = document.getElementById('transferNote')?.value || '给你转账了';
        if (!amount || amount < 1) { this.showNotification('请输入有效金额'); return; }
        if (G.stats.wechatBalance < amount) { this.showNotification('余额不足'); return; }
        App.Store.updateStats({wechatBalance:-amount});
        const affGain = Math.floor(amount / 10);
        G.memberAffection[this.currentChatId] = (G.memberAffection[this.currentChatId]||50) + affGain;
        App.MemberMemory.record(this.currentChatId, 'transfer', `¥${amount}`);
        App.MemberMemory.adjustMood(this.currentChatId, 5);
        const msg = {from:'player',text:`💰 转账 ¥${amount}`,transfer:amount,time:getTimeStr()};
        if (!G.chatHistory[this.currentChatId]) G.chatHistory[this.currentChatId] = {type:'member',avatar:'👤',messages:[]};
        G.chatHistory[this.currentChatId].messages.push(msg);
        document.querySelector('.modal-overlay')?.remove();
        this.renderWechatMessages();
        const replies = amount >= 500 ? ['谢谢大佬！太豪气了！','姐姐最好了！','爱你！❤️'] : amount >= 200 ? ['谢谢姐姐！','太好了~','感激不尽'] : ['谢谢~','收到啦','谢谢姐姐(*^▽^*)'];
        setTimeout(() => {
            G.chatHistory[this.currentChatId].messages.push({from:'npc',text:pick(replies),time:getTimeStr()});
            this.renderWechatMessages();
        }, 800);
        this.showNotification(`转账成功，好感+${affGain}`);
        // 刷新好感度页面
        const affectionPage = document.getElementById('affectionPage');
        if (affectionPage && affectionPage.classList.contains('active')) {
            this.renderAffection();
        }
    },
    showPhotoModal() {
        const photos = ['📸', '🌸', '🎤', '💄', '🎀', '✨', '🌟', '💖', '🎬', '📷'];
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        let photosHtml = photos.map(p => `<button style="width:60px;height:60px;font-size:32px;border:none;background:#f5f5f5;border-radius:8px;cursor:pointer" onclick="App.UI.sendPhoto('${p}')">${p}</button>`).join('');
        modal.innerHTML = `<div style="background:#fff;width:320px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">📷 发送图片</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:16px">${photosHtml}</div>
            <button style="width:100%;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    sendPhoto(emoji) {
        const msg = {from:'player',text:`${emoji} [图片]`,photo:emoji,time:getTimeStr()};
        if (!G.chatHistory[this.currentChatId]) G.chatHistory[this.currentChatId] = {type:'member',avatar:'👤',messages:[]};
        G.chatHistory[this.currentChatId].messages.push(msg);
        document.querySelector('.modal-overlay')?.remove();
        this.renderWechatMessages();
    },
    showMealModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        modal.innerHTML = `<div style="background:#fff;width:300px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">🍽️ 请吃饭</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                <button onclick="App.UI.inviteMealInChat('cheap')" style="padding:12px;background:#27ae60;color:#fff;border:none;border-radius:8px;cursor:pointer">快餐 ¥50 (好感+5)</button>
                <button onclick="App.UI.inviteMealInChat('normal')" style="padding:12px;background:#3498db;color:#fff;border:none;border-radius:8px;cursor:pointer">餐厅 ¥200 (好感+15)</button>
                <button onclick="App.UI.inviteMealInChat('expensive')" style="padding:12px;background:#e74c3c;color:#fff;border:none;border-radius:8px;cursor:pointer">豪华 ¥500 (好感+30)</button>
            </div>
            <button style="width:100%;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    inviteMealInChat(level) {
        const costs = {cheap:50, normal:200, expensive:500};
        const cost = costs[level];
        const member = this.currentChatId;
        if (G.stats.wechatBalance < cost) { this.showNotification('余额不足'); return; }
        App.Store.updateStats({wechatBalance:-cost, mood:3});
        const affGain = level==='cheap'?5:level==='normal'?15:30;
        G.memberAffection[member] = (G.memberAffection[member]||50) + affGain;
        App.MemberMemory.record(member, 'dinner', level);
        App.MemberMemory.adjustMood(member, 8);
        const msg = {from:'player',text:`🍽️ 请${member}吃了顿饭`,meal:level,cost,time:getTimeStr()};
        if (!G.chatHistory[member]) G.chatHistory[member] = {type:'member',avatar:'👤',messages:[]};
        G.chatHistory[member].messages.push(msg);
        document.querySelector('.modal-overlay')?.remove();
        this.renderWechatMessages();
        const replies = level==='expensive'?['太豪华了！感动哭😭','姐姐我爱你！']:level==='normal'?['好吃！谢谢姐姐~','下次我请姐姐！']:['谢谢姐姐~','一起吃饭好开心！'];
        setTimeout(() => {
            G.chatHistory[member].messages.push({from:'npc',text:pick(replies),time:getTimeStr()});
            this.renderWechatMessages();
        }, 800);
        this.showNotification(`和${member}一起吃了顿饭，好感+${affGain}`);
        // 刷新好感度页面
        const affectionPage = document.getElementById('affectionPage');
        if (affectionPage && affectionPage.classList.contains('active')) {
            this.renderAffection();
        }
    },
    showBirthdayModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        modal.innerHTML = `<div style="background:#fff;width:300px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">🎂 过生日</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
                <button onclick="App.UI.celebrateBirthdayInChat('small')" style="padding:12px;background:#9b59b6;color:#fff;border:none;border-radius:8px;cursor:pointer">小蛋糕 ¥100 (好感+10)</button>
                <button onclick="App.UI.celebrateBirthdayInChat('medium')" style="padding:12px;background:#e74c3c;color:#fff;border:none;border-radius:8px;cursor:pointer">生日蛋糕 ¥300 (好感+25)</button>
                <button onclick="App.UI.celebrateBirthdayInChat('big')" style="padding:12px;background:#c0392b;color:#fff;border:none;border-radius:8px;cursor:pointer">豪华派对 ¥800 (好感+50)</button>
            </div>
            <button style="width:100%;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    celebrateBirthdayInChat(level) {
        const costs = {small:100, medium:300, big:800};
        const cost = costs[level];
        const member = this.currentChatId;
        if (G.stats.wechatBalance < cost) { this.showNotification('余额不足'); return; }
        App.Store.updateStats({wechatBalance:-cost, mood:5});
        const affGain = level==='small'?10:level==='medium'?25:50;
        G.memberAffection[member] = (G.memberAffection[member]||50) + affGain;
        App.MemberMemory.record(member, 'birthday', level);
        App.MemberMemory.adjustMood(member, 15);
        const msg = {from:'player',text:`🎂 为${member}庆祝生日`,birthday:level,cost,time:getTimeStr()};
        if (!G.chatHistory[member]) G.chatHistory[member] = {type:'member',avatar:'👤',messages:[]};
        G.chatHistory[member].messages.push(msg);
        document.querySelector('.modal-overlay')?.remove();
        this.renderWechatMessages();
        const replies = level==='big'?['生日派对太棒了！终身难忘！','这辈子最幸福的生日！']:level==='medium'?['蛋糕好漂亮！谢谢姐姐~','开心的生日！']:['谢谢姐姐记得我生日！','小小的蛋糕也超甜~'];
        setTimeout(() => {
            G.chatHistory[member].messages.push({from:'npc',text:pick(replies),time:getTimeStr()});
            this.renderWechatMessages();
        }, 800);
        this.showNotification(`为${member}庆祝生日，好感+${affGain}`);
        // 刷新好感度页面
        const affectionPage = document.getElementById('affectionPage');
        if (affectionPage && affectionPage.classList.contains('active')) {
            this.renderAffection();
        }
    },
    showGiftModal() {
        const backpack = G.stats.backpack || {};
        const items = Object.entries(backpack).filter(([_, count]) => count > 0);
        const giftNames = {flower:'🌸 鲜花', perfume:'🌷 香水', bag:'👜 名牌包'};
        const giftAff = {flower:8, perfume:20, bag:50};
        
        if (items.length === 0) {
            this.showNotification('背包里没有礼物，请先购买');
            return;
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)';
        
        let itemsHtml = items.map(([id, count]) => 
            `<button onclick="App.UI.sendGiftInChat('${id}')" style="padding:12px;background:#fff;border:1px solid #ddd;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px">
                <span style="font-size:24px">${giftNames[id]?.split(' ')[0] || '🎁'}</span>
                <span>${giftNames[id]?.split(' ')[1] || id}</span>
                <span style="color:#999;font-size:12px">x${count}</span>
                <span style="margin-left:auto;color:#27ae60;font-size:12px">好感+${giftAff[id]||0}</span>
            </button>`
        ).join('');
        
        modal.innerHTML = `<div style="background:#fff;width:300px;border-radius:16px;padding:20px">
            <div style="font-size:16px;font-weight:600;text-align:center;margin-bottom:16px">🎁 赠送礼物</div>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">${itemsHtml}</div>
            <button style="width:100%;padding:10px;border:none;background:#f5f5f5;border-radius:8px" onclick="this.closest('.modal-overlay').remove()">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },
    sendGiftInChat(type) {
        const member = this.currentChatId;
        const backpack = G.stats.backpack || {};
        if (!backpack[type] || backpack[type] < 1) { this.showNotification('礼物不足'); return; }
        
        backpack[type]--;
        if (backpack[type] <= 0) delete backpack[type];
        
        const giftNames = {flower:'🌸 鲜花', perfume:'🌷 香水', bag:'👜 名牌包'};
        const affGain = {flower:8, perfume:20, bag:50};
        G.memberAffection[member] = (G.memberAffection[member]||50) + affGain[type];
        App.MemberMemory.record(member, 'gift', type);
        App.MemberMemory.adjustMood(member, 10);
        App.Store.updateStats({mood:2});
        
        const msg = {from:'player',text:`🎁 送给${member}一份${giftNames[type]}`,gift:type,time:getTimeStr()};
        if (!G.chatHistory[member]) G.chatHistory[member] = {type:'member',avatar:'👤',messages:[]};
        G.chatHistory[member].messages.push(msg);
        document.querySelector('.modal-overlay')?.remove();
        this.renderWechatMessages();
        const replies = type==='bag'?['天哪！！名牌包！！姐姐我爱你！！']:type==='perfume'?['香水好香~谢谢姐姐','一直想要这个！']:['花好漂亮！','谢谢姐姐~'];
        setTimeout(() => {
            G.chatHistory[member].messages.push({from:'npc',text:pick(replies),time:getTimeStr()});
            this.renderWechatMessages();
        }, 800);
        this.showNotification(`送给${member}一份礼物，好感+${affGain[type]}`);
        // 刷新好感度页面
        const affectionPage = document.getElementById('affectionPage');
        if (affectionPage && affectionPage.classList.contains('active')) {
            this.renderAffection();
        }
    },
    startChatWithMember(name, groupKey) {
        if (!G.chatHistory[name]) {
            const groupData = App.NPCData[groupKey];
            let avatar = '👤';
            if (groupData?.agent?.name === name) avatar = groupData.agent.avatar;
            else if (groupData?.core) {
                const coreMember = groupData.core.find(c => c.name === name);
                if (coreMember) avatar = coreMember.avatar;
            }
            G.chatHistory[name] = { type:'member', avatar, messages:[{from:'npc',text:'（你好呀！）',time:getTimeStr()}] };
        }
        this.openWechatChat(name);
    },
    backToWechatList() {
        this.showPage('wechatPage');
        this.renderWechatList();
    },
    renderWechatMessages() {
        const data = G.chatHistory[this.currentChatId];
        if (!data) return;
        const container = document.getElementById('wechatChatMsgs');
        let h = '';
        data.messages.forEach(m => {
            const isMe = m.from === 'me' || m.from === 'player';
            h += `<div class="message ${isMe?'sent':'received'}"><div class="message-bubble">${m.text}</div></div>`;
        });
        container.innerHTML = h;
        container.scrollTop = container.scrollHeight;
    },
    sendWechat() {
        const input = document.getElementById('wechatInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const data = G.chatHistory[this.currentChatId];
        
        // 构建AI上下文（在推送当前消息之前，避免重复）
        const memberName = this.currentChatId;
        // 排除当前消息，只传历史对话（最后12条，不含当前）
        const historyMsgs = (data.messages || []).slice(-12).map(m => `${m.from==='player'?G.player.name:memberName}: ${m.text}`).join('\n');
        // 重点：提取最近2轮对话作为短期记忆锚点
        const lastExchanges = (data.messages || []).slice(-4).map(m => `${m.from==='player'?'玩家':memberName}: ${m.text}`).join('\n');
        const mem = G.memberMemory?.[memberName];
        const pers = App.MemberPersonality.getFor(memberName);
        const mood = App.MemberPersonality.getMemberMood(memberName);
        const aff = G.memberAffection?.[memberName] || 50;
        
        // 查找该成员所属的分团和分队
        let memberGroup = '', memberTeam = '';
        const allM = App.getAllMembers().find(m => m.name === memberName && !m.graduate);
        if (allM) { memberGroup = allM.group; memberTeam = allM.team; }
        
        // 构建记忆摘要
        let memSummary = '';
        if (mem && mem.significantEvents && mem.significantEvents.length > 0) {
            const recent = mem.significantEvents.slice(-5);
            const labels = { gift:'送礼', dinner:'请吃饭', birthday:'庆生', date:'约会', transfer:'转账', comfort:'安慰', center_deny:'未站C', center_give:'站C', partner_invite:'搭档邀约' };
            memSummary = recent.map(e => `Day${e.day}:${labels[e.event]||e.event}`).join(', ');
        }
        
        const ctx = {
            npcType: data.type, 
            personality: data.personality,
            memberName: memberName,
            memberGroup: memberGroup,
            memberTeam: memberTeam,
            memberPersEmoji: pers.emoji,
            memberPersName: pers.name,
            memberPersStyle: pers.speakStyle,
            playerName: G.player.name,
            playerTeam: G.player.team,
            playerGroup: G.player.group,
            affection: aff,
            moodLabel: mood.label,
            moodEmoji: mood.emoji,
            recentChat: historyMsgs,
            lastExchanges: lastExchanges,
            memorySummary: memSummary,
            chatHistoryLength: (data.messages || []).length
        };
        
        // 推送当前消息
        data.messages.push({from:'player', text, time:getTimeStr()});
        this.renderWechatMessages();
        App.Sound.play('Msg');
        const quality = evaluateReply(text);
        App.Store.applyChatStress(quality);
        
        App.AI.reply(this.currentChatId, ctx, text).then(reply => {
            data.messages.push({from:'npc', text:reply, time:getTimeStr()});
            this.renderWechatMessages();
            const aff = quality==='heartfelt'?3:quality==='normal'?1:-2;
            if (!G.memberAffection[this.currentChatId]) G.memberAffection[this.currentChatId] = 50;
            G.memberAffection[this.currentChatId] = clamp(G.memberAffection[this.currentChatId]+aff, 0, 100);
            App.MemberMemory.record(this.currentChatId, 'chat', text.substring(0,30));
            App.MemberMemory.adjustMood(this.currentChatId, quality==='heartfelt'?3:0);
            // 刷新好感度页面
            const affectionPage = document.getElementById('affectionPage');
            if (affectionPage && affectionPage.classList.contains('active')) {
                this.renderAffection();
            }
        });
    },
    showWechatMoments() {
        // 收集所有真实成员的 avatar 映射（来自各团 core 数组）
        const avatarMap = {};
        Object.values(App.NPCData || {}).forEach(g => {
            (g.core || []).forEach(c => { if (c && c.name) avatarMap[c.name] = c.avatar || '👤'; });
        });
        // 选取与玩家同团（最相关）的成员，作为朋友圈展示
        const sameGroup = App.getAllMembers().filter(m => m.group === G.player.group && m.team === G.player.team && m.name !== G.player.name && !m.graduate);
        // 如果同团成员不足，补充同团其他队，再不足补充其他团
        let memberPool = sameGroup.slice();
        if (memberPool.length < 6) {
            const sameGroupOtherTeam = App.getAllMembers().filter(m => m.group === G.player.group && m.name !== G.player.name && !m.graduate);
            memberPool = memberPool.concat(sameGroupOtherTeam).slice(0, 8);
        }
        if (memberPool.length < 4) {
            const others = App.getAllMembers().filter(m => m.name !== G.player.name && !m.graduate);
            memberPool = memberPool.concat(others).slice(0, 6);
        }
        // 池子去重（按 name）
        const seen = new Set();
        memberPool = memberPool.filter(m => { if (seen.has(m.name)) return false; seen.add(m.name); return true; });
        // 为每个成员随机分配一条朋友圈文案
        const memberPostTexts = [
            '今天排练好累但是很开心！新舞步终于拿下了💪',
            '新歌好好听，录音一次就过～🎤',
            '吃到了好吃的蛋糕！甜甜的一天~🍰',
            '新歌的MV拍摄花絮，好期待播出呀！',
            '今天的公演圆满成功！谢谢大家的支持！',
            '刚结束训练，洗完澡太舒服了🛁',
            '和队友一起吃饭，聊了好多八卦哈哈哈😂',
            '练习室到深夜，今天也是努力的一天！',
            '收到粉丝的小礼物，开心到转圈圈💝',
            '拍了一组新照片，摄影师说我状态超好📸',
            '今天和家人视频了，爸妈让我好好吃饭~',
            '新学的舞步卡了好几天，今天终于顺了！',
            '队友生日聚会，吃了好多好吃的🎂',
            '刚做完发型，下周公演期待一下～',
            '读完一本好书，推荐给大家📚',
            '雨天的训练室，安静又惬意☔'
        ];
        // shuffle helper
        const shuffled = (arr) => arr.slice().sort(() => Math.random() - 0.5);
        const memberPosts = memberPool.map((m, i) => ({
            name: m.name,
            emoji: avatarMap[m.name] || '🎤',
            text: memberPostTexts[i % memberPostTexts.length],
            likes: randInt(15, 90),
            isMember: true
        }));
        // 如果池子为空，插入一个"暂无队友动态"的占位
        const memberPostsOrFallback = memberPosts.length > 0 ? memberPosts : [
            {name:'(本团暂无其他成员)', emoji:'🌟', text:'快去认识更多队友吧！', likes:0, isMember:false}
        ];

        
        let h = '';
        h += `<div style="padding:12px 16px;background:#fff;display:flex;align-items:center;gap:10px;cursor:pointer;border-bottom:1px solid #f0f0f0" onclick="App.UI.openPostMoment()">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#ff69b4,#ff1493);display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff">${G.player.personalityEmoji||'✏️'}</div>
            <div style="color:#999;font-size:14px">分享你的心情...</div>
        </div>`;
        
        const allPosts = [
            {name:G.player.name, emoji:G.player.personalityEmoji||'🎤', text:`${G.player.name}：${G.moments[G.moments.length-1]?.text || '今天也要加油！'}`, likes:G.moments[G.moments.length-1]?.likes || 0, isMe:true, time:G.moments[G.moments.length-1]?.time || ''},
            ...memberPostsOrFallback.map(p => ({...p, isMe:false}))
        ];
        
        allPosts.forEach(m => {
            h += `<div class="moment-item" style="${m.isMe?'border-left:3px solid #ff69b4':''}">
                <div class="moment-header">
                    <span style="font-size:20px">${m.emoji}</span>
                    <span class="moment-user">${m.name}</span>
                    <span style="font-size:11px;color:#bbb;margin-left:auto">${m.time||''}</span>
                </div>
                <div class="moment-content">${m.text}</div>
                <div class="moment-actions">
                    <span class="moment-action" onclick="App.UI.likeMoment(this)" data-likes="${m.likes}">❤️ ${m.likes}</span>
                    <span class="moment-action">💬 评论</span>
                </div>
            </div>`;
        });
        
        document.getElementById('wechatMomentsPage').innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('wechat')">←</span><span class="title">朋友圈</span></div><div style="flex:1;overflow-y:auto;background:#f5f5f5">${h||'<div class="empty-hint">暂无动态</div>'}</div>`;
        this.showPage('wechatMomentsPage');
    },
    likeMoment(el) {
        const likes = parseInt(el.dataset.likes || 0) + 1;
        el.dataset.likes = likes;
        el.innerHTML = `❤️ ${likes}`;
        App.Store.updateStats({popularity:1});
    },
    openPostMoment() {
        document.getElementById('postMomentPage').innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.showWechatMoments()">←</span><span class="title">发朋友圈</span></div>
        <div style="padding:16px;background:#fff">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                <span style="font-size:24px">${G.player.personalityEmoji||'🎤'}</span>
                <span style="font-weight:600">${G.player.name}</span>
            </div>
            <textarea id="momentInput" placeholder="分享你的心情..." style="width:100%;min-height:120px;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:14px;resize:none;box-sizing:border-box"></textarea>
            <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
                <button onclick="App.UI.submitMomentWithEmoji('😊')" style="padding:6px 12px;background:#f5f5f5;border:none;border-radius:16px;font-size:14px;cursor:pointer">😊</button>
                <button onclick="App.UI.submitMomentWithEmoji('❤️')" style="padding:6px 12px;background:#f5f5f5;border:none;border-radius:16px;font-size:14px;cursor:pointer">❤️</button>
                <button onclick="App.UI.submitMomentWithEmoji('🎤')" style="padding:6px 12px;background:#f5f5f5;border:none;border-radius:16px;font-size:14px;cursor:pointer">🎤</button>
                <button onclick="App.UI.submitMomentWithEmoji('🌟')" style="padding:6px 12px;background:#f5f5f5;border:none;border-radius:16px;font-size:14px;cursor:pointer">🌟</button>
                <button onclick="App.UI.submitMomentWithEmoji('💪')" style="padding:6px 12px;background:#f5f5f5;border:none;border-radius:16px;font-size:14px;cursor:pointer">💪</button>
            </div>
            <button onclick="App.UI.submitMoment()" style="width:100%;padding:12px;margin-top:16px;background:linear-gradient(135deg,#07c160,#05a050);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer">发布</button>
        </div>`;
        this.showPage('postMomentPage');
    },
    submitMoment() {
        const text = document.getElementById('momentInput')?.value.trim();
        if (!text) { this.showNotification('请输入内容'); return; }
        G.moments.push({text, likes:0, emoji:G.player.personalityEmoji, time:getTimeStr()});
        App.Store.updateStats({popularity:2,mood:3});
        this.showNotification('朋友圈发布成功！');
        this.showWechatMoments();
    },
    submitMomentWithEmoji(emoji) {
        const input = document.getElementById('momentInput');
        input.value += emoji;
    },

    // ---------- 微博 ----------
    renderWeibo() {
        document.getElementById('weiboPage').innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">微博</span></div>
        <div class="tab-bar"><div class="tab active" onclick="App.UI.renderWeiboHot()">热搜</div><div class="tab" onclick="App.UI.renderWeiboMy()">我的</div><div class="tab" onclick="App.UI.renderWeiboPost()">发微博</div></div>
        <div id="weiboContent" style="flex:1;overflow-y:auto"></div>`;
        this.renderWeiboHot();
    },
    renderWeiboHot() {
        const followers = G.game.weibo_followers;
        const topics = ['#SNH48总选举#','#最佳拍档#','#偶像运动会#','#新公演直拍#','#口袋48直播#',`#${G.player.name}相关话题#`];
        let h = `<div style="padding:12px 16px;background:#fff;display:flex;justify-content:space-between;font-size:13px"><span>👥 粉丝：${followers}</span><span>📝 我的微博：${G.weiboPosts.length}条</span></div>
        <div style="padding:12px 16px;font-weight:600;background:#fff">🔥 微博热搜</div>`;
        topics.forEach((t,i) => {
            h += `<div class="hot-item"><span class="hot-rank${i<3?' top3':''}">${i+1}</span><span class="hot-title">${t}</span></div>`;
        });
        const grp = App.NPCData[G.player.group];
        if (grp) {
            const members = [...grp.core, ...Object.values(grp.teams||{}).flat()].slice(0,5);
            h += `<div style="padding:12px 16px;font-weight:600;background:#fff;border-top:8px solid #f5f5f5">📰 成员微博</div>`;
            members.forEach(m => {
                const name = typeof m === 'string' ? m : m.name;
                h += `<div class="weibo-item"><div class="weibo-header"><span>👤</span><span class="weibo-name">${name}</span></div><div class="weibo-text">${pick(['今天排练好累~','新歌超好听！','粉丝们晚安🌙','吃到了好吃的火锅','明天公演加油💪'])}</div><div class="weibo-stats"><span>❤️ ${randInt(50,500)}</span></div></div>`;
            });
        }
        document.getElementById('weiboContent').innerHTML = h;
    },
    renderWeiboMy() {
        let h = '';
        if (G.weiboPosts.length===0) h = '<div class="empty-hint">还没有发过微博</div>';
        else G.weiboPosts.slice().reverse().forEach(p => {
            h += `<div class="weibo-item"><div class="weibo-header"><span>${G.player.personalityEmoji}</span><span class="weibo-name">${G.player.name}</span></div><div class="weibo-text">${p.text}</div><div class="weibo-stats"><span>❤️ ${p.likes}</span></div></div>`;
        });
        document.getElementById('weiboContent').innerHTML = h;
    },
    renderWeiboPost() {
        let optionsHtml = '';
        if (G.stats.scandal > 0) {
            optionsHtml = `
                <div style="margin-bottom:12px">
                    <button class="clarify-btn" onclick="App.UI.showClarifyForm()" style="width:100%;padding:10px;background:#ffc107;color:#333;border:none;border-radius:8px;font-size:14px;cursor:pointer">📢 发布澄清微博（减少绯闻）</button>
                </div>
                <div id="clarifyForm" style="display:none;margin-bottom:12px;padding:12px;background:#fff3cd;border-radius:8px">
                    <textarea id="clarifyInput" placeholder="输入澄清内容..." style="width:100%;padding:8px;border:1px solid #ffc107;border-radius:4px;margin-bottom:8px;min-height:60px"></textarea>
                    <button class="post-btn" onclick="App.UI.submitClarify()">发布澄清</button>
                </div>
                <div style="text-align:center;color:#666;margin:8px 0">— 或者发布普通微博 —</div>
            `;
        }
        let trendingAlert = '';
        if (G.trendingEvents && G.trendingEvents.length > 0) {
            const last = G.trendingEvents[G.trendingEvents.length - 1];
            const sev = last.severity === 'major' ? '🔴' : last.severity === 'positive' ? '🟢' : '🟡';
            trendingAlert = `<div style="background:#fff8e1;border:1px solid #ffc107;border-radius:8px;padding:8px;margin-bottom:8px;font-size:11px">${sev} 最近热搜：${last.title} · ${last.trigger.substring(0,25)}…</div>`;
        }
        if (G.controversyLog && G.controversyLog.filter(l=>!l.resolved).length > 0) {
            trendingAlert += `<div style="background:#fdedec;border:1px solid #e74c3c;border-radius:8px;padding:8px;margin-bottom:8px;font-size:11px;cursor:pointer" onclick="App.UI.showControversyFromWeibo()">⚠️ 有${G.controversyLog.filter(l=>!l.resolved).length}个争议事件待处理 →</div>`;
        }
        document.getElementById('weiboContent').innerHTML = `<div class="post-area">
            ${optionsHtml}
            ${trendingAlert}
            <div style="font-size:11px;color:#e74c3c;margin-bottom:6px">⚠️ 注意措辞！黑幕/讨厌/恶心等词会引发负面效应</div>
            <textarea id="weiboInput" placeholder="分享你的动态..."></textarea>
            <button class="post-btn" onclick="App.UI.submitWeibo()">发布</button>
        </div>`;
    },
    showClarifyForm() {
        const form = document.getElementById('clarifyForm');
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    },
    submitClarify() {
        const text = document.getElementById('clarifyInput')?.value.trim();
        if (!text) return;
        const scandalReduction = Math.min(G.stats.scandal, randInt(10, 20));
        G.weiboPosts.push({text:'📢 [澄清] ' + text, likes:randInt(100,500), time:getTimeStr(), isClarify:true});
        G.game.weibo_followers += randInt(50,200);
        App.Store.updateStats({scandal:-scandalReduction,popularity:2,starlight:2});
        this.showNotification(`澄清微博发布成功！📸 绯闻值 -${scandalReduction}`);
        this.renderWeiboHot();
    },
    submitWeibo() {
        const text = document.getElementById('weiboInput')?.value.trim();
        if (!text) return;
        // 使用SocialMedia风险检测
        const result = App.SocialMedia.postWeibo(text);
        // 同步到原有weiboPosts
        G.weiboPosts.push({text, likes:result.likes, time:getTimeStr()});
        G.game.weibo_followers += result.likes > 100 ? randInt(50,200) : randInt(5,50);
        if (result.riskLevel === 'high') {
            this.showNotification(`⚠️ 高风险发言！${result.backlash?.desc}\\n📸绯闻+${result.backlash?.scandalGain} ⭐人气-${result.backlash?.popularityLoss}`, 5000);
        } else if (result.riskLevel === 'medium') {
            this.showNotification(`⚠️ 发言引起讨论：${result.riskDetail}`, 3500);
        } else {
            this.showNotification(`微博发布成功！👥 ❤️${result.likes}`, 2000);
        }
        this.renderWeiboHot();
    },

    // ---------- 短信 ----------
    renderSms() {
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">短信</span></div><div style="flex:1;overflow-y:auto">`;
        G.smsMessages.forEach((m,i) => {
            const replyHtml = !m.replied ? `<div class="sms-reply"><input id="smsReply${i}" placeholder="回复..."><button onclick="App.UI.replySms(${i})">发送</button></div>` : `<div style="font-size:11px;color:#aaa">已回复：${m.reply}</div>`;
            h += `<div class="sms-item"><div class="sms-avatar">${m.avatar||'📱'}</div><div class="sms-content"><div class="sms-sender">${m.from}</div><div class="sms-text">${m.text}</div>${replyHtml}</div></div>`;
        });
        if (G.smsMessages.length === 0) h += '<div class="empty-hint">暂无短信</div>';
        h += '</div>';
        document.getElementById('smsPage').innerHTML = h;
    },
    replySms(idx) {
        const input = document.getElementById('smsReply'+idx);
        const text = input?.value.trim();
        if (!text) return;
        G.smsMessages[idx].reply = text;
        G.smsMessages[idx].replied = true;
        const quality = evaluateReply(text);
        App.Store.updateStats({mood:quality==='heartfelt'?2:quality==='perfunctory'?-1:0});
        this.showNotification('短信已发送');
        this.renderSms();
    },

    // ---------- 电话 ----------
    renderPhone() {
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">📞 电话</span></div>
        <div style="flex:1;display:flex;flex-direction:column;background:#f9f9f9">
            <div class="phone-tabs">
                <div class="phone-tab active" onclick="App.UI.switchPhoneTab('history')">📋 通话记录</div>
                <div class="phone-tab" onclick="App.UI.switchPhoneTab('dial')">🔢 拨号</div>
            </div>
            <div class="phone-content" id="phoneContent">`;
        
        h += this.renderCallHistory();
        
        h += `</div></div>`;
        document.getElementById('callPage').innerHTML = h;
    },
    renderCallHistory() {
        let h = `<div class="call-history">`;
        if (G.callHistory.length === 0) {
            h += `<div class="call-history-empty">暂无通话记录</div>`;
        } else {
            G.callHistory.forEach((call, idx) => {
                const phoneNum = call.phone || '123****4567';
                const isMissed = !call.answered && call.isIncoming;
                const isIncoming = call.isIncoming;
                const callTypeIcon = isIncoming ? '⬇️' : '⬆️';
                const callTypeColor = isIncoming ? '#07c160' : '#ff9500';
                const callTypeText = isIncoming ? '打入' : '打出';
                h += `<div class="call-history-item" onclick="App.UI.initiateCall('${call.name}','${call.type||'member'}')">
                    <div class="call-history-avatar" style="position:relative">${call.avatar||'👤'}<span style="position:absolute;bottom:-2px;right:-2px;font-size:10px">${callTypeIcon}</span></div>
                    <div class="call-history-info">
                        <div class="call-history-name" style="color:${isMissed?'#ff3b30':'#000'}">${call.name}</div>
                        <div class="call-history-phone" style="display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:${callTypeColor};background:${isIncoming?'#e8f5e9':'#fff3e0'};padding:1px 4px;border-radius:4px">${callTypeText}</span>${phoneNum}</div>
                    </div>
                    <div class="call-history-time">${call.time}</div>
                </div>`;
            });
        }
        h += `</div>`;
        return h;
    },
    renderDialPad() {
        let h = `<div class="dial-pad-container">
            <div class="dial-number-display" id="dialNumber"></div>
            <div class="dial-grid">
                <button class="dial-btn" onclick="App.UI.addDialNumber('1')">
                    <span class="dial-btn-number">1</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('2')">
                    <span class="dial-btn-number">2</span>
                    <span class="dial-btn-letters">ABC</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('3')">
                    <span class="dial-btn-number">3</span>
                    <span class="dial-btn-letters">DEF</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('4')">
                    <span class="dial-btn-number">4</span>
                    <span class="dial-btn-letters">GHI</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('5')">
                    <span class="dial-btn-number">5</span>
                    <span class="dial-btn-letters">JKL</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('6')">
                    <span class="dial-btn-number">6</span>
                    <span class="dial-btn-letters">MNO</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('7')">
                    <span class="dial-btn-number">7</span>
                    <span class="dial-btn-letters">PQRS</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('8')">
                    <span class="dial-btn-number">8</span>
                    <span class="dial-btn-letters">TUV</span>
                </button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('9')">
                    <span class="dial-btn-number">9</span>
                    <span class="dial-btn-letters">WXYZ</span>
                </button>
                <button class="dial-btn dial-btn-empty"></button>
                <button class="dial-btn" onclick="App.UI.addDialNumber('0')">
                    <span class="dial-btn-number">0</span>
                    <span class="dial-btn-letters">+</span>
                </button>
                <button class="dial-btn dial-btn-backspace" onclick="App.UI.backspaceDial()">⌫</button>
            </div>
            <div class="dial-call-btn" onclick="App.UI.makeCall()">
                <div class="dial-call-icon">📞</div>
            </div>
        </div>`;
        return h;
    },
    switchPhoneTab(tab) {
        const tabs = document.querySelectorAll('.phone-tab');
        tabs.forEach(t => t.classList.remove('active'));
        
        const content = document.getElementById('phoneContent');
        if (tab === 'history') {
            document.querySelector('.phone-tab:nth-child(1)').classList.add('active');
            content.innerHTML = this.renderCallHistory();
        } else {
            document.querySelector('.phone-tab:nth-child(2)').classList.add('active');
            content.innerHTML = this.renderDialPad();
        }
    },
    addDialNumber(num) {
        const el = document.getElementById('dialNumber');
        if (el && el.textContent.length < 11) {
            el.textContent += num;
        }
    },
    backspaceDial() {
        const el = document.getElementById('dialNumber');
        if (el) {
            el.textContent = el.textContent.slice(0, -1);
        }
    },
    clearDial() {
        const el = document.getElementById('dialNumber');
        if (el) {
            el.textContent = '';
        }
    },
    makeCall() {
        const el = document.getElementById('dialNumber');
        const num = el?.textContent;
        if (!num || num.length < 7) {
            this.showNotification('请输入有效的号码');
            return;
        }
        const maskedPhone = num.substring(0, 3) + '****' + num.substring(num.length - 4);
        this.showNotification('正在拨号...');
        this.currentCallNpc = {name:'未知号码', avatar:'❓', type:'unknown', phone:maskedPhone};
        this.isOutgoingCall = true;
        const callEl = document.getElementById('callPage');
        callEl.innerHTML = `<div class="call-screen"><div class="caller-avatar">❓</div><div class="caller-name">${maskedPhone}</div><div class="caller-status">正在呼叫...</div><div class="call-actions"><button class="call-btn reject" onclick="App.UI.cancelOutgoingCall()">📵</button></div></div>`;
        setTimeout(() => {
            const isAnswered = Math.random() > 0.3;
            if (isAnswered) {
                const c = this.currentCallNpc;
                document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.endCall()">结束</span><span class="title" style="color:#fff">通话中 · ${maskedPhone}</span></div>
                <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message received"><div class="message-bubble">${maskedPhone}：喂？</div></div></div>
                <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
                this.showPage('callChatPage');
                this.addCallRecord(maskedPhone, '❓', 'unknown', maskedPhone, true, false);
            } else {
                const c = this.currentCallNpc;
                document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.goBackFromMissedCall()">返回</span><span class="title" style="color:#fff">通话中 · ${maskedPhone}</span></div>
                <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message system" style="justify-content:center"><div class="message-bubble" style="background:#333;color:#888;font-size:12px;max-width:80%;text-align:center">${maskedPhone} 未接听您的电话</div></div></div>
                <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
                this.showPage('callChatPage');
                this.addCallRecord(maskedPhone, '❓', 'unknown', maskedPhone, false, false);
                this.isOutgoingCall = false;
            }
        }, 3000);
    },
    generateMaskedPhone() {
        const prefix = String(Math.floor(Math.random() * 900) + 100);
        const suffix = String(Math.floor(Math.random() * 9000) + 1000);
        return prefix + '****' + suffix;
    },
    initiateCall(name, type) {
        const grp = App.NPCData[G.player.group];
        let caller = {name, avatar:'👤', type:type||'member'};
        if (type === 'agent' && grp?.agent) {
            caller = {...grp.agent, type:'agent'};
        } else if (grp?.core) {
            const found = grp.core.find(c => c.name === name);
            if (found) caller = {...found, type:'member'};
        }
        caller.phone = this.generateMaskedPhone();
        this.currentCallNpc = caller;
        this.isOutgoingCall = true;
        const callEl = document.getElementById('callPage');
        callEl.innerHTML = `<div class="call-screen"><div class="caller-avatar">${caller.avatar}</div><div class="caller-name">${caller.name}</div><div class="caller-status">正在呼叫...</div><div class="call-actions"><button class="call-btn reject" onclick="App.UI.cancelOutgoingCall()">📵</button></div></div>`;
        setTimeout(() => {
            const isAnswered = Math.random() > 0.3;
            if (isAnswered) {
                const c = caller;
                document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.endCall()">结束</span><span class="title" style="color:#fff">通话中 · ${c.name}</span></div>
                <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message received"><div class="message-bubble">${c.name}：喂？</div></div></div>
                <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
                this.showPage('callChatPage');
                this.addCallRecord(caller.name, caller.avatar, caller.type, caller.phone || '123****4567', true, false);
                App.Store.updateStats({affection:1});
            } else {
                const c = caller;
                document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.goBackFromMissedCall()">返回</span><span class="title" style="color:#fff">通话中 · ${c.name}</span></div>
                <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message system" style="justify-content:center"><div class="message-bubble" style="background:#333;color:#888;font-size:12px;max-width:80%;text-align:center">${c.name} 未接听您的电话</div></div></div>
                <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
                this.showPage('callChatPage');
                this.addCallRecord(caller.name, caller.avatar, caller.type, caller.phone || '123****4567', false, false);
                this.isOutgoingCall = false;
            }
        }, 2000);
    },
    cancelOutgoingCall() {
        const c = this.currentCallNpc;
        this.addCallRecord(c?.name || '未知', c?.avatar || '❓', c?.type || 'unknown', c?.phone || '123****4567', false, false);
        this.isOutgoingCall = false;
        this.currentCallNpc = null;
        this.renderPhone();
    },
    addCallRecord(name, avatar, type, phone, answered, isIncoming) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
        G.callHistory.unshift({name, avatar, type, phone, answered, time, isIncoming});
        if (G.callHistory.length > 20) G.callHistory.pop();
    },
    triggerCall() {
        const grp = App.NPCData[G.player.group];
        if (!grp) return;
        const callers = [grp.agent, ...grp.core];
        const c = pick(callers);
        c.phone = this.generateMaskedPhone();
        this.currentCallNpc = c;
        const el = document.getElementById('callPage');
        el.innerHTML = `<div class="call-screen"><div class="caller-avatar">${c.avatar}</div><div class="caller-name">${c.name}</div><div class="caller-status">来电中...</div><div class="call-actions"><button class="call-btn accept" onclick="App.UI.acceptCall()">📞</button><button class="call-btn reject" onclick="App.UI.rejectCall()">📵</button></div></div>`;
        this.showPage('callPage');
        App.Sound.play('Call');
    },
    receiveRandomCall() {
        if (this.incomingCall) return;
        const grp = App.NPCData[G.player.group];
        const allMembers = grp ? [...Object.values(grp.teams||{}).flat()] : [];
        const callerPool = [
            ...(grp?.agent ? [{name:grp.agent.name, avatar:grp.agent.avatar, type:'agent', personality:grp.agent.personality}] : []),
            ...(grp?.core || []).map(c => ({...c, type:'member'})),
            ...allMembers.map(name => ({name, avatar:'👤', type:'member'})),
            {name:'私生粉', avatar:'👁️', type:'stalker'},
            {name:'私生粉', avatar:'👁️', type:'stalker'},
            {name:'黑粉', avatar:'💀', type:'hater'},
            {name:'黑粉', avatar:'💀', type:'hater'},
            {name:'狂热粉', avatar:'🔥', type:'fanatic'},
            {name:'狂热粉', avatar:'🔥', type:'fanatic'}
        ];
        const caller = pick(callerPool);
        caller.phone = this.generateMaskedPhone();
        this.incomingCall = caller;
        this.currentCallNpc = caller;
        App.Sound.play('Call');
        this.showCallPopup(caller);
    },
    showCallPopup(caller) {
        const container = document.getElementById('phoneNotifContainer');
        if (!container) return;
        const pop = document.createElement('div');
        pop.className = 'phone-notif-item';
        pop.style.background = 'linear-gradient(135deg,#2d2d2d,#1a1a1a)';
        pop.style.color = '#fff';
        pop.innerHTML = `<div class="phone-notif-icon" style="font-size:32px">${caller.avatar}</div><div class="phone-notif-body"><div class="phone-notif-app" style="color:#ff69b4">📞 来电</div><div class="phone-notif-title" style="color:#fff">${caller.name}</div><div class="phone-notif-text" style="color:#aaa">来电中...</div></div><div style="display:flex;gap:6px"><button class="phone-notif-btn" style="background:#07c160;color:#fff;border:none;padding:6px 12px;border-radius:20px;font-size:12px" onclick="App.UI.acceptCallFromPopup()">接听</button><button class="phone-notif-btn" style="background:#ff4757;color:#fff;border:none;padding:6px 12px;border-radius:20px;font-size:12px" onclick="App.UI.rejectCallFromPopup()">拒绝</button></div>`;
        container.appendChild(pop);
        setTimeout(() => pop.classList.add('show'), 10);
        this.callPopupElement = pop;
    },
    acceptCallFromPopup() {
        if (this.callPopupElement) { this.callPopupElement.remove(); this.callPopupElement = null; }
        this.incomingCall = null;
        const c = this.currentCallNpc;
        if (!c) return;
        let greeting = '喂？';
        if (c.type === 'agent' && c.personality) greeting = '有什么事吗？';
        else if (c.type === 'member' || c.type === 'sweet') greeting = pick(['姐姐~在干嘛呀？','姐姐你好！','你好呀姐姐！']);
        else if (c.type === 'sister') greeting = '有件事想跟你聊聊。';
        else if (c.type === 'rival') greeting = '下次公演我可不会输。';
        else if (c.type === 'stalker') greeting = '终于打通你电话了...（私生粉）';
        else if (c.type === 'hater') greeting = pick(['哼，你有什么事？','说吧，我听着呢。']);
        else if (c.type === 'fanatic') greeting = pick(['姐姐！！终于跟你通上电话了！！','天哪！是你吗姐姐！！']);
        else if (c.type === 'fan') greeting = pick(['你好！我是你的粉丝！','偶像大人好！我是粉丝！']);
        document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.endCall()">结束</span><span class="title" style="color:#fff">通话中 · ${c.name}</span></div>
        <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message received"><div class="message-bubble">${c.name}：${greeting}</div></div></div>
        <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
        this.showPage('callChatPage');
        this.addCallRecord(c.name, c.avatar, c.type, c.phone || '123****4567', true, true);
        App.Store.updateStats({affection: c.type === 'stalker' || c.type === 'hater' ? 0 : 1});
    },
    rejectCallFromPopup() {
        if (this.callPopupElement) { this.callPopupElement.remove(); this.callPopupElement = null; }
        this.incomingCall = null;
        const c = this.currentCallNpc;
        let effects = {affection:-3, mood:-2};
        if (c?.type === 'stalker') { effects = {mood:-5, stress:3}; this.showNotification('被私生粉骚扰了...'); }
        else if (c?.type === 'hater') { effects = {mood:-3}; this.showNotification('已拒绝'); }
        else if (c?.type === 'fanatic') { effects = {affection:-2, mood:-2}; }
        else { this.showNotification('已挂断'); }
        App.Store.updateStats(effects);
        this.addCallRecord(c?.name || '未知来电', c?.avatar || '❓', c?.type || 'unknown', c?.phone || '123****4567', false, true);
        this.currentCallNpc = null;
        this.isOutgoingCall = false;
    },
    acceptCall() {
        if (!this.currentCallNpc) return;
        const c = this.currentCallNpc;
        let greeting = '喂？';
        if (c.type === 'agent' && c.personality) greeting = '有什么事吗？';
        else if (c.type === 'member' || c.type === 'sweet') greeting = pick(['姐姐~在干嘛呀？','姐姐你好！','你好呀姐姐！']);
        else if (c.type === 'sister') greeting = '有件事想跟你聊聊。';
        else if (c.type === 'rival') greeting = '下次公演我可不会输。';
        else if (c.type === 'stalker') greeting = '终于打通你电话了...（私生粉）';
        else if (c.type === 'hater') greeting = pick(['哼，你有什么事？','说吧，我听着呢。']);
        else if (c.type === 'fanatic') greeting = pick(['姐姐！！终于跟你通上电话了！！','天哪！是你吗姐姐！！']);
        else if (c.type === 'fan') greeting = pick(['你好！我是你的粉丝！','偶像大人好！我是粉丝！']);
        document.getElementById('callChatPage').innerHTML = `<div class="app-header" style="background:#2d2d2d;border-color:#444"><span class="back-btn" style="color:#ff69b4" onclick="App.UI.endCall()">结束</span><span class="title" style="color:#fff">通话中 · ${c.name}</span></div>
        <div class="chat-messages" id="callChatMsgs" style="background:#1a1a2e"><div class="message received"><div class="message-bubble">${c.name}：${greeting}</div></div></div>
        <div class="call-input-bar"><input id="callInput" placeholder="说话..."><button class="send-btn" onclick="App.UI.sendCall()">说</button></div>`;
        this.showPage('callChatPage');
        this.addCallRecord(c.name, c.avatar, c.type, c.phone || '123****4567', true, true);
        App.Store.updateStats({affection: c.type === 'stalker' || c.type === 'hater' ? 0 : 1});
    },
    rejectCall() {
        const c = this.currentCallNpc;
        let effects = {affection:-3,mood:-2};
        if (c?.type === 'stalker') { effects = {mood:-5, stress:3}; this.showNotification('被私生粉骚扰了...'); }
        else if (c?.type === 'hater') { effects = {mood:-3}; this.showNotification('已拒绝'); }
        else if (c?.type === 'fanatic') { effects = {affection:-2, mood:-2}; }
        else { this.showNotification('已挂断'); }
        App.Store.updateStats(effects);
        this.addCallRecord(c?.name || '未知来电', c?.avatar || '❓', c?.type || 'unknown', c?.phone || '123****4567', false, true);
        this.currentCallNpc = null;
        this.isOutgoingCall = false;
        this.goHome();
    },
    sendCall() {
        const input = document.getElementById('callInput');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        const msgs = document.getElementById('callChatMsgs');
        msgs.innerHTML += `<div class="message sent"><div class="message-bubble">${text}</div></div>`;
        msgs.scrollTop = msgs.scrollHeight;
        const quality = evaluateReply(text);
        const c = this.currentCallNpc;
        let replyText = '';
        if (c.type === 'stalker') {
            replyText = pick(['我在你家楼下呢','你住址我都知道的','跟踪你是我的乐趣']);
        } else if (c.type === 'hater') {
            replyText = pick(['你就这点实力？','别丢人现眼了','赶紧退团吧']);
        } else if (c.type === 'fanatic') {
            replyText = pick(['姐姐说什么都对！！','我永远支持姐姐！！','太幸福了能听到姐姐声音！！']);
        } else {
            const ctx = {npcType: c.type||'agent', personality: c.personality};
            App.AI.reply(c.name, ctx, text).then(reply => {
                msgs.innerHTML += `<div class="message received"><div class="message-bubble">${c.name}：${reply}</div></div>`;
                msgs.scrollTop = msgs.scrollHeight;
            });
            App.Store.updateStats({mood:quality==='heartfelt'?3:quality==='perfunctory'?-1:1, affection:quality==='heartfelt'?3:1});
            return;
        }
        msgs.innerHTML += `<div class="message received"><div class="message-bubble">${c.name}：${replyText}</div></div>`;
        msgs.scrollTop = msgs.scrollHeight;
        App.Store.updateStats({mood: c.type === 'stalker' || c.type === 'hater' ? -2 : (quality==='heartfelt'?3:quality==='perfunctory'?-1:1), affection: quality==='heartfelt'?3:1});
    },
    endCall() {
        this.showNotification('通话结束');
        App.Store.updateStats({mood:1});
        this.currentCallNpc = null;
        this.isOutgoingCall = false;
        this.showPage('callPage');
        this.renderPhone();
    },
    goBackFromMissedCall() {
        this.currentCallNpc = null;
        this.showPage('callPage');
        this.renderPhone();
    },

    // ---------- 口袋48 ----------
    renderPocketHome() {
        const grp = App.NPCData[G.player.group];
        const events = ['排练 14:00','公演 19:00','握手会 13:00'];
        const notices = ['本周公演曲目已确定','总选举投票通道即将开启','新歌MV拍摄通知'];
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">口袋48</span></div>
        <div class="tab-bar"><div class="tab active" onclick="App.UI.renderPocketHome()">首页</div><div class="tab" onclick="App.UI.renderPocketRoom()">聊天室</div><div class="tab" onclick="App.UI.renderPocketFlip()">翻牌</div><div class="tab" onclick="App.UI.renderPocketLive()">直播</div><div class="tab" onclick="App.UI.renderPocketShow()">演出</div></div>
        <div style="flex:1;overflow-y:auto;padding:12px">
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px"><div style="font-size:15px;font-weight:600">📋 今日行程</div>${events.map(e=>`<div style="font-size:13px;color:#666;padding:4px 0">• ${e}</div>`).join('')}</div>
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px"><div style="font-size:15px;font-weight:600">📢 公告</div><div style="font-size:13px;color:#666">${pick(notices)}</div></div>
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px"><div style="font-size:15px;font-weight:600">📊 我的数据</div><div style="font-size:13px;color:#666">鸡腿：🍗 ${G.stats.drumstick} | 粉丝：👥 ${G.game.pocket_fans} | 排名：#${G.game.rank}</div></div>
            
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px">
                <div style="font-size:15px;font-weight:600;margin-bottom:12px">💱 鸡腿兑换</div>
                <div style="font-size:12px;color:#666;margin-bottom:8px">鸡腿可兑换为微信支付余额 (10鸡腿=1元)</div>
                <div style="display:flex;align-items:center;gap:8px">
                    <input type="number" id="pocketDrumstickExchange" placeholder="输入鸡腿数量" min="10" step="10" max="${G.stats.drumstick}" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px">
                    <button onclick="App.UI.exchangeDrumstickFromPocket()" style="padding:8px 16px;background:#f39c12;color:#fff;border:none;border-radius:8px;cursor:pointer">兑换</button>
                </div>
                <div style="font-size:12px;color:#999;margin-top:4px">当前鸡腿: ${G.stats.drumstick} (10鸡腿 = ¥1)</div>
            </div>
            
            <button class="create-btn" onclick="App.UI.renderPocketMembers()" style="width:100%;margin-top:12px">👥 成员名单</button>
        </div>`;
        document.getElementById('pocketPage').innerHTML = h;
    },
    renderPocketMembers() {
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">成员名单</span></div>
        <div style="flex:1;overflow-y:auto">`;
        Object.entries(App.NPCData).forEach(([groupKey, groupData]) => {
            h += `<div class="contact-group-title">🏢 ${groupKey}</div>`;
            if (groupData.teams) {
                Object.entries(groupData.teams).forEach(([teamName, memberList]) => {
                    h += `<div style="font-size:12px;color:#ff69b4;padding:4px 16px;font-weight:600">Team ${teamName}</div>`;
                    memberList.forEach(name => {
                        h += `<div class="member-list-item"><div class="avatar">👤</div><div class="info"><div class="name">${name}</div><div class="team">${groupKey} Team ${teamName}</div></div><button class="best-partner-btn" onclick="App.UI.invitePartner('${name}','${groupKey}')">🤝</button></div>`;
                    });
                });
            }
            if (groupData.graduates && groupData.graduates.length) {
                h += `<div style="font-size:12px;color:#999;padding:4px 16px;font-weight:600">🎓 荣誉毕业生</div>`;
                groupData.graduates.forEach(name => {
                    h += `<div class="member-list-item"><div class="avatar">🎓</div><div class="info"><div class="name">${name}<span class="graduate-tag">毕业生</span></div><div class="team">${groupKey} 毕业生</div></div></div>`;
                });
            }
        });
        h += `</div>`;
        document.getElementById('pocketPage').innerHTML = h;
    },
    renderPocketRoom() {
        if (!G.pocketRoomMessages.length) {
            G.pocketRoomMessages = [
                {sender:'粉丝001',avatar:'🧸',text:'姐姐好！',isMe:false, personaId:'lively_xiaoyuan'},
                {sender:G.player.name,text:'大家好~',isMe:true}
            ];
        }
        // 记录房间进入时间，用于自动触发判断
        if (!G.pocketRoomEnterTime || G.pocketRoomLastDay !== (G.game?.day || 1)) {
            G.pocketRoomEnterTime = Date.now();
            G.pocketRoomLastDay = G.game?.day || 1;
            G.pocketRoomAutoTriggered = false;
        }

        let chatHtml = G.pocketRoomMessages.map((m, idx) => {
            const persona = m.personaId ? App.FanAI.personas.find(p => p.id === m.personaId) : null;
            const senderColor = persona ? persona.color : '#999';
            return `
            <div style="display:flex;justify-content:${m.isMe?'flex-end':'flex-start'};margin-bottom:16px">
                ${!m.isMe ? `<div class="avatar" style="width:36px;height:36px;border-radius:50%;background:#f0f0f0;margin-right:10px;display:flex;align-items:center;justify-content:center;font-size:16px">${m.avatar || '👤'}</div>` : ''}
                <div style="max-width:70%">
                    ${!m.isMe ? `<div style="font-size:11px;color:${senderColor};margin-bottom:4px;padding-left:4px;font-weight:${persona ? '600' : 'normal'}">${m.sender}</div>` : ''}
                    <div style="${m.isMe?'background:#07c160;color:#fff;border-radius:18px 18px 4px 18px':'background:#fff;border-radius:18px 18px 18px 4px;border:1px solid #eee'};padding:10px 14px;font-size:14px;box-shadow:0 1px 2px rgba(0,0,0,0.05)">
                        ${m.text}
                    </div>
                </div>
                ${m.isMe ? `<div class="avatar" style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;margin-left:10px;display:flex;align-items:center;justify-content:center;font-size:12px">我</div>` : ''}
            </div>
        `}).join('');
        // AI 状态条
        const aiBar = `<div style="background:linear-gradient(90deg,#e3f2fd,#f3e5f5);padding:8px 12px;font-size:11px;color:#555;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e0e0e0"><span>🤖 AI 粉丝已上线（${App.FanAI.personas.length} 个独立人设）</span><span style="color:#999">${G.pocketRoomAutoTriggered ? '✅ 已自动欢迎' : '⏳ 等待 AI 主动发消息'}</span></div>`;

        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">房间</span></div>
        ${aiBar}
        <div id="roomChatArea" style="flex:1;overflow-y:auto;padding:12px;background:#f5f5f5">
            <div style="max-width:400px;margin:0 auto">
                ${chatHtml || '<div style="text-align:center;color:#999;padding:60px 20px">暂无消息，快来和粉丝互动吧~</div>'}
            </div>
        </div>
        <div class="chat-input-bar" style="padding:10px 12px;">
            <input id="pocketInput" placeholder="说点什么..." onkeydown="if(event.key==='Enter')App.UI.sendPocketMessage()" style="padding:10px 16px;border-radius:22px">
            <button class="send-btn" onclick="App.UI.sendPocketMessage()" style="padding:10px 20px;border-radius:22px">发送</button>
        </div>`;
        document.getElementById('pocketPage').innerHTML = h;
        setTimeout(() => {
            const chatArea = document.getElementById('roomChatArea');
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        }, 100);

        // 触发 AI 主动消息（仅首次进入房间时）
        if (!G.pocketRoomAutoTriggered) {
            this.triggerPocketRoomAIMsgs();
        }
    },

    // AI 主动发消息（1-3 个不同人设，按各自延迟触发）
    triggerPocketRoomAIMsgs() {
        if (G.pocketRoomAutoTriggered) return;
        G.pocketRoomAutoTriggered = true;
        const count = 1 + Math.floor(Math.random() * 3); // 1-3 条
        const msgs = App.FanAI.autoTriggerMessages(count);
        msgs.forEach((m, idx) => {
            const delay = 3000 + idx * 4000 + Math.random() * 3000; // 3-15s 错开
            setTimeout(() => {
                if (this.currentPage !== 'pocketPage') return; // 离开房间就不发
                G.pocketRoomMessages.push(m);
                this.renderPocketRoom();
                const chatArea = document.getElementById('roomChatArea');
                if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
            }, delay);
        });
    },

    sendPocketMessage() {
        const input = document.getElementById('pocketInput');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';

        G.pocketRoomMessages.push({ sender: G.player.name, text, isMe: true });

        // AI 人设驱动回复：根据玩家消息上下文选人设
        const reply = App.FanAI.pickReply(text);
        const persona = reply.persona;
        const delay = App.FanAI.replyDelay(persona);
        const senderName = (persona.prefix || '') + persona.name + (persona.prefix ? Math.floor(Math.random() * 900 + 100) : '');

        setTimeout(() => {
            G.pocketRoomMessages.push({
                sender: senderName,
                avatar: persona.avatar,
                text: reply.text,
                isMe: false,
                personaId: persona.id
            });
            this.renderPocketRoom();
            const chatArea = document.getElementById('roomChatArea');
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
        }, delay);

        // 30% 概率追加一个不同人设的回复
        if (Math.random() < 0.3) {
            const otherReply = App.FanAI.pickReply(text);
            if (otherReply.persona.id !== persona.id) {
                const otherDelay = delay + 1500 + Math.random() * 2000;
                setTimeout(() => {
                    if (this.currentPage !== 'pocketPage') return;
                    const otherName = (otherReply.persona.prefix || '') + otherReply.persona.name;
                    G.pocketRoomMessages.push({
                        sender: otherName,
                        avatar: otherReply.persona.avatar,
                        text: otherReply.text,
                        isMe: false,
                        personaId: otherReply.persona.id
                    });
                    this.renderPocketRoom();
                    const chatArea = document.getElementById('roomChatArea');
                    if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
                }, otherDelay);
            }
        }

        this.renderPocketRoom();
    },
    sendRoomMsg() {
        const input = document.getElementById('roomInput');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';
        G.pocketRoomMessages.push({sender:G.player.name,text,isMe:true});
        const earn = randInt(1,50);
        App.Store.updateStats({drumstick:earn,popularity:1});
        this.showNotification(`🍗 +${earn}`);
        this.renderPocketRoom();
        const fanComments = ['姐姐好棒！','鸡腿安排！','哈哈哈','爱你哟❤️','太可爱了！','加油加油！','笑死我了😂','姐姐瘦了吗？','今天妆容好好看','新衣服吗？','好想你啊！','等下有公演吗？','翻我翻我！','姐姐在干嘛呀','❤️❤️❤️','好感动！','冲冲冲！','今天也要元气满满！'];
        const sendFanMsg = () => {
            G.pocketRoomMessages.push({sender:'粉丝'+randInt(100,999),avatar:'🧸',text:pick(fanComments),isMe:false});
            if (this.currentPage === 'pocketPage') {
                this.renderPocketRoom();
                const msgs = document.getElementById('roomChatArea');
                if (msgs) msgs.scrollTop = msgs.scrollHeight;
            }
        };
        sendFanMsg();
        setTimeout(sendFanMsg, 500);
        setTimeout(sendFanMsg, 1200);
        setTimeout(sendFanMsg, 2000);
    },
    renderPocketFlip() {
        const settings = (G && G.settings) || { flipPrice: 0, flipPriceEnabled: false };
        const curPrice = settings.flipPrice || 0;
        // 付费输入卡：玩家输入价格，0 表示免费
        const priceCard = `
        <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
            <div style="font-size:13px;font-weight:600;color:#333;margin-bottom:8px">💸 翻牌付费设置（玩家自行定价）</div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span style="font-size:13px;color:#666;flex:1">每次翻牌价格（🍗 鸡腿）</span>
                <input id="flipPagePriceInput" type="number" min="0" max="500" value="${curPrice}" placeholder="0-500" style="width:90px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;text-align:center" oninput="App.UI.setFlipPrice(this.value)" onchange="App.UI.setFlipPrice(this.value)">
                <button onclick="App.UI.setFlipPrice(document.getElementById('flipPagePriceInput').value);App.UI.renderPocketFlip();" style="padding:8px 14px;background:#ff9500;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">保存</button>
            </div>
            <div id="flipPagePriceHint" style="font-size:12px;color:${curPrice > 0 ? '#ff9500' : '#27ae60'};line-height:1.5">
                ${curPrice > 0
                    ? `✅ 当前定价：每次翻牌粉丝需付 <b>${curPrice}</b> 🍗（你将获得 ${curPrice} 🍗，回复质量高时还有奖励）`
                    : '🆓 当前翻牌免费（输入 1-500 启用收费）'}
            </div>
        </div>`;
        // 翻牌状态：每日重置
        if (!G.flipState || G.flipState.day !== (G.game?.day || 1)) {
            G.flipState = { day: G.game?.day || 1, replied: {} };
        }
        const replied = G.flipState.replied || {};
        const fans = ['小圆','星星','默默','阿花','小鱼','小月','琪琪','豆豆','花花','小雪','小满','小月月','木木','糖糖','糖小咪','豆芽','小诺','阿璃','雪球','小杰','阿白','小米','糖宝','小月兔','小倩','小饼干','小星','阿果','小蝶','小白'];
        const fanMsgs = [
            '姐姐今天公演超棒！','新歌好好听啊！','每天都来看姐姐','姐姐要好好休息哦','太甜了吧姐姐！','加油我们支持你','什么时候出周边啊','公演票好难抢...','姐姐广州人吗？','期待下次见面！','想看姐姐拍广告','姐姐笑容好治愈',
            '姐姐今天在干嘛呀～','我刚下班就来刷动态了','今天姐姐好好看啊！','这首新歌我单曲循环了！','姐姐加油，我们都在～','姐姐什么时候出单曲呀','刚抢到公演票好开心！','今天的直播太精彩了','姐姐的舞跳得太好了！','姐姐的歌声让我一整天都开心',
            '想看姐姐拍杂志！','姐姐的穿搭好好看','姐姐今天有没有好好吃饭','今天好累但是看到姐姐就开心了','姐姐的舞蹈进步好大','姐姐发的新歌好好听','刚下班就想看姐姐','今天的姐姐好飒！','姐姐有没有新照片','姐姐生快快乐～',
            '姐姐什么时候开见面会呀','想给姐姐写信！','姐姐下次公演什么时候','姐姐记得多喝水哦','今天穿得好好看','姐姐的演技好棒','姐姐的笑容治愈了我一整天','想和姐姐合影！','姐姐什么时候来我们城市','姐姐的 MV 太美了',
            '姐姐的嗓音好特别','姐姐保重身体哦～','刚看到姐姐的签名好开心','姐姐是我的动力','今天给姐姐投票了','想和姐姐喝咖啡','姐姐的新发型好可爱','姐姐的腿好长啊','姐姐在哪里吃饭呀','想看姐姐的日常',
            '姐姐最近心情怎么样？','姐姐今天有什么计划','刚看完姐姐的舞台哭了','姐姐的综艺感好强','姐姐什么时候直播','想和姐姐一起去游乐园','姐姐的手好漂亮','姐姐的眼睛会说话','姐姐的身高是多少呀','姐姐喜欢什么颜色',
            '姐姐的最爱是什么','姐姐有没有养宠物','姐姐的房间是什么样的','姐姐的家人支持你吗','姐姐喜欢什么食物','想给姐姐寄礼物','姐姐的签名怎么练的','姐姐的粉丝叫什么','姐姐的应援色是什么','姐姐有没有喜欢的小动物'
        ];
        const fanEmojis = ['🧸','🐱','🐶','🐰','🐻','🦊','🐼','🦁','🐯','🐨','🐸','🐵','🐔','🐧','🦄'];
        // 选 10 个粉丝（每天基于人气 randomize）
        const seed = (G.game?.day || 1) * 7 + Math.floor((G.stats?.popularity || 0) / 10);
        const shuffledFans = fans.slice().sort((a,b) => ((a.charCodeAt(0)+seed) % 97) - ((b.charCodeAt(0)+seed) % 97)).slice(0, 10);
        const shuffledMsgs = fanMsgs.slice().sort(() => Math.random() - 0.5);
        const today = G.game?.day || 1;
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">翻牌</span></div>${priceCard}
        <div style="background:#e3f2fd;color:#0d47a1;padding:8px 12px;font-size:12px;border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            <span>📅 第 ${today} 天 · 今日翻牌 <b>${Object.keys(replied).length}/10</b></span>
            <span style="font-size:11px;color:#666">${Object.keys(replied).length >= 10 ? '🌙 今日翻完，明日 0:00 刷新' : '剩余 ' + (10 - Object.keys(replied).length) + ' 条'}</span>
        </div>
        <div style="flex:1;overflow-y:auto;padding:8px">`;
        shuffledFans.forEach((f, i) => {
            const isReplied = !!replied[i];
            const msg = shuffledMsgs[i % shuffledMsgs.length];
            const emoji = fanEmojis[i % fanEmojis.length];
            if (isReplied) {
                // 已翻牌：显示灰色 + 标记
                h += `<div class="flip-card" style="opacity:0.55;background:#f5f5f5">
                    <div class="flip-fan">${emoji} ${f}</div>
                    <div class="flip-msg" style="color:#999">${msg}</div>
                    <div style="text-align:center;padding:10px;background:#d4edda;color:#155724;border-radius:6px;font-size:12px;margin-top:6px">✅ 已回复 · 等待明日刷新</div>
                </div>`;
            } else {
                h += `<div class="flip-card">
                    <div class="flip-fan">${emoji} ${f}</div>
                    <div class="flip-msg">${msg}</div>
                    <div class="flip-reply"><input id="flipInput${i}" placeholder="回复粉丝..."><button onclick="App.UI.sendFlip(${i})">翻牌</button></div>
                </div>`;
            }
        });
        h += '</div>';
        document.getElementById('pocketPage').innerHTML = h;
    },
    toggleFlipPrice() {
        if (!G.settings) G.settings = { flipPrice: 0, flipPriceEnabled: false };
        G.settings.flipPriceEnabled = !G.settings.flipPriceEnabled;
        App.Save.autoSave();
        this.showNotification(G.settings.flipPriceEnabled ? '💰 已启用翻牌收费：粉丝每次翻牌需付费' : '🆓 已关闭翻牌收费');
        this.renderSettings();
    },
    setFlipPrice(val) {
        if (!G.settings) G.settings = { flipPrice: 0, flipPriceEnabled: false };
        const raw = parseInt(val);
        const safe = (isNaN(raw) ? 0 : raw);
        const n = Math.max(0, Math.min(500, safe));
        G.settings.flipPrice = n;
        G.settings.flipPriceEnabled = n > 0;
        App.Save.autoSave();
        // 同步翻牌页输入框（防止用户输入超过 500）
        const flipInp = document.getElementById('flipPagePriceInput');
        if (flipInp && parseInt(flipInp.value) !== n) flipInp.value = n;
        // 更新翻牌页提示（不重渲染以免丢失焦点）
        const hint = document.getElementById('flipPagePriceHint');
        if (hint) {
            hint.style.color = n > 0 ? '#ff9500' : '#27ae60';
            hint.innerHTML = n > 0
                ? `✅ 当前定价：每次翻牌粉丝需付 <b>${n}</b> 🍗（你将额外获得 ${n} 🍗）`
                : '🆓 当前翻牌免费（输入 1-500 启用收费）';
        }
        // 同步设置页输入框
        const setInp = document.getElementById('flipPriceInput');
        if (setInp && parseInt(setInp.value) !== n) setInp.value = n;
    },
    sendFlip(idx) {
        const input = document.getElementById('flipInput'+idx);
        const text = input?.value.trim();
        if (!text) return;
        const settings = (G && G.settings) || { flipPrice: 0, flipPriceEnabled: false };
        const price = settings.flipPriceEnabled ? (settings.flipPrice || 0) : 0;
        input.value = '';
        // 玩家获得 = 粉丝付费（玩家设置的价格）
        // 若回复质量高，可触发额外奖励（不影响基础价格）
        const quality = evaluateReply(text);
        const bonus = (price > 0)
            ? (quality === 'heartfelt' ? Math.floor(price * 0.5)
                : quality === 'normal' ? Math.floor(price * 0.2)
                : 0)
            : (quality === 'heartfelt' ? randInt(15, 30)
                : quality === 'normal' ? randInt(5, 15)
                : randInt(1, 5));
        const totalEarn = price + bonus;
        App.Store.updateStats({drumstick: totalEarn});
        if (price > 0) {
            const bonusTxt = bonus > 0 ? `（回复质量高 +${bonus}）` : '';
            this.showNotification(`🍗 +${price}（粉丝付费）${bonusTxt}`, 2500);
        } else {
            this.showNotification(`🍗 +${totalEarn}`);
        }
        // 标记此条已翻牌：加入当日已翻牌集合
        if (!G.flipState) G.flipState = { day: G.game?.day || 1, replied: {} };
        // 如果跨天，重置
        if (G.flipState.day !== (G.game?.day || 1)) {
            G.flipState = { day: G.game?.day || 1, replied: {} };
        }
        G.flipState.replied[idx] = true;
        // 隐藏该条翻牌卡片
        const card = input.closest('.flip-card');
        if (card) {
            card.style.transition = 'opacity 0.3s, transform 0.3s';
            card.style.opacity = '0.3';
            card.style.transform = 'scale(0.98)';
            const btn = card.querySelector('button');
            if (btn) { btn.disabled = true; btn.textContent = '✓ 已翻牌'; btn.style.background = '#999'; btn.style.cursor = 'default'; }
            // 替换为已翻牌标记
            setTimeout(() => {
                const banner = document.createElement('div');
                banner.style.cssText = 'background:#d4edda;color:#155724;padding:8px;border-radius:6px;font-size:12px;text-align:center;margin-top:6px';
                banner.textContent = '✅ 本条已回复，等待明日刷新';
                card.appendChild(banner);
            }, 300);
        }
        App.Save.autoSave();
    },
    renderPocketLive() {
        if (this.liveActive) { this.renderLiveStream(); return; }
        document.getElementById('pocketPage').innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">直播</span></div><div class="live-container"><input class="live-theme-input" id="liveTheme" placeholder="输入直播主题..."><button class="live-start-btn" onclick="App.UI.startLive()">🎥 开始直播</button></div>`;
    },
    startLive() {
        const theme = document.getElementById('liveTheme')?.value.trim();
        if (!theme) { this.showNotification('请输入直播主题'); return; }
        this.liveActive = true;
        const earn = randInt(5,500);
        App.Store.updateStats({drumstick:earn,popularity:2});
        G.game.pocket_fans += randInt(5,30);
        this.renderLiveStream();
    },
    renderLiveStream() {
        const viewerCount = randInt(50,500);
        
        // 扩展直播弹幕NPC词库
        const danmakuLibrary = [
            // 热情弹幕
            '姐姐好美！',
            '太好看了！',
            '哈哈哈',
            '加油加油！',
            '鸡腿安排🍗',
            '好可爱！',
            '美哭啦！',
            '比心❤️',
            '啊啊啊啊！！',
            '天哪！！',
            '太激动了！！',
            '终于看到姐姐了！！',
            '好幸福！！',
            '姐姐我爱死你了！！',
            '太棒了！！',
            // 普通弹幕
            '姐姐好！',
            '今天也好美！',
            '新造型好好看！',
            '这首歌超好听！',
            '舞蹈绝了！',
            '姐姐辛苦了！',
            '支持支持！',
            '永远追随！',
            '今天状态好好！',
            '元气满满！',
            '好想见面！',
            '公演什么时候！',
            // 好奇弹幕
            '姐姐在干嘛呀',
            '这是在哪里呀',
            '今天吃了什么呀',
            '新歌什么时候上呀',
            '下次直播是什么时候',
            '公演票怎么买呀',
            '姐姐住哪里呀',
            '最近在忙什么呀',
            // 调皮弹幕
            '姐姐偷走了我的心',
            '要请我吃饭哦',
            '翻牌翻牌！',
            '抽我抽我！',
            '连我连我！',
            '什么时候开演唱会！',
            // 感动弹幕
            '好感动😭',
            '看哭了！',
            '太暖心了！',
            '姐姐最好了！',
            '好幸福！',
            '被治愈了！',
            // 夸赞弹幕
            '太厉害了！',
            '绝绝子！',
            'yyds!',
            '太完美了！',
            '姐姐最棒！',
            '实力认证！',
            // 互动弹幕
            '学到了学到了',
            '姐姐说得好对',
            '哈哈笑死我了',
            '这也太好笑了吧',
            '姐姐好幽默',
            // 粉丝福利弹幕
            '多发自拍呀',
            '多发日常呀',
            '多开直播呀',
            '可以翻牌吗',
            '能握手吗',
            // 追星弹幕
            '❤️❤️❤️❤️❤️',
            '💖💖💖💖💖',
            '🌟🌟🌟🌟🌟',
            '姐姐是我的光！',
            '永远支持你！',
            '为你打call！',
            // 应援弹幕
            '冲冲冲！',
            '姐姐冲鸭！',
            '势不可挡！',
            '我们最棒！',
            '永远第一！',
        ];
        
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">直播中</span></div>
        <div class="live-container"><div style="background:#ff4757;color:#fff;padding:8px;border-radius:8px;text-align:center;margin-bottom:8px">🔴 直播中 | 👥 ${viewerCount}人观看</div>
        <div class="live-danmaku-area" id="liveDanmakuArea" style="height:200px;overflow-y:auto;background:#000;border-radius:8px;padding:8px;margin-bottom:8px">`;
        
        // 生成初始弹幕
        for (let i=0;i<8;i++) {
            h += `<div class="danmaku"><span class="dm-user">粉丝${randInt(100,999)}：</span>${pick(danmakuLibrary)}</div>`;
        }
        
        h += `</div><div class="chat-input-bar"><input id="liveInput" placeholder="说点什么..." onkeydown="if(event.key==='Enter')App.UI.sendLiveMsg()"><button class="send-btn" onclick="App.UI.sendLiveMsg()">发送</button></div>
        <button class="create-btn" onclick="App.UI.endLive()" style="margin-top:8px;width:100%">结束直播</button></div>`;
        document.getElementById('pocketPage').innerHTML = h;
    },
    sendLiveMsg() {
        const input = document.getElementById('liveInput');
        const text = input?.value.trim();
        if (!text) return;
        input.value = '';
        const earn = randInt(1,20);
        App.Store.updateStats({drumstick:earn,popularity:1});
        const area = document.getElementById('liveDanmakuArea');
        if (area) {
            const msg = document.createElement('div');
            msg.className = 'danmaku';
            msg.innerHTML = `<span style="color:#ff69b4;font-weight:bold">${G.player.name}：</span>${text}`;
            area.appendChild(msg);
            area.scrollTop = area.scrollHeight;
        }
        
        // 扩展直播回复弹幕库
        const fanReplies = [
            // 热情回复
            '太棒了！',
            '哈哈哈！',
            '姐姐说得好！',
            '支持你！',
            '加油加油！',
            '说得对！',
            '好感动😭',
            '太真实了',
            '❤️❤️❤️',
            '这也太好笑了吧',
            '学到了学到了',
            '姐姐好厉害',
            // 普通回复
            '好！',
            '嗯嗯！',
            '知道啦！',
            '哈哈！',
            '好可爱！',
            '厉害！',
            '👍👍👍',
            '收到！',
            'okok！',
            '好好好！',
            // 追星回复
            '姐姐我爱死你了！',
            '永远支持你！',
            '为你打call！',
            '姐姐最棒！',
            '加油冲冲冲！',
            '永远追随！',
            '太感动了！',
            // 互动回复
            '真的吗！',
            '天哪！！',
            '好羡慕！',
            '好好玩！',
            '太有意思了！',
            '学到了！',
            // 撒娇回复
            '姐姐~~',
            '嘿嘿~',
            '好耶！',
            '好开心！',
            '太幸福了！',
            // 好奇回复
            '为什么呀',
            '真的吗',
            '好厉害！',
            '怎么做到的',
            '可以教我吗',
        ];
        
        setTimeout(() => {
            if (area) {
                const reply = document.createElement('div');
                reply.className = 'danmaku';
                reply.innerHTML = `<span class="dm-user">粉丝${randInt(100,999)}：</span>${pick(fanReplies)}`;
                area.appendChild(reply);
                area.scrollTop = area.scrollHeight;
            }
        }, 600);
        setTimeout(() => {
            if (area) {
                const reply2 = document.createElement('div');
                reply2.className = 'danmaku';
                reply2.innerHTML = `<span class="dm-user">粉丝${randInt(100,999)}：</span>${pick(fanReplies)}`;
                area.appendChild(reply2);
                area.scrollTop = area.scrollHeight;
            }
        }, 1200);
    },
    endLive() {
        this.liveActive = false;
        this.showNotification('直播已结束');
        this.renderPocketHome();
    },
    renderPocketShow() {
        document.getElementById('pocketPage').innerHTML = `<div class="app-header"><span class="back-btn" onclick="App.UI.openApp('pocket')">←</span><span class="title">演出</span></div>
        <div style="padding:8px">
            <div class="show-card"><div class="show-title">🎭 排练</div><button class="show-btn" onclick="App.UI.doRehearsal()">开始排练</button></div>
            <div class="show-card"><div class="show-title">🎤 公演</div><button class="show-btn" onclick="App.UI.doPerformance()">参加公演</button></div>
            <div class="show-card"><div class="show-title">🤝 握手会</div><button class="show-btn" onclick="App.UI.openApp('handshake')">参加握手会</button></div>
        </div>`;
    },
    doRehearsal() {
        App.Store.updateStats({skill:2,stress:2,mood:-1});
        this.showNotification('排练完成！💪 实力提升');
    },
    doPerformance() {
        if (G.stats.popularity < 15) { this.showNotification('人气不足15，还不能参加公演'); return; }
        const base = G.stats.skill + randInt(-10,10);
        let grade, detail, effects;
        if (base >= 80) { grade='S'; detail='完美的舞台！'; effects={popularity:8,drumstick:100,mood:5}; }
        else if (base >= 60) { grade='A'; detail='出色的表现！'; effects={popularity:5,drumstick:60,mood:3}; }
        else if (base >= 40) { grade='B'; detail='表现不错'; effects={popularity:3,drumstick:30}; }
        else if (base >= 20) { grade='C'; detail='还需努力'; effects={popularity:1,drumstick:15}; }
        else { grade='D'; detail='表现不佳...'; effects={mood:-5,stress:3}; }
        App.Store.updateStats(effects);
        document.getElementById('showEvalContent').innerHTML = `<div class="show-eval"><div class="show-eval-grade ${grade}">${grade}</div><div class="show-eval-detail">${detail}</div><button class="create-btn" onclick="App.UI.goHome()">返回</button></div>`;
        this.showPage('showEvalPage');
    },

    // ---------- 最佳拍档 ----------
    invitePartner(name, groupKey) {
        const aff = G.memberAffection[name] || 40;
        if (aff < 61) { this.showNotification(`与${name}的好感度需达到「挚友」(61)才能邀请最佳拍档`); return; }
        if (G.bestPartner && G.bestPartner.name === name) { this.showNotification(`${name}已经是你的最佳拍档了！`); return; }
        if (confirm(`邀请${name}成为最佳拍档？确认后本阶段只能与一人组队。`)) {
            G.bestPartner = { name, avatar: '👤', sinceDay: G.game.day };
            G.partnerStageUsed = false;
            this.showNotification(`💞 与${name}结成最佳拍档！`);
            App.Save.autoSave();
        }
    },
    dissolvePartner() {
        if (!G.bestPartner) { this.showNotification('还没有最佳拍档，无需解除'); return; }
        const name = (typeof G.bestPartner === 'string') ? G.bestPartner : G.bestPartner.name;
        if (!confirm(`确定要与 ${name} 解除最佳拍档关系吗？\n\n解除后：\n• 本周期的双人舞台奖励将作废\n• 好感度会下降 20 点（最低 30）\n• 下次需重新邀请才能组队`)) return;
        // 降低好感度
        const cur = G.memberAffection[name] || 50;
        G.memberAffection[name] = Math.max(30, cur - 20);
        // 清空关系
        G.bestPartner = null;
        G.partnerStageUsed = false;
        this.showNotification(`💔 已与 ${name} 解除最佳拍档关系`);
        App.Save.autoSave();
        // 刷新当前页（如果显示的是 profile / affection / pocket）
        try { this.renderProfile(); } catch(e) {}
        try { this.renderAffection(); } catch(e) {}
    },
    startPartnerStage() {
        if (!G.bestPartner) { this.showNotification('还没有最佳拍档'); return; }
        if (G.partnerStageUsed) { this.showNotification('本周期已进行过双人舞台'); return; }
        G.partnerStageUsed = true;
        const earn = randInt(100,300);
        App.Store.updateStats({popularity:10, starlight:5, drumstick:earn});
        this.showNotification(`🎶 与${G.bestPartner.name}的双人舞台大成功！🍗+${earn}`);
        App.Achievements.checkAll();
    },

    // ---------- 移籍 ----------
    checkMoveGroupAvailable() {
        if (G.game.rank <= 7 && G.player.group !== 'SNH48') return 'toHQ';
        if (G.game.rank <= 16 && G.player.group === 'SNH48') return 'toOtherTeam';
        return null;
    },
    renderMoveGroupPanel() {
        const can = this.checkMoveGroupAvailable();
        if (!can) return;
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🚄 移籍选择</span></div><div style="padding:16px">`;
        if (can === 'toHQ') {
            h += `<p style="font-size:14px;margin-bottom:12px">恭喜进入神七！你获得了移籍SNH48本部的机会，保留原队伍。</p>`;
            const teams = Object.keys(App.NPCData.SNH48.teams);
            teams.forEach(t => { h += `<button class="create-btn" onclick="App.Store.moveGroup('SNH48','${t}')" style="margin:4px">移籍 SNH48 Team ${t}</button>`; });
        } else if (can === 'toOtherTeam') {
            h += `<p style="font-size:14px;margin-bottom:12px">你在本部排名优异，可选择更换队伍。</p>`;
            const currentTeam = G.player.team;
            const teams = Object.keys(App.NPCData.SNH48.teams).filter(t => t !== currentTeam);
            teams.forEach(t => { h += `<button class="create-btn" onclick="App.Store.moveGroup('SNH48','${t}')" style="margin:4px">更换至 SNH48 Team ${t}</button>`; });
        }
        h += `<button class="create-btn" onclick="App.UI.goHome()" style="background:#999;margin-top:12px">暂不移籍</button></div>`;
        document.getElementById('settingsPage').innerHTML = h;
        this.showPage('settingsPage');
    },

    // ---------- 档案 ----------
    renderProfile() {
        const s = G.stats;
        const stage = getPersonalityStage();
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">我的档案</span></div><div style="padding:12px">
        <div style="text-align:center;padding:16px;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border-radius:16px;margin-bottom:12px">
            <div style="font-size:36px">${stage.emoji}</div>
            <div style="font-size:20px;font-weight:700">${G.player.name}</div>
            <div style="font-size:13px">${G.player.group} Team ${G.player.team} · ${stage.name}</div>
        </div>`;
        const stats = [
            {label:'⭐人气',key:'popularity',color:'#ff69b4'},
            {label:'💪实力',key:'skill',color:'#3498db'},
            {label:'😊心情',key:'mood',color:'#4cd137'},
            {label:'💎星光',key:'starlight',color:'#9b59b6'},
            {label:'😰压力',key:'stress',color:'#e67e22'},
            {label:'📸绯闻',key:'scandal',color:'#95a5a6'}
        ];
        stats.forEach(st => {
            const v = s[st.key]||0;
            const pct = Math.min(100, Math.floor(v/100*100));
            h += `<div class="stat-row"><span class="stat-label">${st.label}</span><div class="stat-bar"><div class="stat-fill" style="width:${pct}%;background:${st.color}"></div></div><span class="stat-value">${v}</span></div>`;
        });
        h += `<div style="margin-top:12px;font-size:14px">🍗鸡腿：${s.drumstick} | 排名：#${G.game.rank}</div>`;
        if (G.achievements.length) {
            h += `<div style="margin-top:8px;font-weight:600">🏆 成就</div>`;
            G.achievements.forEach(a => h += `<span class="achievement-badge">${a}</span>`);
        }
        if (G.bestPartner) {
            h += `<div style="margin-top:12px;font-weight:600">💞 最佳拍档：${G.bestPartner.name} (自Day${G.bestPartner.sinceDay})</div>
                  ${G.partnerStageUsed ? '<span style="color:#999">(本周期已演出)</span>' : '<button class="best-partner-btn" onclick="App.UI.startPartnerStage()">🎶 双人舞台</button>'}
                  <button class="best-partner-btn" onclick="App.UI.dissolvePartner()" style="background:#ff4757;color:#fff;margin-left:8px">💔 解除拍档</button>`;
        }
        if (this.checkMoveGroupAvailable()) {
            h += `<div style="margin-top:12px"><button class="create-btn" onclick="App.UI.renderMoveGroupPanel()">🚄 移籍/换队</button></div>`;
        }
        h += '</div>';
        document.getElementById('profilePage').innerHTML = h;
    },

    // ---------- 好感度查询 ----------
    renderAffection() {
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">💕 好感度</span></div>
        <div style="flex:1;overflow-y:auto">`;
        
        let hasData = false;
        
        Object.entries(App.NPCData).forEach(([groupKey, groupData]) => {
            const isMyGroup = groupKey === G.player.group;
            h += `<div class="contact-group-title">🏢 ${groupKey}${isMyGroup?' (我的分团)':''}</div>`;
            
            if (groupData.teams) {
                Object.entries(groupData.teams).forEach(([teamName, members]) => {
                    const isMyTeam = isMyGroup && teamName === G.player.team;
                    h += `<div style="font-size:12px;color:${isMyTeam?'#07c160':'#ff69b4'};padding:8px 16px 4px;font-weight:600">Team ${teamName}${isMyTeam?' ★':''}</div>`;
                    
                    members.forEach(name => {
                        hasData = true;
                        const aff = G.memberAffection[name] || 50;
                        const canInvite = aff >= 80;
                        const affColor = aff >= 80 ? '#ff69b4' : aff >= 50 ? '#07c160' : aff >= 30 ? '#ff9500' : '#ff3b30';
                        const affLevel = aff >= 80 ? '亲密' : aff >= 50 ? '友好' : aff >= 30 ? '普通' : '疏远';
                        
                        h += `<div class="affection-item">
                            <div class="affection-avatar">👤</div>
                            <div class="affection-info">
                                <div class="affection-name">${name}</div>
                                <div class="affection-bar-container">
                                    <div class="affection-bar" style="width:${aff}%;background:${affColor}"></div>
                                </div>
                                <div style="display:flex;justify-content:space-between;margin-top:4px">
                                    <span style="font-size:12px;color:#888">${affLevel}</span>
                                    <span style="font-size:14px;font-weight:600;color:${affColor}">${aff}%</span>
                                </div>
                            </div>
                            ${canInvite ? `<button class="affection-invite-btn" onclick="App.UI.inviteBestPartner('${name}')">✨ 邀请</button>` : ''}
                        </div>`;
                    });
                });
            }
        });
        
        if (!hasData) {
            h += '<div class="empty-hint">暂无成员数据</div>';
        }
        
        // 社交圈展示
        App.SocialNetwork.initIfNeeded();
        if (G.socialCircles.length > 0) {
            h += '<div class="contact-group-title" style="background:linear-gradient(135deg,#e8d5b7,#c8a96e);color:#8b7355">🕸️ 关系网</div>';
            G.socialCircles.forEach(c => {
                h += `<div style="padding:8px 16px;font-size:12px;color:#666;border-bottom:1px solid #f0f0f0">
                    <span style="font-weight:600">${c.emoji} ${c.name}</span>
                    <span style="color:#999;margin-left:8px">${c.members.join(' · ')}</span>
                </div>`;
            });
        }
        
        h += `</div>`;
        document.getElementById('affectionPage').innerHTML = h;
    },
    inviteBestPartner(name) {
        if (G.bestPartner) {
            this.showNotification(`你已经和 ${G.bestPartner} 是最佳拍档了`);
            return;
        }
        
        const confirm = window.confirm(`确定邀请 ${name} 成为你的最佳拍档吗？`);
        if (confirm) {
            G.bestPartner = name;
            G.memberAffection[name] = Math.min(100, (G.memberAffection[name] || 50) + 10);
            this.showNotification(`🎉 成功邀请 ${name} 成为最佳拍档！`);
            App.Store.updateStats({popularity: 20, mood: 10});
            this.renderAffection();
        }
    },

    // ---------- 日记本 ----------
    renderDiaryList() {
        App.SocialNetwork.initIfNeeded();
        App.Diary.initIfNeeded();
        const teammates = App.getAllMembers().filter(m => !m.graduate && m.group === G.player.group && m.team === G.player.team);
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">📔 ${G.player.group} Team ${G.player.team} 日记本</span></div>
        <div style="flex:1;overflow-y:auto;padding:12px">
            <div style="background:linear-gradient(135deg,#f5e6d3,#e8d5b7);border-radius:12px;padding:12px;margin-bottom:12px;font-size:12px;color:#8b7355;text-align:center">
                👁️ 偷看成员们的真实想法（每日23:00自动更新）
            </div>`;
        teammates.forEach(m => {
            const pers = App.MemberPersonality.getFor(m.name);
            const entries = App.Diary.getEntries(m.name);
            const latest = entries[0];
            const hasToday = latest && latest.day === G.game.day;
            h += `<div style="background:#fff;border-radius:12px;margin-bottom:10px;overflow:hidden;cursor:pointer" onclick="App.UI.showMemberDiary('${m.name}')">
                <div style="display:flex;align-items:center;padding:12px;gap:10px">
                    <span style="font-size:28px">👧</span>
                    <div style="flex:1">
                        <div style="font-weight:600;font-size:14px;color:#333">${m.name} <span style="font-size:11px;color:#999">${pers.emoji}</span></div>
                        <div style="font-size:11px;color:#999">${entries.length}篇日记</div>
                    </div>
                    <div style="text-align:right">
                        ${hasToday ? '<span style="background:#ff69b4;color:#fff;border-radius:8px;padding:2px 8px;font-size:10px">今日已更新</span>' : '<span style="color:#ccc;font-size:10px">等待更新...</span>'}
                    </div>
                </div>
                ${latest && hasToday ? `<div style="border-top:1px solid #f0f0f0;padding:10px 12px;font-size:12px;color:#666;line-height:1.6;max-height:60px;overflow:hidden">${latest.mood} ${latest.content.substring(0, 80)}${latest.content.length>80?'...':''}</div>` : ''}
            </div>`;
        });
        h += '</div>';
        document.getElementById('diaryPage').innerHTML = h;
    },
    showMemberDiary(name) {
        const entries = App.Diary.getEntries(name);
        const pers = App.MemberPersonality.getFor(name);
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.renderDiaryList()">←</span><span class="title">📔 ${name}的日记</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            <div style="text-align:center;margin-bottom:16px">
                <span style="font-size:40px">👧</span>
                <div style="font-weight:600;font-size:16px">${name}</div>
                <div style="font-size:12px;color:#999">${pers.emoji}</div>
            </div>`;
        if (entries.length === 0) {
            h += '<div style="text-align:center;padding:40px;color:#999">还没有日记哦~</div>';
        } else {
            entries.forEach(e => {
                h += `<div style="background:#fdf8f0;border-left:3px solid #c8a96e;border-radius:0 12px 12px 0;padding:14px;margin-bottom:12px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                        <span style="font-weight:600;font-size:12px;color:#8b7355">Day ${e.day}</span>
                        <span style="font-size:16px">${e.mood||'😐'}</span>
                    </div>
                    <div style="font-size:13px;color:#555;line-height:1.8">${e.content||'今天没什么想记录的...'}</div>
                </div>`;
            });
        }
        h += '</div>';
        document.getElementById('diaryPage').innerHTML = h;
    },

    // ---------- 成员主动性弹窗 ----------
    showProactiveEvent(event) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:20px';
        // 修复：避免任何转义问题，直接用 JSON.stringify 处理数据
        const eventData = {
            member: String(event.member || ''),
            type: String(event.type || ''),
            responded: false,
            text: String(event.text || ''),
            emoji: String(event.emoji || '💬')
        };
        // 用 JSON 序列化保证安全（onclick 字符串用 base64 编码防注入）
        const eventDataB64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(eventData))));
        overlay.innerHTML = [
            '<div style="background:#fff;border-radius:20px;padding:24px;width:100%;max-width:320px;text-align:center">',
            '<div style="font-size:48px;margin-bottom:12px">', eventData.emoji, '</div>',
            '<div style="font-weight:600;font-size:16px;color:#333;margin-bottom:4px">', eventData.member, ' 主动找你</div>',
            '<div style="font-size:13px;color:#666;margin-bottom:20px;line-height:1.6">', eventData.text, '</div>',
            '<div style="display:flex;gap:8px">',
            '<button data-r="', eventDataB64, '" data-c="positive" style="flex:1;padding:12px;border:none;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">积极回应</button>',
            '<button data-r="', eventDataB64, '" data-c="negative" style="flex:1;padding:12px;border:1px solid #ddd;background:#fff;color:#666;border-radius:10px;font-size:13px;cursor:pointer">婉拒</button>',
            '</div></div>'
        ].join('');
        document.getElementById('phoneModals').appendChild(overlay);
        // 事件代理：从 data-r 解码数据，从 data-c 读取选择
        overlay.querySelectorAll('button[data-r]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                try {
                    const b64 = btn.getAttribute('data-r');
                    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
                    const data = JSON.parse(json);
                    const choice = btn.getAttribute('data-c');
                    App.Proactivity.respond(data, choice);
                    App.UI.showNotification(choice === 'positive' ? '好感度 +8' : '好感度 -5');
                } catch (err) {
                    console.error('showProactiveEvent click error:', err);
                }
                overlay.remove();
            });
        });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    },

    // ---------- 私聊泄露 ----------
    showChatLeakNotification(leak) {
        const n = document.getElementById('notification');
        n.innerHTML = `🔍 发现了一段私聊记录！来自 ${leak.members.join(' & ')}`;
        n.style.display = 'block';
        n.style.background = 'linear-gradient(135deg,#ff6b6b,#ff4757)';
        n.style.cursor = 'pointer';
        n.onclick = () => {
            n.style.display = 'none';
            App.UI.openApp('chatleak');
            App.UI.currentLeak = leak;
        };
        setTimeout(() => { if (n.style.background.includes('ff6b6b')) n.style.display = 'none'; }, 5000);
        if (!G.chatLeaks) G.chatLeaks = [];
        G.chatLeaks.push(leak);
        App.Save.autoSave();
    },
    renderChatLeak() {
        const leak = App.UI.currentLeak || (G.chatLeaks?.[G.chatLeaks.length-1]);
        if (!leak) { App.UI.goHome(); return; }
        document.getElementById('chatLeakPage').innerHTML = `<div class="app-header" style="background:#ff4757;border-color:#ff4757"><span class="back-btn" style="color:#fff" onclick="App.UI.goHome()">←</span><span class="title" style="color:#fff">🔍 私聊泄露</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px;background:linear-gradient(180deg,#2d2d2d,#1a1a1a)">
            <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:12px;margin-bottom:12px;text-align:center;color:#ff6b6b;font-size:12px">
                ⚠️ Day ${leak.day} · ${leak.scene} · ${leak.topic}
            </div>
            <div id="leakContent" style="color:#ddd;font-size:13px;line-height:2">
                ${leak.content ? leak.content.split('\\n').map(l => {
                    const colon = l.indexOf(':');
                    if (colon > -1) { const who = l.substring(0,colon); const what = l.substring(colon+1);
                        return `<div style="margin-bottom:8px"><span style="color:#ffb347;font-weight:600">${who}:</span> <span style="color:#ddd">${what}</span></div>`; }
                    return `<div style="color:#888;font-size:12px">${l}</div>`;
                }).join('') : '<div style="text-align:center;color:#888;padding:40px">加载中...</div>'}
            </div>
            <div style="padding:10px;text-align:center">
                <button onclick="App.UI.loadLeakContent()" style="padding:12px 30px;border:none;background:linear-gradient(135deg,#ff4757,#ff6b81);color:#fff;border-radius:20px;font-size:13px;cursor:pointer;font-weight:600">🔄 生成对话内容</button>
            </div>
        </div>`;
        if (!leak.content) this.loadLeakContent(leak);
    },
    async loadLeakContent(leak) {
        if (!leak) leak = App.UI.currentLeak || (G.chatLeaks?.[G.chatLeaks.length-1]);
        if (!leak || leak.content) return;
        await App.ChatLeak.generateContent(leak);
        this.renderChatLeak();
    },

    // ---------- 选举、握手、设置 ----------
    renderElection() {
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🏆 总选举</span></div>`;
        
        const dayInMonth = G.game.day % 30 || 30;
        const daysUntilElection = 30 - dayInMonth;
        const daysUntilFirst = dayInMonth < 10 ? 10 - dayInMonth : (40 - dayInMonth);
        const daysUntilSecond = dayInMonth < 20 ? 20 - dayInMonth : (50 - dayInMonth);
        
        if (!G.electionResults.length) {
            let statusText = '';
            if (dayInMonth < 10) {
                statusText = `距离初报还有 ${10 - dayInMonth} 天`;
            } else if (dayInMonth < 20) {
                statusText = `初报已发布，距离中报还有 ${20 - dayInMonth} 天`;
            } else if (dayInMonth < 30) {
                statusText = `中报已发布，距离最终结果还有 ${30 - dayInMonth} 天`;
            }
            
            h += `<div style="padding:20px">
                <div style="text-align:center;margin-bottom:20px">
                    <div style="font-size:48px;margin-bottom:8px">🏆</div>
                    <div style="font-size:18px;font-weight:600;color:#333">总选举进行中</div>
                </div>
                
                <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px">
                    <div style="font-size:14px;color:#666;margin-bottom:12px">📅 总选时间表</div>
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0">
                        <span>📊 初报（第10天）</span>
                        <span style="color:#ff69b4;font-weight:600">${dayInMonth >= 10 ? '已发布' : daysUntilFirst + '天后'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0">
                        <span>📈 中报（第20天）</span>
                        <span style="color:#ff69b4;font-weight:600">${dayInMonth >= 20 ? '已发布' : daysUntilSecond + '天后'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:8px 0">
                        <span>🏆 最终（第30天）</span>
                        <span style="color:#ffd700;font-weight:600">${daysUntilElection} 天后</span>
                    </div>
                </div>
                
                <div style="text-align:center;color:#888">${statusText}</div>
            </div>`;
        } else {
            const currentVotes = G.electionResults.find(r => r.name === G.player.name)?.votes || 0;
            h += `<div style="text-align:center;padding:16px;background:linear-gradient(135deg,#ffd700,#ff9500);color:#fff">
                <div style="font-size:24px;font-weight:700">🏆 总选举最终结果</div>
                <div style="font-size:48px;font-weight:700">#${G.game.rank}</div>
                <div style="font-size:14px;margin-top:8px">${currentVotes.toLocaleString()} 票</div>
            </div>`;
            
            h += `<div style="padding:12px;background:#f8f8f8;border-bottom:1px solid #eee">
                <div style="font-weight:600;color:#333">📊 排名榜</div>
            </div>`;
            
            G.electionResults.slice(0,10).forEach((r,i) => {
                h += `<div class="election-rank"><span class="election-pos top7">${i+1}</span><span class="election-name">${r.name}${r.name===G.player.name?' ⬅️ 你':''}</span><span class="election-votes">${r.votes.toLocaleString()}票</span></div>`;
            });
            
            h += `<div style="padding:16px">
                <button class="election-participate-btn" onclick="App.UI.goHome()">🏠 返回主页</button>
            </div>`;
        }
        
        document.getElementById('electionPage').innerHTML = h;
    },
    participateElection() {
        const votes = this.calculateVotes();
        const allMembers = App.getAllMembers().filter(m => !m.graduate);
        let rankings = allMembers.map(m => ({ name: m.name, votes: randInt(1000, 50000) }));
        rankings.push({ name: G.player.name, votes: votes });
        rankings.sort((a, b) => b.votes - a.votes);
        G.electionResults = rankings;
        G.game.rank = rankings.findIndex(r => r.name === G.player.name) + 1;
        
        this.showNotification(`📣 总选举投票完成！你获得了 ${votes.toLocaleString()} 票，排名第 ${G.game.rank} 名`);
        App.Store.updateStats({popularity: 5});
        this.renderElection();
    },
    renderHandshake() {
        const types = [
            {icon:'🌟',type:'纯粉',desc:'真心支持你的粉丝',choices:['热情回应','微笑点头'],effects:[{drumstick:30,mood:2},{drumstick:10}]},
            {icon:'😤',type:'毒粉',desc:'看起来不太友好的粉丝',choices:['保持冷静','冷脸应对'],effects:[{mood:-2},{mood:-5,scandal:5}]},
            {icon:'📸',type:'拍照粉',desc:'拿着手机一直拍你的粉丝',choices:['配合拍照','婉拒拍摄'],effects:[{popularity:3,drumstick:20},{drumstick:5}]},
            {icon:'💝',type:'礼物粉',desc:'送了你小礼物的粉丝',choices:['开心收下','婉拒贵重礼物'],effects:[{mood:5,drumstick:25},{popularity:2,mood:3}]},
            {icon:'🤳',type:'直播粉',desc:'正在直播跟你握手的粉丝',choices:['对着镜头打招呼','低调握手'],effects:[{popularity:5,drumstick:15},{drumstick:10}]},
            {icon:'😭',type:'泪粉',desc:'激动到哭的粉丝',choices:['温柔安慰','给她签名'],effects:[{mood:3,drumstick:25},{popularity:3,drumstick:20}]},
            {icon:'🧐',type:'好奇粉',desc:'问你私人问题的粉丝',choices:['礼貌回避','幽默化解'],effects:[{mood:-1,scandal:3},{scandal:1}]},
            {icon:'⭐',type:'应援粉',desc:'举着大幅应援牌的粉丝',choices:['表示感谢','挥手互动'],effects:[{popularity:5,mood:3},{popularity:3,drumstick:15}]}
        ];
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🤝 握手会</span></div><div style="padding:8px">`;
        types.forEach((t,i) => {
            h += `<div class="handshake-item"><div class="handshake-icon">${t.icon}</div><div class="handshake-info"><div class="handshake-type">${t.type}粉丝</div><div class="handshake-desc">${t.desc}</div></div><div class="handshake-choices">${t.choices.map((c,ci)=>`<button class="handshake-btn" onclick="App.UI.handleHandshake(${i},${ci})">${c}</button>`).join('')}</div></div>`;
        });
        h += '</div>';
        document.getElementById('handshakePage').innerHTML = h;
    },
    handleHandshake(typeIdx, choiceIdx) {
        const types = [
            {effects:[{drumstick:30,mood:2},{drumstick:10}]},
            {effects:[{mood:-2},{mood:-5,scandal:5}]},
            {effects:[{popularity:3,drumstick:20},{drumstick:5}]},
            {effects:[{mood:5,drumstick:25},{popularity:2,mood:3}]},
            {effects:[{popularity:5,drumstick:15},{drumstick:10}]},
            {effects:[{mood:3,drumstick:25},{popularity:3,drumstick:20}]},
            {effects:[{mood:-1,scandal:3},{scandal:1}]},
            {effects:[{popularity:5,mood:3},{popularity:3,drumstick:15}]}
        ];
        const effects = types[typeIdx]?.effects?.[choiceIdx] || {};
        App.Store.updateStats(effects);
        this.showNotification('握手完成');
    },
    renderOutdoor() {
        if (G.physical === undefined) G.physical = 80;
        if (G.mental === undefined) G.mental = 75;
        if (G.fatigue === undefined) G.fatigue = 0;
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🚗 外出</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;padding:20px;border-radius:16px;margin-bottom:16px;text-align:center">
                <div style="font-size:14px;margin-bottom:8px">💰 微信支付余额</div>
                <div style="font-size:32px;font-weight:700">¥${(G.stats.wechatBalance||0).toLocaleString()}</div>
                <div style="font-size:12px;opacity:0.8;margin-top:4px">压力:${G.stats.stress} 身体:${G.physical}</div>
            </div>
            
            <!-- 身体恢复 -->
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px">
                <div style="font-size:15px;font-weight:600;margin-bottom:4px">💪 身体恢复</div>
                <div style="font-size:11px;color:#999;margin-bottom:10px">身体${G.physical} · 疲劳${G.fatigue} · 心态${G.mental}</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button onclick="App.UI.doOutdoorRest('sleep')" style="padding:12px;background:#4caf50;color:#fff;border:none;border-radius:8px;cursor:pointer">😴 好好睡觉 (疲劳-25 身体+12)</button>
                    <button onclick="App.UI.doOutdoorRest('stroll')" style="padding:12px;background:#8bc34a;color:#fff;border:none;border-radius:8px;cursor:pointer">🚶 公园散步 (疲劳-20 心态+15)</button>
                    <button onclick="App.UI.doOutdoorRest('eat')" style="padding:12px;background:#ff9800;color:#fff;border:none;border-radius:8px;cursor:pointer">🍜 吃顿好的 ¥60 (疲劳-10 身体+15)</button>
                    <button onclick="App.UI.doOutdoorRest('game')" style="padding:12px;background:#e91e63;color:#fff;border:none;border-radius:8px;cursor:pointer">🎮 打游戏 (疲劳-15 心态+20)</button>
                </div>
            </div>
            
            <div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:16px">
                <div style="font-size:15px;font-weight:600;margin-bottom:12px">🧘 放松减压</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button onclick="App.UI.reduceStress('massage')" style="padding:12px;background:#27ae60;color:#fff;border:none;border-radius:8px;cursor:pointer">💆 按摩 ¥80 (压力-15)</button>
                    <button onclick="App.UI.reduceStress('movie')" style="padding:12px;background:#3498db;color:#fff;border:none;border-radius:8px;cursor:pointer">🎬 看电影 ¥50 (压力-10)</button>
                    <button onclick="App.UI.reduceStress('spa')" style="padding:12px;background:#9b59b6;color:#fff;border:none;border-radius:8px;cursor:pointer">🛁 SPA ¥150 (压力-25 疲劳-35)</button>
                    <button onclick="App.UI.reduceStress('cafe')" style="padding:12px;background:#e67e22;color:#fff;border:none;border-radius:8px;cursor:pointer">☕ 咖啡厅 ¥30 (压力-5)</button>
                </div>
            </div>

            <!-- 高消费 / 奢华享受 -->
            <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:16px;margin-bottom:16px;color:#fff">
                <div style="font-size:15px;font-weight:600;margin-bottom:4px">💎 奢华享受</div>
                <div style="font-size:11px;color:#aaa;margin-bottom:10px">高消费选项：花钱多但能大幅改善状态</div>
                <div style="display:flex;flex-direction:column;gap:8px">
                    <button onclick="App.UI.luxurySpend('finedining')" style="padding:12px;background:linear-gradient(135deg,#f39c12,#e74c3c);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">🍽️ 米其林餐厅 ¥800 (心情+25 压力-15 体力+10)</button>
                    <button onclick="App.UI.luxurySpend('shopping')" style="padding:12px;background:linear-gradient(135deg,#e84393,#fd79a8);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">🛍️ 奢侈品购物 ¥1500 (心情+30 压力-20)</button>
                    <button onclick="App.UI.luxurySpend('medicalBeauty')" style="padding:12px;background:linear-gradient(135deg,#00b894,#00cec9);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">💉 医美护理 ¥2000 (体力+25 心情+20)</button>
                    <button onclick="App.UI.luxurySpend('privateYoga')" style="padding:12px;background:linear-gradient(135deg,#6c5ce7,#a29bfe);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">🧘‍♀️ 私教瑜伽 ¥600 (疲劳-30 心态+25 压力-10)</button>
                    <button onclick="App.UI.luxurySpend('travel')" style="padding:12px;background:linear-gradient(135deg,#0984e3,#74b9ff);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">✈️ 周末短途游 ¥3000 (压力-40 体力+20 心情+30)</button>
                    <button onclick="App.UI.luxurySpend('concert')" style="padding:12px;background:linear-gradient(135deg,#e17055,#fdcb6e);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600">🎤 VIP 演唱会 ¥1200 (心情+35 压力-25)</button>
                </div>
            </div>
        </div>`;
        document.getElementById('outdoorPage').innerHTML = h;
    },
    doOutdoorRest(type) {
        const result = App.Training.rest(type);
        if (result?.blocked) {
            this.showNotification(`💰 余额不足！需要¥${result.need}`, 2500);
            return;
        }
        this.showNotification(`🛌 ${result?.desc || '已休息'} · 疲劳:${result.fatigue}`, 2000);
        this.renderOutdoor();
    },
    reduceStress(type) {
        const costs = {massage:80, movie:50, spa:150, cafe:30};
        const stressReduce = {massage:15, movie:10, spa:25, cafe:5};
        const cost = costs[type];
        const reduce = stressReduce[type];
        if (G.stats.wechatBalance < cost) { this.showNotification('余额不足'); return; }
        App.Store.updateStats({wechatBalance:-cost, stress:-reduce, mood:3});
        // SPA 额外恢复疲劳和身体
        if (type === 'spa' && G.fatigue !== undefined) {
            G.fatigue = Math.max(0, G.fatigue - 35);
            G.physical = Math.min(100, G.physical + 12);
        }
        this.showNotification(`放松完成，压力-${reduce}，心情+3`);
        this.renderOutdoor();
    },
    luxurySpend(type) {
        // 高消费选项配置
        const cfg = {
            finedining:    {cost:800,  mood:25, stress:-15, physical:10, desc:'🍽️ 米其林餐厅'},
            shopping:      {cost:1500, mood:30, stress:-20, physical:0,  desc:'🛍️ 奢侈品购物'},
            medicalBeauty: {cost:2000, mood:20, stress:0,   physical:25, desc:'💉 医美护理'},
            privateYoga:   {cost:600,  mood:0,  stress:-10, physical:0,  desc:'🧘‍♀️ 私教瑜伽', fatigue:-30, mental:25},
            travel:        {cost:3000, mood:30, stress:-40, physical:20, desc:'✈️ 周末短途游'},
            concert:       {cost:1200, mood:35, stress:-25, physical:0,  desc:'🎤 VIP 演唱会'}
        };
        const c = cfg[type];
        if (!c) return;
        if ((G.stats.wechatBalance || 0) < c.cost) {
            this.showNotification(`💰 余额不足！${c.desc}需要 ¥${c.cost}（当前 ¥${G.stats.wechatBalance || 0}）`, 2500);
            return;
        }
        const updates = {wechatBalance: -c.cost};
        if (c.mood) updates.mood = c.mood;
        if (c.stress) updates.stress = c.stress;
        if (c.physical) updates.skill = c.physical;  // 体力→通过 skill 字段增长（见 G.stats）
        App.Store.updateStats(updates);
        // 物理属性
        if (G.physical !== undefined && c.physical) G.physical = Math.min(100, G.physical + c.physical);
        if (G.fatigue !== undefined && c.fatigue) G.fatigue = Math.max(0, G.fatigue + c.fatigue);
        if (G.mental !== undefined && c.mental) G.mental = Math.min(100, G.mental + c.mental);
        this.showNotification(`${c.desc} 完成！花费 ¥${c.cost}`, 2500);
        App.Save.autoSave();
        this.renderOutdoor();
    },
    exchangeDrumstickFromPocket() {
        const input = document.getElementById('pocketDrumstickExchange');
        const amount = parseInt(input?.value);
        if (!amount || amount < 10) { this.showNotification('至少需要10鸡腿'); return; }
        if (G.stats.drumstick < amount) { this.showNotification('鸡腿不足'); return; }
        const exchangeAmount = Math.floor(amount / 10);
        const remainingDrumstick = G.stats.drumstick - amount;
        App.Store.updateStats({drumstick:-amount, wechatBalance:exchangeAmount});
        this.showNotification(`✅ 成功兑换 ¥${exchangeAmount}，剩余鸡腿: ${remainingDrumstick}`);
        input.value = '';
        this.renderPocketHome();
    },
    renderSettings() {
        const soundEnabled = App.Sound.enabled;
        const cloudStatus = App.Save.getCloudStatus();
        const netStatus = App.Network.status;
        const netIcon = { online: '🟢', degraded: '🟡', offline: '🔴', unknown: '⚪' };
        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">⚙️ 设置</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">💾 本地存档</div>
                <button onclick="App.Save.exportJSON()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
                    <span style="font-size:20px">📤</span><span style="flex:1">导出存档</span><span style="color:#999">→</span>
                </button>
                <label style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0">
                    <span style="font-size:20px">📥</span><span style="flex:1">导入存档</span><span style="color:#999">→</span>
                    <input type="file" onchange="App.Save.importJSON(this.files[0])" style="display:none">
                </label>
            </div>

            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">☁️ 云存档</div>
                <div id="cloudSaveInfo" style="padding:12px 16px;font-size:12px;color:#999;background:#f8f9fa;min-height:36px">
                    正在连接云端...
                </div>
                <button onclick="App.Save.cloudUpload()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
                    <span style="font-size:20px">☁️</span><span style="flex:1">上传至云端</span><span style="color:#999">↑</span>
                </button>
                <button onclick="App.Save.cloudDownload()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0">
                    <span style="font-size:20px">⬇️</span><span style="flex:1">从云端恢复</span><span style="color:#999">↓</span>
                </button>
                <button onclick="App.Save.cloudForceSync()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0">
                    <span style="font-size:20px">⚡</span><span style="flex:1">强制同步（应对网络波动）</span><span style="color:#ff9500;font-size:11px">多重重试</span>
                </button>
                <button onclick="App.Save.cloudDelete()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0;color:#ff4757">
                    <span style="font-size:20px">🗑️</span><span style="flex:1">删除云端存档</span><span style="color:#ff4757">✕</span>
                </button>
            </div>

            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">🔍 网络诊断</div>
                <div id="networkDiagInfo" style="padding:12px 16px;font-size:12px;color:#999;background:#f8f9fa;min-height:36px">
                    ${netIcon[netStatus] || '⚪'} 网络状态：${netStatus === 'online' ? '已连接' : netStatus === 'degraded' ? '不稳定' : netStatus === 'offline' ? '已断开' : '检测中...'}
                </div>
                <button onclick="App.UI.runNetworkDiagnosis()" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px">
                    <span style="font-size:20px">🩺</span><span style="flex:1">运行网络诊断</span><span style="color:#999">→</span>
                </button>
                <button onclick="App.Network.checkNow().then(r => {App.UI.renderSettings(); if(!r.apiReachable) App.UI.showNotification('⚠️ API 不可达: ' + r.detail, 4000); else App.UI.showNotification('✅ ' + r.detail, 2500);})" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0">
                    <span style="font-size:20px">🔗</span><span style="flex:1">快速连接检测</span><span style="color:#999">→</span>
                </button>
            </div>
            
            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">🔊 音效设置</div>
                <div style="padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="App.Sound.toggle();App.UI.renderSettings()">
                    <span style="font-size:20px">${soundEnabled?'🔔':'🔕'}</span>
                    <span style="flex:1;font-size:14px">音效开关</span>
                    <div style="width:50px;height:28px;border-radius:14px;background:${soundEnabled?'#07c160':'#ccc'};position:relative;transition:.3s">
                        <div style="width:24px;height:24px;background:#fff;border-radius:50%;position:absolute;top:2px;${soundEnabled?'right:2px':'left:2px'};transition:.3s"></div>
                    </div>
                </div>
                <div style="padding:14px;font-size:12px;color:#999;border-top:1px solid #f0f0f0">
                    当前状态：${soundEnabled?'已开启' :'已关闭'}
                </div>
            </div>

            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">💸 翻牌价格设置</div>
                <div style="padding:12px 14px;background:#fff8e1;font-size:12px;color:#856404;border-bottom:1px solid #f0f0f0;line-height:1.5">
                    💡 翻牌页顶部已提供输入框，<b>直接输入价格更便捷</b>。
                </div>
                <button onclick="App.UI.openApp('pocket');setTimeout(()=>App.UI.renderPocketFlip(),100);" style="width:100%;padding:14px;border:none;background:#fff;text-align:left;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:12px;border-top:1px solid #f0f0f0">
                    <span style="font-size:20px">🎴</span><span style="flex:1">前往翻牌页设置</span><span style="color:#999">→</span>
                </button>
                <div style="padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer;border-top:1px solid #f0f0f0" onclick="App.UI.toggleFlipPrice()">
                    <span style="font-size:20px">${(G.settings && G.settings.flipPriceEnabled) ? '💰' : '🆓'}</span>
                    <span style="flex:1;font-size:14px">启用翻牌收费</span>
                    <div style="width:50px;height:28px;border-radius:14px;background:${(G.settings && G.settings.flipPriceEnabled) ? '#ff9500' : '#ccc'};position:relative;transition:.3s">
                        <div style="width:24px;height:24px;background:#fff;border-radius:50%;position:absolute;top:2px;${(G.settings && G.settings.flipPriceEnabled) ? 'right:2px' : 'left:2px'};transition:.3s"></div>
                    </div>
                </div>
                <div style="padding:14px;display:flex;align-items:center;gap:8px;border-top:1px solid #f0f0f0">
                    <span style="font-size:14px;flex:1">每次翻牌价格（🍗鸡腿）<br><span style="font-size:11px;color:#999">0-500 鸡腿</span></span>
                    <input id="flipPriceInput" type="number" min="0" max="500" value="${(G.settings && G.settings.flipPrice) || 0}" style="width:80px;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:14px;text-align:center" onchange="App.UI.setFlipPrice(this.value)" onkeyup="App.UI.setFlipPrice(this.value)">
                </div>
                <div style="padding:0 14px 14px;font-size:12px;color:#999;line-height:1.6">
                    ${(G.settings && G.settings.flipPriceEnabled)
                        ? `✅ 已启用：粉丝每次翻牌需付 <b style="color:#ff9500">${(G.settings && G.settings.flipPrice) || 0}</b> 🍗（你获得基础收益 + 付费）`
                        : '🆓 当前翻牌免费（粉丝无需付费，你仅获得基础收益）'
                    }
                </div>
            </div>
            
            <div style="background:#fff;border-radius:16px;overflow:hidden;margin-bottom:16px">
                <div style="padding:16px;font-size:14px;font-weight:600;color:#333;border-bottom:1px solid #f0f0f0">🎮 游戏数据</div>
                <div style="padding:14px;font-size:13px;color:#666;line-height:1.8">
                    <div>游戏天数：第 ${G.game.day} 天</div>
                    <div>人气值：${G.stats.popularity}</div>
                    <div>压力值：${G.stats.stress}</div>
                    <div>心情值：${G.stats.mood}</div>
                </div>
            </div>
            
            <button onclick="App.UI.restartGame()" style="width:100%;padding:14px;background:#ff4757;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer">
                🔄 重新开始游戏
            </button>
            
            <div style="text-align:center;margin-top:20px;font-size:12px;color:#999">
                48SNH模拟器 v1.0
            </div>
        </div>`;
        document.getElementById('settingsPage').innerHTML = h;

        // 异步加载云端存档信息
        App.Save.cloudInfo().then(info => {
            const el = document.getElementById('cloudSaveInfo');
            if (el) {
                if (info.exists) {
                    const time = info.saved_at ? new Date(info.saved_at).toLocaleString() : '未知';
                    el.innerHTML = `<div>☁️ ${info.player_name || '未命名'} | 第${info.game_day}天 | ${time}</div><div style="font-size:10px;color:#999;margin-top:2px">上次同步：${cloudStatus.synced ? cloudStatus.ago : '从未'}</div>`;
                    el.style.color = '#27ae60';
                } else if (info.message) {
                    el.innerHTML = info.message;
                    el.style.color = '#e67e22';
                } else {
                    el.innerHTML = '暂无云端存档，点击上方按钮上传';
                    el.style.color = '#999';
                }
            }
        }).catch(() => {
            const el = document.getElementById('cloudSaveInfo');
            if (el) { el.innerHTML = '⚠️ 无法连接云端服务器，请检查网络或运行诊断'; el.style.color = '#ff4757'; }
        });
    },
    restartGame() {
        if (!confirm('确定重新开始？这将清除所有本地存档，无法恢复！')) return;
        // 清除所有 localStorage
        localStorage.removeItem('inviteCode');
        localStorage.removeItem('inviteUserId');
        localStorage.removeItem('starlight48_save');
        localStorage.removeItem('starlight48_cloud_token');
        // 重置 App.Invite 状态
        App.Invite.inviteCode = null;
        App.Invite.userId = null;
        // 重置游戏状态
        Object.assign(G, {
            player: { name:'', appearance:'', personality:'', personalityEmoji:'', group:'', team:'', stage:'练习生' },
            stats: { popularity:10, skill:10, mood:70, affection:50, starlight:10, stress:10, scandal:0, drumstick:0, wechatBalance:0, backpack:{}, agent_satisfaction:50, training:0 },
            game: { day:1, phase:'morning', interaction_count:0, rank:150, weibo_followers:100, pocket_fans:50, handshake_this_month:false, fan_letters_this_week:0, electionInProgress:false, electionPhase:null, firstReportVotes:0, secondReportVotes:0, firstReportPulls:0, secondReportPulls:0 },
            flags: { hasFirstShow:false, hasFirstElection:false, hasStalker:false, hasCenterBattle:false, hasCrisis:false, hasEmo:false, hasZeroStress:false, hasMoved:false },
            achievements: [], chatHistory: {}, weiboPosts: [], moments: [], smsMessages: [], callHistory: [], fanLetters: [], electionResults: [],
            memberAffection: {}, blockedContacts: [], pocketRoomMessages: [], bestPartner: null, partnerStageUsed: false,
            settings: { flipPrice: 0, flipPriceEnabled: false },
            flipState: { day: 1, replied: {} }
        });
        App.Save.autoSave();
        // 显示邀请码页面，重新验证
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('inviteScreen').classList.add('active');
        document.getElementById('bottomNav').style.display = 'none';
        this.showNotification('🔄 存档已清除，请重新输入邀请码');
    },

    async runNetworkDiagnosis() {
        this.showNotification('🩺 正在运行网络诊断...', 4000);
        const el = document.getElementById('networkDiagInfo');
        if (el) { el.innerHTML = '🔄 诊断中...'; el.style.color = '#3498db'; }

        try {
            const report = await App.Network.diagnose();

            // 构建详细报告 HTML
            const statusIcon = { healthy: '✅', partial: '⚠️', offline: '🔴', unreachable: '❌' };
            const statusText = { healthy: '一切正常', partial: '部分异常', offline: '设备离线', unreachable: '无法连接服务器' };

            let detailHtml = `<div style="font-weight:600;margin-bottom:4px">${statusIcon[report.overall] || '❓'} ${statusText[report.overall] || '未知'}</div>`;
            detailHtml += `<div style="font-size:11px;line-height:1.6">`;
            detailHtml += `设备网络：${report.browserOnline ? '✅ 已连接' : '❌ 未连接'}<br>`;
            if (report.health) {
                const aiOk = report.health.ai_configured ? '✅ 已配置' : '⚠️ 未配置';
                detailHtml += `API 状态：${report.health.status || '未知'} | AI: ${aiOk}<br>`;
            } else {
                detailHtml += `API 状态：❌ ${report.healthError || '不可达'}<br>`;
            }
            if (report.chatTest) {
                detailHtml += `聊天端点：${report.chatTest.status === 200 ? '✅' : '⚠️'} HTTP ${report.chatTest.status} (${report.chatTest.latency})<br>`;
            } else {
                detailHtml += `聊天端点：❌ ${report.chatError || '不可达'}<br>`;
            }
            detailHtml += `目标服务器：${report.apiUrl}`;
            detailHtml += `</div>`;

            if (el) {
                el.innerHTML = detailHtml;
                el.style.color = report.overall === 'healthy' ? '#27ae60' : report.overall === 'partial' ? '#e67e22' : '#ff4757';
            }

            // 弹窗显示完整报告
            const summary = `网络诊断完成：${statusText[report.overall]}\n\n` +
                `设备在线：${report.browserOnline ? '是' : '否'}\n` +
                `API 健康：${report.health ? '正常' : report.healthError || '不可达'}\n` +
                `聊天测试：${report.chatTest ? 'HTTP ' + report.chatTest.status : report.chatError || '失败'}\n` +
                `服务器：${report.apiUrl}`;
            alert(summary);
        } catch (e) {
            if (el) { el.innerHTML = `❌ 诊断失败: ${e.message}`; el.style.color = '#ff4757'; }
            this.showNotification('❌ 网络诊断执行失败', 3500);
        }
    },

    showPhoneNotification(appName, title, text, type) {
        const container = document.getElementById('phoneNotifContainer');
        const id = 'notif_' + Date.now();
        const iconMap = {hater:'😈',wechat:'💬',sms:'📱',call:'📞',weibo:'📷',pocket:'🎬'};
        const icon = iconMap[type] || '🔔';
        const el = document.createElement('div');
        el.className = 'phone-notif-item';
        el.id = id;
        el.innerHTML = `<div class="phone-notif-icon">${icon}</div><div class="phone-notif-body"><div class="phone-notif-app">${appName}</div><div class="phone-notif-title">${title}</div><div class="phone-notif-text">${text}</div></div><div class="phone-notif-close" onclick="this.parentElement.remove()">✕</div>`;
        container.appendChild(el);
        requestAnimationFrame(() => { el.classList.add('show'); });
        setTimeout(() => { el.remove(); }, 5000);
        App.Sound.play('Notif');
    },

    // ============ V4 训练页面 ============
    renderTraining() {
        App.Training; // 确保模块已加载
        if (!G.trainingSkills) G.trainingSkills = { dance:10, vocal:10, performance:10, variety:5 };
        if (G.physical === undefined) G.physical = 80;
        if (G.mental === undefined) G.mental = 75;
        if (G.fatigue === undefined) G.fatigue = 0;

        const suggestion = App.Training.getSuggestion();
        const skills = [
            { id:'dance', name:'💃 舞蹈', val: G.trainingSkills.dance, color:'#e74c3c' },
            { id:'vocal', name:'🎤 歌唱', val: G.trainingSkills.vocal, color:'#9b59b6' },
            { id:'performance', name:'🎭 表现力', val: G.trainingSkills.performance, color:'#f39c12' },
            { id:'variety', name:'📺 综艺', val: G.trainingSkills.variety, color:'#3498db' }
        ];

        let skillBars = skills.map(s => {
            const path = G.trainingTree?.[s.id]?.path || '';
            const pathInfo = App.Training.branches[s.id]?.paths?.[path];
            const pathLabel = pathInfo ? ` · ${pathInfo.emoji}${pathInfo.name}` : '';
            return `<div style="margin-bottom:10px" onclick="App.Training.showBranchDetail('${s.id}')">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
                    <span>${s.name}${pathLabel}</span><span style="color:${s.color};font-weight:600">${s.val}</span>
                </div>
                <div class="stat-bar"><div class="stat-fill" style="width:${s.val}%;background:linear-gradient(90deg,${s.color},${s.color}88)"></div></div>
            </div>`;
        }).join('');

        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">💪 训练中心</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            <!-- 身体状态 -->
            <div style="display:flex;gap:8px;margin-bottom:16px">
                <div style="flex:1;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:12px;padding:12px;text-align:center">
                    <div style="font-size:24px">${G.physical > 60 ? '💪' : G.physical > 30 ? '😐' : '🤒'}</div>
                    <div style="font-size:11px;color:#666">身体 ${G.physical}</div>
                    <div class="stat-bar" style="margin-top:4px"><div class="stat-fill" style="width:${G.physical}%;background:#4caf50"></div></div>
                </div>
                <div style="flex:1;background:linear-gradient(135deg,#e8eaf6,#c5cae9);border-radius:12px;padding:12px;text-align:center">
                    <div style="font-size:24px">${G.mental > 60 ? '😊' : G.mental > 30 ? '😟' : '😵'}</div>
                    <div style="font-size:11px;color:#666">心态 ${G.mental}</div>
                    <div class="stat-bar" style="margin-top:4px"><div class="stat-fill" style="width:${G.mental}%;background:#3f51b5"></div></div>
                </div>
                <div style="flex:1;background:linear-gradient(135deg,#fff3e0,#ffe0b2);border-radius:12px;padding:12px;text-align:center">
                    <div style="font-size:24px">${G.fatigue > 75 ? '😫' : G.fatigue > 40 ? '😑' : '⚡'}</div>
                    <div style="font-size:11px;color:#666">疲劳 ${G.fatigue}</div>
                    <div class="stat-bar" style="margin-top:4px"><div class="stat-fill" style="width:${G.fatigue}%;background:#ff9800"></div></div>
                </div>
            </div>

            ${suggestion ? `<div style="background:${suggestion.action==='rest'?'#fff3cd':'#d4edda'};border:1px solid ${suggestion.action==='rest'?'#ffc107':'#28a745'};border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:12px">
                ${suggestion.action==='rest'?'⚠️':'💡'} <b>建议：</b>${suggestion.msg}${suggestion.risk?`<br/><span style="color:#e74c3c">⚠️ ${suggestion.risk}</span>`:''}
            </div>` : ''}

            <!-- 技能树 -->
            <div style="background:#fff;border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:10px">📈 技能树</div>
                ${skillBars}
            </div>

            <!-- 训练按钮 -->
            <div style="background:#fff;border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:10px">🏋️ 开始训练</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                    ${['dance','vocal','performance','variety'].map(b => {
                        const br = App.Training.branches[b];
                        return `<button onclick="App.UI.doTraining('${b}')" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,var(--c1),var(--c2));color:#fff;font-size:13px;cursor:pointer"
                            ${b==='dance'?'style="background:linear-gradient(135deg,#e74c3c,#c0392b)"':
                              b==='vocal'?'style="background:linear-gradient(135deg,#9b59b6,#8e44ad)"':
                              b==='performance'?'style="background:linear-gradient(135deg,#f39c12,#e67e22)"':
                              'style="background:linear-gradient(135deg,#3498db,#2980b9)"'}>
                            ${br.icon} ${br.name}
                        </button>`;
                    }).join('')}
                </div>
            </div>

            <!-- 深夜加练 -->
            <div style="background:#fff;border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:4px">🌙 深夜加练</div>
                <div style="font-size:11px;color:#999;margin-bottom:10px">独自练习，可能偶遇同样努力的队友（40%概率）</div>
                <button onclick="App.UI.doSecretTrain()" style="width:100%;padding:14px;border:none;border-radius:10px;background:linear-gradient(135deg,#2d3436,#636e72);color:#fff;font-size:14px;cursor:pointer">
                    🌙 偷偷加练
                </button>
            </div>
        </div>`;
        document.getElementById('trainingPage').innerHTML = h;
    },

    doTraining(branchId) {
        const intensities = [
            { id:'light', label:'轻松练习 (30%)' },
            { id:'normal', label:'正常训练 (60%)' },
            { id:'heavy', label:'高强度 (100%)' },
            { id:'extreme', label:'极限挑战 (150% ⚠️)' }
        ];
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `<div class="event-card" style="max-width:320px;padding:20px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">${App.Training.branches[branchId]?.icon}</div>
            <div style="font-size:16px;font-weight:600;margin-bottom:16px">选择训练强度</div>
            ${intensities.map(i => `
                <button onclick="document.querySelector('.modal-overlay')?.remove();App.UI.executeTraining('${branchId}','${i.id}')"
                    style="width:100%;padding:12px;margin-bottom:6px;border:none;border-radius:8px;background:${i.id==='extreme'?'linear-gradient(135deg,#e74c3c,#c0392b)':'#f5f5f5'};color:${i.id==='extreme'?'#fff':'#333'};font-size:13px;cursor:pointer">
                    ${i.label}${i.id==='extreme'?' ⚠️ 高风险受伤':''}
                </button>
            `).join('')}
            <button onclick="document.querySelector('.modal-overlay')?.remove()" style="width:100%;padding:10px;margin-top:4px;border:none;background:none;color:#999;font-size:13px;cursor:pointer">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },

    executeTraining(branchId, intensity) {
        const result = App.Training.train(branchId, intensity);
        if (result.injury) {
            this.showNotification(`🤕 训练过度导致受伤！身体-15 心态-10`, 4000);
        }
        this.showNotification(`✅ ${App.Training.branches[branchId]?.name} +${result.skillGain} | 疲劳:${result.fatigue}`, 2500);
        this.renderTraining();
    },

    doSecretTrain() {
        if (G.fatigue > 85) {
            this.showNotification('😫 太累了！先休息吧', 2500);
            return;
        }
        const result = App.Training.secretTrain();
        if (result.blocked) {
            this.showNotification(result.reason, 2500);
            return;
        }
        let msg = `🌙 深夜加练！${App.Training.branches[result.branch]?.name}+${result.gain}`;
        if (result.encounter) {
            msg += `\n💫 偶遇${result.encounter.member}！${result.encounter.text}`;
            this.showNotification(msg, 5000);
        } else {
            this.showNotification(msg, 2500);
        }
        this.renderTraining();
    },

    // ============ V4 舞台/公演页面 ============
    renderStage() {
        if (!G.stageHistory) G.stageHistory = [];
        if (!G.partnerSynergy) G.partnerSynergy = {};
        if (!G.partnerShows) G.partnerShows = [];

        const teammates = App.getTeamMates(G.player.group, G.player.team);
        const lastShow = G.stageHistory.length > 0 ? G.stageHistory[G.stageHistory.length - 1] : null;

        // 搭档列表
        let partnerList = '';
        if (teammates.length > 0) {
            partnerList = teammates.slice(0, 5).map(t => {
                const syn = App.Stage.partnerSynergy.calcSynergy(t.name);
                const synLabel = syn > 80 ? '🔥绝配' : syn > 60 ? '⭐很好' : syn > 40 ? '👍不错' : syn > 20 ? '🤝一般' : '💤生疏';
                const pers = App.MemberPersonality.getFor(t.name);
                return `<div onclick="App.UI.doStageWith('${t.name}')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8f9fa;border-radius:10px;cursor:pointer;margin-bottom:6px">
                    <span style="font-size:18px">${pers.emoji}</span>
                    <span style="flex:1;font-size:13px">${t.name}</span>
                    <span style="font-size:11px;color:#e74c3c">${synLabel} ${syn}</span>
                </div>`;
            }).join('');
        }

        // 最近舞台记录
        let historyHTML = '';
        if (G.partnerShows && G.partnerShows.length > 0) {
            historyHTML = `<div style="font-size:14px;font-weight:600;margin-bottom:8px;margin-top:16px">📜 最近演出</div>`;
            historyHTML += G.partnerShows.slice(-5).reverse().map(s => {
                const gradeColor = { S:'#ffd700', A:'#c0c0c0', B:'#cd7f32', C:'#999' };
                return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:12px">
                    <span style="font-size:18px">${s.grade}</span>
                    <span style="color:${gradeColor[s.grade]};font-weight:600">${s.score}分</span>
                    <span>Day${s.day} 与${s.partner}</span>
                    <span style="color:#999">${s.showType}</span>
                </div>`;
            }).join('');
        }

        let h = `<div class="app-header"><span class="back-btn" onclick="App.UI.goHome()">←</span><span class="title">🎭 公演舞台</span></div>
        <div style="flex:1;overflow-y:auto;padding:16px">
            ${lastShow ? `<div style="background:#fff;border-radius:12px;padding:12px;margin-bottom:12px;font-size:12px;text-align:center;color:#666">
                上次公演：Day${lastShow.day} · 位置：${lastShow.position || '中排'} · 评分：<b>${lastShow.score || '-'}分</b>
            </div>` : ''}

            <!-- 站位争夺 -->
            <div style="background:linear-gradient(135deg,#fff5f5,#ffe0e0);border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:10px">⚔️ 站位争夺</div>
                <div style="font-size:12px;color:#666;margin-bottom:10px">挑战队友争夺更好的舞台站位！舞蹈+表现力决定站位。</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
                    ${teammates.slice(0, 6).map(t => {
                        const pers = App.MemberPersonality.getFor(t.name);
                        const aff = G.memberAffection?.[t.name] || 50;
                        return `<button onclick="App.UI.doPositionBattle('${t.name}')" style="padding:10px;border:1px solid #fcc;border-radius:10px;background:#fff;font-size:12px;cursor:pointer;text-align:left">
                            ${pers.emoji} ${t.name}<br/>
                            <span style="font-size:10px;color:#999">❤️${aff}</span>
                        </button>`;
                    }).join('')}
                </div>
            </div>

            <!-- MC环节 -->
            <div style="background:linear-gradient(135deg,#fff8e1,#ffecb3);border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:10px">🎤 MC环节练习</div>
                <div style="font-size:12px;color:#666;margin-bottom:10px">随机MC话题，你的回答将影响观众反响！</div>
                <button onclick="App.UI.doMCTraining()" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#ff9800,#f57c00);color:#fff;font-size:14px;cursor:pointer">
                    🎤 开始MC挑战
                </button>
            </div>

            <!-- 搭档演出 -->
            <div style="background:#fff;border-radius:16px;padding:14px;margin-bottom:16px">
                <div style="font-size:14px;font-weight:600;margin-bottom:4px">🤝 搭档演出</div>
                <div style="font-size:11px;color:#999;margin-bottom:10px">不同搭档组合产生差异化演出效果（好感度越高默契越好）</div>
                ${partnerList || '<div style="color:#999;font-size:12px;text-align:center;padding:10px">暂无可搭档的队友</div>'}
            </div>

            ${historyHTML}
        </div>`;
        document.getElementById('stagePage').innerHTML = h;
    },

    doPositionBattle(opponent) {
        const result = App.Stage.competePosition(opponent);
        const emoji = result.result === 'win' ? '🎉' : result.result === 'draw' ? '🤝' : '💪';
        this.showNotification(`${emoji} ${result.position}！${result.memberReaction}`, 4000);
        this.renderStage();
    },

    doMCTraining() {
        const topic = pick(App.Stage.mcTopics);
        const choices = [
            { id:'witty', label:'😆 幽默接梗', desc:'反应快，金句频出' },
            { id:'heartfelt', label:'💝 真情流露', desc:'真诚感动，走心回答' },
            { id:'safe', label:'😊 安全回复', desc:'中规中矩，不出错' },
            { id:'silly', label:'🤪 搞笑卖萌', desc:'装傻充愣，萌混过关' },
            { id:'awkward', label:'😅 紧张结巴', desc:'发挥失常，略显尴尬' }
        ];
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'mcModal';
        modal.innerHTML = `<div class="event-card" style="max-width:360px;padding:20px">
            <div style="font-size:28px;text-align:center;margin-bottom:8px">🎤 MC环节</div>
            <div style="background:#f5f5f5;border-radius:10px;padding:12px;margin-bottom:14px;font-size:13px;text-align:center">
                MC话题：<b>"${topic.q}"</b>
            </div>
            <div style="font-size:12px;color:#999;margin-bottom:8px">选择你的回答方式：</div>
            ${choices.map(c => `
                <button onclick="document.getElementById('mcModal').remove();App.UI.executeMC('${topic.q}','${c.id}')"
                    style="width:100%;padding:10px;margin-bottom:5px;border:1px solid #eee;border-radius:8px;background:#fff;font-size:12px;cursor:pointer;text-align:left">
                    <b>${c.label}</b> · ${c.desc}
                </button>
            `).join('')}
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },

    executeMC(topic, choice) {
        const varietySkill = G.trainingSkills?.variety || 5;
        const result = App.Stage.mcSegment(topic, choice, varietySkill);
        let msg = `${result.reaction}\n${result.desc}`;
        if (result.memberReply) {
            msg += `\n\n${result.memberReply.emoji} ${result.memberReply.name}：${result.memberReply.text}`;
        }
        if (result.popularityGain > 0) msg += `\n⭐人气+${result.popularityGain}`;
        if (result.result === 'cold') msg += `\n🥶冷场惩罚！人气-${Math.abs(result.popularityGain)}`;
        this.showNotification(msg, 5000);
        if (!G.stageHistory) G.stageHistory = [];
        G.stageHistory.push({ day: G.game.day, event: 'MC', result: result.result, topic });
        this.renderStage();
    },

    doStageWith(partnerName) {
        const showTypes = [
            { id:'unit_song', label:'Unit曲', desc:'双人合唱+舞蹈' },
            { id:'dance_battle', label:'Dance Battle', desc:'舞蹈对决PK' },
            { id:'duet', label:'对唱', desc:'情歌对唱' },
            { id:'variety_stage', label:'特别舞台', desc:'搞笑/创意表演' }
        ];
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'stageModal';
        const pers = App.MemberPersonality.getFor(partnerName);
        modal.innerHTML = `<div class="event-card" style="max-width:320px;padding:20px;text-align:center">
            <div style="font-size:32px">🤝 ${pers.emoji}</div>
            <div style="font-size:16px;font-weight:600;margin-bottom:4px">与${partnerName}搭档演出</div>
            <div style="font-size:12px;color:#999;margin-bottom:14px">选择演出类型</div>
            ${showTypes.map(s => `
                <button onclick="document.getElementById('stageModal').remove();App.UI.executeStageShow('${partnerName}','${s.id}')"
                    style="width:100%;padding:12px;margin-bottom:6px;border:1px solid #eee;border-radius:10px;background:#fff;font-size:13px;cursor:pointer;text-align:left">
                    <b>${s.label}</b><br/><span style="font-size:11px;color:#999">${s.desc}</span>
                </button>
            `).join('')}
            <button onclick="document.getElementById('stageModal').remove()" style="width:100%;padding:10px;border:none;background:none;color:#999;cursor:pointer">取消</button>
        </div>`;
        document.getElementById('phoneModals').appendChild(modal);
    },

    executeStageShow(partnerName, showType) {
        const showLabels = { unit_song:'Unit曲', dance_battle:'Dance Battle', duet:'对唱', variety_stage:'特别舞台' };
        const result = App.Stage.partnerSynergy.performWithPartner(partnerName, showLabels[showType] || showType);
        const gradeStars = { S:'⭐⭐⭐⭐⭐', A:'⭐⭐⭐⭐', B:'⭐⭐⭐', C:'⭐⭐' };
        let msg = `${gradeStars[result.grade] || ''}\n评级：${result.grade} (${result.score}分)\n${result.combo.name}：${result.combo.desc}`;
        if (result.rewards.popularity > 0) msg += `\n⭐人气+${result.rewards.popularity}`;
        if (result.rewards.affection > 0) msg += `\n❤️与${partnerName}好感+${result.rewards.affection}`;
        msg += `\n默契度：${result.synergy}/100`;
        this.showNotification(msg, 6000);
        if (!G.stageHistory) G.stageHistory = [];
        G.stageHistory.push({ day: G.game.day, position: '搭档舞台', partner: partnerName, score: result.score, grade: result.grade });
        this.renderStage();
    },


    // ============ V4 争议/热搜事件（从微博入口触发）============
    showControversyFromWeibo() {
        const event = App.SocialMedia.controversyEvent();
        if (!event) { this.showNotification('暂无可触发的事件', 2000); return; }
        const inner = `<div class="event-card" style="max-width:340px;padding:20px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">⚠️</div>
            <div style="font-size:14px;font-weight:600;margin-bottom:12px">争议事件</div>
            <div style="background:#fff8e1;border-radius:10px;padding:12px;margin-bottom:14px;font-size:12px;text-align:left">
                <b>${event.member}</b>：${event.content}
            </div>
            <div style="font-size:12px;color:#666;margin-bottom:10px">你如何回应？</div>
            <button onclick="document.getElementById('controversyModal')?.remove();App.UI.doControversyChoice('${event.member}','A',${JSON.stringify(event.choiceA).replace(/'/g,"\\'")})"
                style="width:100%;padding:10px;margin-bottom:5px;border:2px solid #3498db;border-radius:8px;background:#eaf2f8;font-size:12px;cursor:pointer;text-align:left">
                <b>A. ${event.choiceA.text}</b><br/><span style="font-size:10px;color:#999">→ ${event.choiceA.desc}</span>
            </button>
            <button onclick="document.getElementById('controversyModal')?.remove();App.UI.doControversyChoice('${event.member}','B',${JSON.stringify(event.choiceB).replace(/'/g,"\\'")})"
                style="width:100%;padding:10px;margin-bottom:5px;border:2px solid #95a5a6;border-radius:8px;background:#f5f5f5;font-size:12px;cursor:pointer;text-align:left">
                <b>B. ${event.choiceB.text}</b><br/><span style="font-size:10px;color:#999">→ ${event.choiceB.desc}</span>
            </button>
            <button onclick="document.getElementById('controversyModal')?.remove();App.UI.doControversyChoice('${event.member}','C',${JSON.stringify(event.choiceC).replace(/'/g,"\\'")})"
                style="width:100%;padding:10px;margin-bottom:5px;border:2px solid #e74c3c;border-radius:8px;background:#fdedec;font-size:12px;cursor:pointer;text-align:left">
                <b>C. ${event.choiceC.text}</b><br/><span style="font-size:10px;color:#999">→ ${event.choiceC.desc}</span>
            </button>
        </div>`;
        this.phoneModal(inner, 'controversyModal');
    },

    doControversyChoice(memberName, choiceKey, choiceData) {
        const result = App.SocialMedia.resolveControversy(memberName, choiceKey, choiceData);
        this.showNotification(`✅ 已做出选择！与${memberName}好感${result.effects.affection > 0 ? '+' : ''}${result.effects.affection}`, 3500);
        // 如果微博页打开着就刷新
        if (document.getElementById('weiboPage').classList.contains('active')) {
            this.renderWeiboPost();
        }
    },

    doRandomTrending() {
        const event = App.SocialMedia.randomTrending();
        let msg = `🔥 ${event.title}\n${event.trigger}`;
        if (event.effects.popularity) msg += `\n⭐人气${event.effects.popularity > 0 ? '+' : ''}${event.effects.popularity}`;
        if (event.effects.scandal) msg += `\n📸绯闻+${event.effects.scandal}`;
        if (event.effects.target) msg += `\n与${event.effects.target}关系恶化！`;
        this.showNotification(msg, 6000);
        if (event.severity === 'major') {
            setTimeout(() => {
                const chain = App.SocialMedia.chainReaction(event);
                if (chain) this.showNotification(`🔄 连锁反应：${chain.desc}`, 4000);
            }, 2000);
        }
    }
};

// ============ 分队算法 ============
function assignTeam(personality, group, quizScores) {
    const teams = GROUP_TEAMS[group] || ['SII'];
    
    // 性格维度映射
    const pMap = {'温柔细腻':1, '热血直率':2, '内敛高冷':3, '古灵精怪':4};
    const pDim = pMap[personality] || 1;
    
    // 计算各维度得分
    let dimScore = {1:0, 2:0, 3:0, 4:0};
    dimScore[pDim] += 3; // 性格选择权重最高
    if (quizScores) quizScores.forEach(s => { if (s >= 1 && s <= 4) dimScore[s]++; });
    
    // 根据不同分团的规则分配队伍
    if (group === 'SNH48') {
        // SNH48: SII=温柔、NII=热血、HII=内敛、X=古灵精怪
        const map = {1:'SII', 2:'NII', 3:'HII', 4:'X'};
        let maxDim = 1, maxVal = 0;
        for (let d=1; d<=4; d++) { if (dimScore[d] > maxVal) { maxVal = dimScore[d]; maxDim = d; } }
        return map[maxDim] || teams[0];
    } else if (group === 'GNZ48') {
        // GNZ48: G=温柔、NIII=热血、Z=内敛+古灵
        const gentleScore = dimScore[1];
        const hotScore = dimScore[2];
        const introvertScore = dimScore[3] + dimScore[4]; // 内敛+古灵合并
        
        if (gentleScore >= hotScore && gentleScore >= introvertScore) {
            return 'G';
        } else if (hotScore >= gentleScore && hotScore >= introvertScore) {
            return 'NIII';
        } else {
            return 'Z';
        }
    } else if (group === 'BEJ48') {
        // BEJ48: B=温柔+内敛、E=热血+古灵
        const beScore = dimScore[1] + dimScore[3]; // 温柔+内敛
        const eeScore = dimScore[2] + dimScore[4]; // 热血+古灵
        return beScore >= eeScore ? 'B' : 'E';
    } else if (group === 'CKG48') {
        // CKG48: C=温柔+内敛、K=热血+古灵
        const ccScore = dimScore[1] + dimScore[3]; // 温柔+内敛
        const kkScore = dimScore[2] + dimScore[4]; // 热血+古灵
        return ccScore >= kkScore ? 'C' : 'K';
    } else if (group === 'CGT48') {
        // CGT48: CⅡ=温柔+内敛、GⅡ=热血+古灵
        const c2Score = dimScore[1] + dimScore[3]; // 温柔+内敛
        const g2Score = dimScore[2] + dimScore[4]; // 热血+古灵
        return c2Score >= g2Score ? 'CⅡ' : 'GⅡ';
    }
    
    // 默认返回第一个队伍
    return teams[0];
}

// ============ 初始化 ============
(function initApp() {
    // URL 参数 reset=1：清除验证状态，强制显示验证码页面
    try {
        const params = new URLSearchParams(window.location.search);
        if (params.get('reset') === '1') {
            localStorage.removeItem('inviteCode');
            localStorage.removeItem('inviteUserId');
            console.log('[Init] reset=1: 已清除验证状态');
        }
    } catch(e) {}

    App.Sound.init();
    App.Save.load();
    App.Network.init();


    // 1. 兜底清理：移除可能拦截页面的遗留弹窗（修复页面卡死）
    if (App.ModalManager) {
        App.ModalManager.cleanupOrphans();
        App.ModalManager.initGlobalListeners();
    }

    // 2. 启动实时时钟（每秒更新，与设备系统时间完全同步）
    if (App.Time) {
        App.Time.startClock();
    }

    // 3. 先检查是否已经验证过邀请码（必须在任意渲染前）
    if (App.Invite.checkAlreadyValidated()) {
        // 已经验证过，直接隐藏邀请码页面，显示锁屏
        const inviteEl = document.getElementById('inviteScreen');
        const lockEl = document.getElementById('lockScreen');
        if (inviteEl) inviteEl.classList.remove('active');
        if (lockEl) lockEl.classList.add('active');
    }

    let keypadHTML = '';
    for (let i=1;i<=9;i++) keypadHTML += `<button class="key" onclick="App.UI.enterPassword('${i}')">${i}</button>`;
    keypadHTML += `<button class="key" onclick="App.UI.clearPwd()">×</button><button class="key" onclick="App.UI.enterPassword('0')">0</button><button class="key" onclick="App.UI.backspacePwd()">⌫</button>`;
    document.getElementById('passwordKeypad').innerHTML = keypadHTML;

    document.getElementById('homeGrid').innerHTML = `
        <div class="app-icon" onclick="App.UI.openApp('wechat')"><div class="icon" style="background:linear-gradient(135deg,#07c160,#06ad56)">💬</div><div class="label">微信</div></div>
        <div class="app-icon" onclick="App.UI.openApp('weibo')"><div class="icon" style="background:linear-gradient(135deg,#ff4757,#ff6b81)">📷</div><div class="label">微博</div></div>
        <div class="app-icon" onclick="App.UI.openApp('sms')"><div class="icon" style="background:linear-gradient(135deg,#3498db,#2980b9)">📱</div><div class="label">短信</div></div>
        <div class="app-icon" onclick="App.UI.openApp('phone')"><div class="icon" style="background:linear-gradient(135deg,#2ecc71,#27ae60)">📞</div><div class="label">电话</div></div>
        <div class="app-icon" onclick="App.UI.openApp('pocket')"><div class="icon" style="background:linear-gradient(135deg,#ff9500,#ff6f00)">🎬</div><div class="label">口袋48</div></div>
        <div class="app-icon" onclick="App.UI.openApp('calendar')"><div class="icon" style="background:linear-gradient(135deg,#3498db,#2980b9)">📅</div><div class="label">日程</div></div>
        <div class="app-icon" onclick="App.UI.openApp('backpack')"><div class="icon" style="background:linear-gradient(135deg,#8b4513,#a0522d)">🎒</div><div class="label">背包</div></div>
        <div class="app-icon" onclick="App.UI.openApp('outdoor')"><div class="icon" style="background:linear-gradient(135deg,#e74c3c,#c0392b)">🚗</div><div class="label">外出</div></div>
        <div class="app-icon" onclick="App.UI.openApp('profile')"><div class="icon" style="background:linear-gradient(135deg,#a55eea,#8854d0)">👤</div><div class="label">档案</div></div>
        <div class="app-icon" onclick="App.UI.openApp('election')"><div class="icon" style="background:linear-gradient(135deg,#ffd700,#f39c12)">🏆</div><div class="label">总选举</div></div>
        <div class="app-icon" onclick="App.UI.openApp('affection')"><div class="icon" style="background:linear-gradient(135deg,#ff69b4,#ff1493)">💕</div><div class="label">好感度</div></div>
        <div class="app-icon" onclick="App.UI.openApp('diary')"><div class="icon" style="background:linear-gradient(135deg,#c8a96e,#b8935a)">📔</div><div class="label">日记本</div></div>
        <div class="app-icon" onclick="App.UI.openApp('training')"><div class="icon" style="background:linear-gradient(135deg,#6c5ce7,#a855f7)">💪</div><div class="label">训练</div></div>
        <div class="app-icon" onclick="App.UI.openApp('stage')"><div class="icon" style="background:linear-gradient(135deg,#f97316,#ef4444)">🎭</div><div class="label">公演</div></div>
        <div class="app-icon" onclick="App.UI.openApp('settings')"><div class="icon" style="background:linear-gradient(135deg,#95a5a6,#7f8c8d)">⚙️</div><div class="label">设置</div></div>`;

    function updateClock() {
        // 使用 App.Time 统一接口（修复：与设备系统时间完全一致）
        if (App.Time) {
            App.Time.updateAll();
        } else {
            const n = new Date();
            const t = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
            document.getElementById('statusTime').textContent = t;
            document.getElementById('lockTime').textContent = t;
            document.getElementById('lockDate').textContent = n.getFullYear()+'/'+(n.getMonth()+1)+'/'+n.getDate()+' 周'+['日','一','二','三','四','五','六'][n.getDay()];
        }
    }
    updateClock();
    setInterval(updateClock, 60000);

    let lastRealTime = Date.now();
    setInterval(() => {
        if (!G.player.name) return;
        const now = Date.now();
        const elapsedHours = (now - lastRealTime) / (1000 * 3600);
        if (elapsedHours >= 1) {
            const daysPassed = Math.floor(elapsedHours);
            G.game.day += daysPassed;
            G.game.phase = 'morning';
            G.game.handshake_this_month = false;
            
            lastRealTime = now;
            App.UI.updateTimeBar();
            App.Save.autoSave();
            App.UI.showNotification(`⏰ 时间流逝，已过${daysPassed}天`);
            
            if (G.game.day % 30 === 0) {
                App.UI.showElectionModal();
            }
        }
    }, 30000);

    function triggerElection() {
        const votes = App.UI.calculateVotes();
        const allMembers = App.getAllMembers().filter(m => !m.graduate);
        let rankings = allMembers.map(m => ({ name: m.name, votes: randInt(1000, 50000) }));
        rankings.push({ name: G.player.name, votes: votes });
        rankings.sort((a, b) => b.votes - a.votes);
        G.electionResults = rankings;
        G.game.rank = rankings.findIndex(r => r.name === G.player.name) + 1;
    }

    function triggerHandshake() {
        if (!G.game.handshake_this_month) G.game.handshake_this_month = true;
    }

    if (G.player.name) {
        document.getElementById('bottomNav').style.display = '';
        App.UI.goHome();
    } else {
        // 如果已经验证过邀请码，显示锁屏，否则保持邀请码页面
        if (App.Invite.checkAlreadyValidated()) {
            App.UI.showPage('lockScreen');
        }
    }
})();

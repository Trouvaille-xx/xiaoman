// ─── V6 Integration ───
(function() {
    // ── Drawer Active State ──
    window.updateDrawerActive = function(page) {
        document.querySelectorAll('.drawer-item').forEach(function(item) { item.classList.remove('active'); });
        var el = document.getElementById('drawer' + page.charAt(0).toUpperCase() + page.slice(1));
        if (el) el.classList.add('active');
    };

    // ── FAB visibility ──
    window.showNoteFab = function(visible) {
        var fab = document.getElementById('noteFab');
        if (fab) { if (visible) fab.classList.remove('hidden'); else fab.classList.add('hidden'); }
    };

    // ── switchToMe ──
    window.switchToMe = function() {
        ['notesPage','nianPage','explorePage'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
        document.getElementById('mePage').classList.add('active');
        ['navNotes','navNian','navExplore'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
        document.getElementById('appHeader').style.display = 'flex';
        // Back button replaces hamburger
        var hamburger = document.querySelector('#appHeader .header-icon');
        if (hamburger) hamburger.setAttribute('onclick', 'switchToNotes()');
        var svg = hamburger ? hamburger.querySelector('svg') : null;
        if (svg) svg.innerHTML = '<polyline points="15 18 9 12 15 6"/>';
        var brand = document.getElementById('headerBrand'); if (brand) brand.remove();
        var dd = document.getElementById('headerTagDropdown'); if (dd) dd.remove();
        var sc = document.getElementById('searchContainer'); if (sc) sc.remove();
        var si = document.querySelector('.search-icon'); if (si) si.remove();
        var hi = document.getElementById('historyIcon'); if (hi) hi.style.display = 'none';
        var hr = document.getElementById('headerRight'); if (hr) hr.style.display = 'none';
        var bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = 'none';
        closeFab(); closeSidebar();
        updateDrawerActive('me'); showNoteFab(false);
        loadMeProfile();
        if (typeof renderHeatmap === 'function') setTimeout(function() { renderHeatmap(); addHeatmapTooltips(); }, 100);
    };

    // ── switchToExplore ──
    window.switchToExplore = function() {
        if (typeof closeNoteExpand === 'function') closeNoteExpand();
        if (typeof closeAllNoteMenus === 'function') closeAllNoteMenus();
        ['notesPage','nianPage','mePage'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
        document.getElementById('explorePage').classList.add('active');
        ['navNotes','navNian'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
        document.getElementById('navExplore').classList.add('active');
        document.getElementById('appHeader').style.display = 'flex';
        var brand = document.getElementById('headerBrand'); if (brand) brand.remove();
        var dd = document.getElementById('headerTagDropdown'); if (dd) dd.remove();
        var sc = document.getElementById('searchContainer'); if (sc) sc.remove();
        var si = document.querySelector('.search-icon'); if (si) si.remove();
        var hi = document.getElementById('historyIcon'); if (hi) hi.style.display = 'none';
        var hr = document.getElementById('headerRight'); if (hr) hr.style.display = 'none';
        var bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = '';
        var hamburger = document.querySelector('#appHeader .header-icon');
        if (hamburger) hamburger.setAttribute('onclick', 'toggleSidebar()');
        var svg = hamburger ? hamburger.querySelector('svg') : null;
        if (svg) svg.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
        closeFab(); closeSidebar();
        updateDrawerActive('explore'); showNoteFab(false);
    };

    // ── Monkey-patch switchToNotes (FAB visible, force refresh notes) ──
    var _origSwitchToNotes = switchToNotes;
    window.switchToNotes = function() {
        _origSwitchToNotes();
        document.getElementById('mePage').classList.remove('active');
        document.getElementById('explorePage').classList.remove('active');
        document.getElementById('navExplore').classList.remove('active');
        var hi = document.getElementById('historyIcon'); if (hi) hi.style.display = 'none';
        var hr = document.getElementById('headerRight'); if (hr) hr.style.display = 'none';
        var bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = '';
        // Restore hamburger
        var hamburger = document.querySelector('#appHeader .header-icon');
        if (hamburger) hamburger.setAttribute('onclick', 'toggleSidebar()');
        var svg = hamburger ? hamburger.querySelector('svg') : null;
        if (svg) svg.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
        updateDrawerActive('notes'); showNoteFab(true);
    };

    // ── Monkey-patch switchToNian (hide FAB, show nian icons) ──
    var _origSwitchToNian = switchToNian;
    window.switchToNian = function() {
        _origSwitchToNian();
        document.getElementById('mePage').classList.remove('active');
        document.getElementById('explorePage').classList.remove('active');
        document.getElementById('navExplore').classList.remove('active');
        var hi = document.getElementById('historyIcon'); if (hi) hi.style.display = '';
        var hr = document.getElementById('headerRight'); if (hr) hr.style.display = '';
        var bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = '';
        var hamburger = document.querySelector('#appHeader .header-icon');
        if (hamburger) hamburger.setAttribute('onclick', 'toggleSidebar()');
        var svg = hamburger ? hamburger.querySelector('svg') : null;
        if (svg) svg.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
        updateDrawerActive('nian'); showNoteFab(false);
    };

    // ── Penpal / Mail System ──
    var PENPALS = [
        { id: "xiaonuan", name: "小暖", emoji: "暖", color: "#FF8FA3", personality: "温柔善良，善解人意", prompt: "你是小暖，一个温柔善良的笔友。你说话温暖细腻，总是先共情再回应。回复控制在200字以内，像一位知心朋友。" },
        { id: "aran", name: "阿燃", emoji: "燃", color: "#FF6B35", personality: "热血奋进，永不服输", prompt: "你是阿燃，一个热血奋进的笔友。你说话充满激情和能量，喜欢鼓励他人。回复控制在200字以内，像一位并肩作战的伙伴。" },
        { id: "shubai", name: "书白", emoji: "书", color: "#4A6FA5", personality: "博学睿智，冷静通透", prompt: "你是书白，一个博学睿智的笔友。你说话理性深刻，善于引用知识和典故。回复控制在200字以内，像一位智慧的导师。" },
        { id: "momo", name: "墨墨", emoji: "墨", color: "#9B59B6", personality: "浪漫文艺，天马行空", prompt: "你是墨墨，一个浪漫文艺的笔友。你说话诗意盎然，充满想象力和艺术感。回复控制在200字以内，像一位流浪的诗人。" }
    ];
    var pendingNoteContent = '';

    window.openPenpalSheet = function(noteContent) {
        pendingNoteContent = noteContent;
        // Reset menu z-index state
        document.querySelectorAll('.note-card-wrapper').forEach(function(w) { w.style.zIndex = ''; });
        document.querySelectorAll('.notes-section').forEach(function(s) { s.style.zIndex = ''; });
        // Close all open menus
        document.querySelectorAll('.note-menu.open').forEach(function(m) { m.classList.remove('open'); });
        var list = document.getElementById('penpalSheetList');
        if (!list) return;
        list.innerHTML = PENPALS.map(function(p) {
            return '<div class="penpal-sheet-item" onclick="selectPenpal(\'' + p.id + '\')">' +
                '<div class="penpal-sheet-avatar" style="background:' + p.color + '20;color:' + p.color + '">' + p.emoji + '</div>' +
                '<div class="penpal-sheet-name">' + p.name + '</div>' +
                '<div class="penpal-sheet-personality">' + p.personality + '</div>' +
                '</div>';
        }).join('');
        document.getElementById('penpalSheet').classList.add('open');
        document.getElementById('penpalSheetOverlay').classList.add('open');
    };

    window.closePenpalSheet = function() {
        document.getElementById('penpalSheet').classList.remove('open');
        document.getElementById('penpalSheetOverlay').classList.remove('open');
    };

    window.selectPenpal = function(penpalId) {
        closePenpalSheet();
        var pp = PENPALS.find(function(p) { return p.id === penpalId; });
        if (!pp || !pendingNoteContent) return;

        var plainContent = pendingNoteContent.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
        if (!plainContent) { showToast('笔记内容为空'); return; }

        // Android 端：交给原生 MailInterface 单次发送（原生负责 3s 延迟 + Worker 回信 + 落库）。
        // 不要在这里 JS fetch / 二次 saveMailItem —— 旧实现签名不匹配（sendMail 需要 4 个参数），
        // 且每次调用都会在原生存储里新建一封邮件，导致每封笔友信重复 2 条且回信失败。
        if (typeof AndroidMail !== 'undefined' && AndroidMail.sendMail) {
            var memoPrompt = (typeof window.buildPenpalContext === 'function')
                ? window.buildPenpalContext(penpalId, pp.prompt)
                : pp.prompt;
            AndroidMail.sendMail(plainContent.substring(0, 4000), penpalId, pp.name, memoPrompt);
            showToast('已寄出，等待回信...');
            setTimeout(updateMailBadge, 4000);
            return;
        }

        // 浏览器端：写 localStorage + fetch 回信
        var mailId = 'mail_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        var mail = {
            id: mailId,
            penpalId: penpalId,
            noteContent: pendingNoteContent,
            reply: '',
            sentAt: Date.now(),
            status: 'sending',
            read: false
        };

        saveMailItem(mail);
        showToast('已寄出，等待回信...');

        var config;
        try { config = JSON.parse(localStorage.getItem('nian_settings') || '{}'); } catch(e) { config = {}; }
        if (!config.apiUrl || !config.apiKey) {
            mail.status = 'failed';
            mail.reply = '(请先配置 API)';
            saveMailItem(mail);
            updateMailBadge();
            return;
        }

        var browserPrompt = (typeof window.buildPenpalContext === 'function')
            ? window.buildPenpalContext(penpalId, pp.prompt)
            : pp.prompt;

        var url = NativeHttp.chatEndpoint(config.apiUrl);
        NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, {
            model: config.model || 'gpt-4o',
            messages: [
                { role: 'system', content: browserPrompt },
                { role: 'user', content: '我写了一篇笔记，请以你的风格给我回信。笔记内容：\n\n' + plainContent.substring(0, 1000) }
            ],
            max_tokens: 400, temperature: 0.8
        }).then(function(data) {
            var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
            if (reply) {
                reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\/?think>/gi, '').trim();
                mail.reply = reply;
                mail.status = 'replied';
                mail.repliedAt = Date.now();
                saveMailItem(mail);
                updateMailBadge();
                showToast(pp.name + '回信了');
            }
        }).catch(function() {
            mail.status = 'failed';
            mail.reply = '(回信失败，请检查网络和API配置)';
            saveMailItem(mail);
            updateMailBadge();
        });
    };

    function saveMailItem(mail) {
        // 浏览器端专用：Android 端邮件的写入完全由原生 MailInterface 管理
        try {
            var mails = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
            var found = false;
            for (var i = 0; i < mails.length; i++) { if (mails[i].id === mail.id) { mails[i] = mail; found = true; break; } }
            if (!found) mails.unshift(mail);
            localStorage.setItem('nian_mails_cache', JSON.stringify(mails));
        } catch(e) {}
    }

    function getUnreadMailCount() {
        try {
            var mails;
            if (typeof AndroidMail !== 'undefined') {
                mails = JSON.parse(AndroidMail.loadMails() || '[]');
            } else {
                mails = JSON.parse(localStorage.getItem('nian_mails_cache') || '[]');
            }
            return mails.filter(function(m) { return m.status === 'replied' && !m.read; }).length;
        } catch(e) { return 0; }
    }

    function getCircleUnreadCount() {
        try {
            var st = JSON.parse(localStorage.getItem('nian_circle_v1') || '{}');
            var sum = Number(st.unreadPosts || 0);
            var u = st.unread || {};
            for (var k in u) if (u.hasOwnProperty(k)) sum += Number(u[k] || 0);
            return sum;
        } catch (e) { return 0; }
    }

    window.updateMailBadge = function() {
        var count = getCircleUnreadCount();
        // Hamburger badge
        var badge = document.getElementById('hamburgerMailBadge');
        if (!badge) {
            badge = document.createElement('span');
            badge.id = 'hamburgerMailBadge';
            badge.style.cssText = 'position:absolute;top:-2px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;';
            var hamburger = document.querySelector('#appHeader .header-icon');
            if (hamburger) { hamburger.style.position = 'relative'; hamburger.appendChild(badge); }
        }
        badge.textContent = count;
        badge.style.display = count > 0 ? 'flex' : 'none';
        // Sidebar drawer item badge
        var drawerBadge = document.getElementById('mailUnreadBadge');
        if (drawerBadge) {
            drawerBadge.textContent = count;
            drawerBadge.style.display = count > 0 ? '' : 'none';
        }
    };

    // Update badge periodically and on page switch
    setInterval(updateMailBadge, 5000);
    setTimeout(updateMailBadge, 2000);
    window.openCircle = function() {
        if (typeof AndroidStorage !== 'undefined') {
            window.location.href = 'circle/circle.html';
        } else {
            window.location.href = 'app/src/main/assets/circle/circle.html';
        }
    };
    window.openMailbox = window.openCircle;
    var _origCloseFab = closeFab;
    window.closeFab = function() {
        try { _origCloseFab(); } catch(e) {}
    };
    var _origToggleFab = toggleFab;
    window.toggleFab = function() {}; // no-op: new FAB doesn't toggle

    // ── Monkey-patch toggleSidebar ──
    var _origToggleSidebar = toggleSidebar;
    window.toggleSidebar = function() { _origToggleSidebar(); };

    // ── Magazine Notes Restructuring ──
    var MONTH_NAMES = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    var MONTH_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var RATIOS = [[17,7],[15,9],[14,10],[13,11],[12,12],[11,13],[10,14],[9,15]];

    window.restructureNotes = function() {
        var container = document.getElementById('notesList');
        var wrappers = container.querySelectorAll('.note-card-wrapper');
        if (wrappers.length === 0 || container.querySelector('.notes-section')) return;

        // Build note lookup by id for year extraction
        var noteMap = {};
        if (typeof notes !== 'undefined') {
            notes.forEach(function(n) { noteMap[n.id] = n; });
        }

        // Group by year → month
        var yearGroups = {}, yearOrder = [];
        wrappers.forEach(function(w) {
            var dateEl = w.querySelector('.note-date');
            var noteId = w.getAttribute('data-note-id');
            if (!dateEl) return;
            var text = dateEl.textContent.trim();
            var mMatch = text.match(/(\d+)月/);
            if (!mMatch) return;
            var m = parseInt(mMatch[1]);

            // Get year from note data, fallback to date text, fallback to current year
            var y = new Date().getFullYear();
            if (noteMap[noteId] && noteMap[noteId].createdAt) {
                y = new Date(noteMap[noteId].createdAt).getFullYear();
            } else {
                var yMatch = text.match(/(\d{4})/);
                if (yMatch) y = parseInt(yMatch[1]);
            }

            if (!yearGroups[y]) { yearGroups[y] = {}; yearOrder.push(y); }
            if (!yearGroups[y][m]) yearGroups[y][m] = [];
            yearGroups[y][m].push(w);
        });
        if (yearOrder.length === 0) return;
        yearOrder.sort(function(a,b) { return b - a; });

        container.innerHTML = '';

        yearOrder.forEach(function(year, yi) {
            var months = yearGroups[year];
            var mOrder = Object.keys(months).map(Number).sort(function(a,b) { return b - a; });

            // Year divider (skip first/latest year — year bar already shows it)
            if (yi > 0) {
                var yearDiv = document.createElement('div');
                yearDiv.className = 'notes-year-divider';
                yearDiv.innerHTML = '<span class="notes-year-label">' + year + '年</span>';
                container.appendChild(yearDiv);
            }

            mOrder.forEach(function(month, mi) {
                var cards = months[month];
                var isLatestYear = (yi === 0);
                var isLatestMonth = isLatestYear && (mi === 0);
                // Collapse: only first 2 months of latest year are open, rest collapsed
                var collapse = !isLatestYear || mi > 1;

                var section = document.createElement('div');
                section.className = 'notes-section' + (collapse ? ' collapsed' : '');

                var header = document.createElement('div');
                header.className = 'notes-section-header';
                header.innerHTML = '<span class="notes-section-month">' + MONTH_NAMES[month-1] + '</span><span class="notes-section-en">' + MONTH_EN[month-1] + '</span><span class="notes-section-count">' + cards.length + ' 篇</span>';
                if (collapse) header.onclick = function() { this.parentElement.classList.toggle('collapsed'); };
                section.appendChild(header);

                var flow = document.createElement('div');
                flow.className = 'notes-flow';

                // Featured: first card of first month of latest year
                cards.forEach(function(card, ci) {
                    if (isLatestMonth && ci === 0) {
                        card.className = 'note-card-wrapper featured';
                        card.style.gridColumn = 'span 24';
                        var dateText = (card.querySelector('.note-date') || {}).textContent || '';
                        var dayMatch = dateText.match(/(\d+)日/);
                        if (dayMatch) card.querySelector('.note-card').setAttribute('data-day', dayMatch[1]);
                    }
                });

                var regular = cards.slice(isLatestMonth ? 1 : 0);
                regular.forEach(function(card) {
                    var textEl = card.querySelector('.note-text');
                    var len = textEl ? textEl.textContent.replace(/\s+/g, '').length : 0;
                    card.setAttribute('data-len', len);
                    card.className = 'note-card-wrapper';
                });

                var i = 0;
                while (i < regular.length) {
                    var a = regular[i], b = regular[i + 1];
                    if (!b) { a.className = 'note-card-wrapper size-full'; i += 1; }
                    else {
                        var la = parseInt(a.getAttribute('data-len')) || 0;
                        var lb = parseInt(b.getAttribute('data-len')) || 0;
                        var diff = Math.abs(la - lb), idx;
                        if (diff < 40) idx = Math.floor(Math.random() * 3) + 2;
                        else if (diff < 150) idx = Math.floor(Math.random() * 4) + 1;
                        else idx = Math.floor(Math.random() * 4);
                        var pair = RATIOS[Math.min(idx, 7)];
                        if (la >= lb) {
                            a.className = 'note-card-wrapper size-' + pair[0] + 'w';
                            b.className = 'note-card-wrapper size-' + pair[1] + 'n';
                        } else {
                            a.className = 'note-card-wrapper size-' + pair[1] + 'n';
                            b.className = 'note-card-wrapper size-' + pair[0] + 'w';
                        }
                        i += 2;
                    }
                }

                cards.forEach(function(card) { flow.appendChild(card); });
                section.appendChild(flow);
                container.appendChild(section);
            });
        });
    };

    var _renderNotes = renderNotes;
    window.renderNotes = function(tf) { _renderNotes(tf); setTimeout(window.restructureNotes, 10); };
    setTimeout(function() { if (document.getElementById('notesList').children.length > 0 && !document.querySelector('.notes-section')) window.restructureNotes(); }, 300);

    // ── Full-screen Note Expansion ──
    window.openNoteExpand = function(cardEl) {
        // Close any open note menus
        document.querySelectorAll('.note-menu.open').forEach(function(m) { m.classList.remove('open'); });

        var viewer = document.getElementById('noteExpandViewer');
        var overlay = document.getElementById('noteExpandOverlay');
        var wrapper = cardEl.closest('.note-card-wrapper');
        var dateEl = wrapper.querySelector('.note-date');
        var textEl = wrapper.querySelector('.note-text');

        // If already open, close first then reopen with new content (for animation feedback)
        if (viewer.classList.contains('open')) {
            viewer.classList.remove('open');
            overlay.classList.remove('open');
            document.getElementById('noteExpandDate').textContent = dateEl ? dateEl.textContent.trim() : '';
            document.getElementById('noteExpandBody').innerHTML = textEl ? textEl.innerHTML : '';
            // Re-trigger animation after close transition
            setTimeout(function() {
                var rect = cardEl.getBoundingClientRect();
                var vr = viewer.getBoundingClientRect();
                viewer.style.transformOrigin = (rect.left + rect.width / 2 - vr.left) + 'px ' + (rect.top + rect.height / 2 - vr.top) + 'px';
                overlay.classList.add('open'); viewer.classList.add('open');
            }, 350);
            return;
        }

        var rect = cardEl.getBoundingClientRect();
        var vr = viewer.getBoundingClientRect();
        var ox = rect.left + rect.width / 2 - vr.left;
        var oy = rect.top + rect.height / 2 - vr.top;
        viewer.style.transformOrigin = ox + 'px ' + oy + 'px';

        document.getElementById('noteExpandDate').textContent = dateEl ? dateEl.textContent.trim() : '';
        document.getElementById('noteExpandBody').innerHTML = textEl ? textEl.innerHTML : '';
        overlay.classList.add('open'); viewer.classList.add('open');
        document.body.style.overflow = 'hidden';
    };
    window.closeNoteExpand = function() {
        document.getElementById('noteExpandViewer').classList.remove('open');
        document.getElementById('noteExpandOverlay').classList.remove('open');
        document.getElementById('noteExpandBody').innerHTML = '';
        document.getElementById('noteExpandDate').textContent = '';
        document.body.style.overflow = '';
    };
    // ── Insight Viewer: full-screen with streaming ──
    var insightModeActive = false;
    var insightNoteId = null;
    var insightMethodId = null;

    // History storage key
    var INSIGHT_HISTORY_KEY = 'nian_insight_history';

    function loadInsightHistory() {
        try {
            var raw = typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
            var s = raw ? JSON.parse(raw) : {};
            return s.insightHistory || [];
        } catch(e) { return []; }
    }

    function saveInsightHistory(entry) {
        try {
            var raw = typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
            var s = raw ? JSON.parse(raw) : {};
            var history = s.insightHistory || [];
            history.unshift(entry);
            if (history.length > 50) history = history.slice(0, 50);
            s.insightHistory = history;
            if (typeof AndroidSettings !== 'undefined') {
                AndroidSettings.saveSettings(JSON.stringify(s));
            } else {
                localStorage.setItem('nian_settings', JSON.stringify(s));
            }
        } catch(e) {}
    }

    function loadInsightPrompts() {
        var prompts = [];
        try {
            var s = JSON.parse(typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : (localStorage.getItem('nian_settings') || '{}'));
            if (s && s.insightPrompts) {
                prompts = typeof s.insightPrompts === 'string' ? JSON.parse(s.insightPrompts) : s.insightPrompts;
            }
        } catch(e) {}
        if (!prompts || !prompts.length) {
            try { prompts = INSIGHT_PROMPTS; } catch(e) { prompts = []; }
        }
        var exclude = [];
        return prompts.filter(function(p) { return exclude.indexOf(p.id) === -1; });
    }

    window.openInsightViewer = function(noteId) {
        // Reset menu z-index
        document.querySelectorAll('.note-card-wrapper').forEach(function(w) { w.style.zIndex = ''; });
        document.querySelectorAll('.notes-section').forEach(function(s) { s.style.zIndex = ''; });
        document.querySelectorAll('.note-menu.open').forEach(function(m) { m.classList.remove('open'); });

        var wrapper = document.querySelector('.note-card-wrapper[data-note-id="' + noteId + '"]');
        var cardEl = wrapper ? wrapper.querySelector('.note-card') : document.querySelector('.note-card');
        if (!cardEl) return;

        insightModeActive = true;
        insightNoteId = noteId;
        var rect = cardEl.getBoundingClientRect();
        var viewer = document.getElementById('noteExpandViewer');
        var overlay = document.getElementById('noteExpandOverlay');
        var vr = viewer.getBoundingClientRect();
        viewer.style.transformOrigin = (rect.left + rect.width/2 - vr.left) + 'px ' + (rect.top + rect.height/2 - vr.top) + 'px';

        var prompts = loadInsightPrompts();
        var html = '<div style="text-align:center;padding:8px 0 16px">' +
            '<div style="font-family:\'Ma Shan Zheng\',\'KaiTi\',serif;font-size:24px;color:var(--accent);letter-spacing:4px;margin-bottom:4px">洞察</div>' +
            '<div style="font-size:11px;color:var(--text-muted);font-family:\'Noto Sans SC\',sans-serif">选择一种分析模式</div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">' +
            prompts.map(function(p) {
                return '<div class="insight-method-card" onclick="startInsightStream(\'' + noteId + '\',\'' + p.id + '\')" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 12px;cursor:pointer;text-align:center;transition:all 0.2s var(--ease)">' +
                    '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px">' + p.name + '</div>' +
                    '<div style="font-size:11px;color:var(--text-muted);font-family:\'Noto Sans SC\',sans-serif">' + (p.desc || '') + '</div>' +
                    '</div>';
            }).join('') + '</div>';

        document.getElementById('noteExpandDate').textContent = '';
        document.getElementById('noteExpandBody').innerHTML = html;
        overlay.classList.add('open'); viewer.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.openInsightHistory = function() {
        var history = loadInsightHistory();
        var html = '<div style="text-align:center;padding:8px 0 16px">' +
            '<div style="font-family:\'Ma Shan Zheng\',\'KaiTi\',serif;font-size:24px;color:var(--accent);letter-spacing:4px;margin-bottom:4px">历史洞察</div>' +
            '</div>';
        if (history.length === 0) {
            html += '<div style="text-align:center;padding:40px 0;color:var(--text-muted)">暂无历史洞察</div>';
        } else {
            html += history.map(function(h, i) {
                var d = new Date(h.at);
                var ds = (d.getMonth()+1)+'月'+d.getDate()+'日 '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
                return '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer" onclick="viewInsightHistory(' + i + ')">' +
                    '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
                    '<span style="font-size:14px;font-weight:600;color:var(--text)">' + (h.methodName || '洞察') + '</span>' +
                    '<span style="font-size:11px;color:var(--text-muted)">' + ds + '</span>' +
                    '</div>' +
                    '<div style="font-size:12px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (h.notePreview || '').substring(0, 50) + '</div>' +
                    '</div>';
            }).join('');
        }
        document.getElementById('noteExpandDate').textContent = '';
        document.getElementById('noteExpandBody').innerHTML = html;
    };

    window.viewInsightHistory = function(index) {
        var history = loadInsightHistory();
        var h = history[index];
        if (!h) return;
        var html = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
            '<div onclick="openInsightHistory()" style="cursor:pointer;color:var(--accent);font-size:13px;font-family:\'Noto Sans SC\',sans-serif">← 返回列表</div>' +
            '<div style="font-size:14px;font-weight:600;color:var(--text)">' + (h.methodName || '') + '</div>' +
            '</div>' +
            '<div class="insight-note-preview" id="insightNotePreview" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;position:relative">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文</div>' +
            '<div class="insight-note-text" style="font-size:13px;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-family:\'Noto Serif SC\',serif">' + (h.noteContent || '') + '</div>' +
            '</div>' +
            '<div style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)">' + renderMarkdown(h.result || '') + '</div>';
        document.getElementById('noteExpandDate').textContent = '';
        document.getElementById('noteExpandBody').innerHTML = html;
    };

    function renderMarkdown(text) {
        var html = text;
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        html = html.replace(/\n\n/g, '<br><br>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // Strip think blocks even when tags arrive in pieces (streaming-safe)
    function stripThinkBlocks(text) {
        // Remove complete <think>...</think> blocks (case-insensitive)
        var result = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
        // Find any unclosed <think> — hide everything after it
        var openIdx = result.toLowerCase().indexOf('<think>');
        if (openIdx >= 0) {
            result = result.substring(0, openIdx);
        }
        // Clean any remaining tags or partials
        result = result.replace(/<\/?think>/gi, '');
        result = result.replace(/<think[\s\S]*/gi, '');
        // Clean partial opening tags at the very end (streaming)
        result = result.replace(/<\/?t(h(i(n(k?)?)?)?)?$/i, '');
        return result.trim();
    }

    window.startInsightStream = function(noteId, methodId) {
        if (!noteId || !methodId) return;
        insightMethodId = methodId;
        var prompts = loadInsightPrompts();
        var method = prompts.find(function(p) { return p.id === methodId; });
        if (!method) return;

        // Get note content
        var noteContent = '';
        var noteText = '';
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === noteId) { noteContent = notes[i].content; break; }
        }
        noteText = noteContent.replace(/--isHTML\s*/, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/<br\s*\/?>/gi, '\n').trim();
        var plainText = noteText;

        // Show note preview + loading
        document.getElementById('noteExpandDate').textContent = method.name;
        document.getElementById('noteExpandBody').innerHTML =
            '<div class="insight-note-preview" id="insightNotePreview" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;position:relative;cursor:pointer" onclick="toggleInsightNote()">' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文 · 点击展开</div>' +
            '<div class="insight-note-text" id="insightNoteText" style="font-size:13px;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-family:\'Noto Serif SC\',serif">' + noteText + '</div>' +
            '</div>' +
            '<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-family:\'Noto Serif SC\',serif">小满正在思考...</div>';

        // Get API config
        var config;
        try {
            config = JSON.parse(typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : (localStorage.getItem('nian_settings') || '{}'));
        } catch(e) { config = {}; }
        if (!config.apiUrl || !config.apiKey) {
            document.getElementById('noteExpandBody').innerHTML = '<div style="text-align:center;padding:40px 0;color:var(--text-muted)">请先在设置中配置 API</div>';
            return;
        }

        var url = NativeHttp.chatEndpoint(config.apiUrl);
        var bodyEl = document.getElementById('noteExpandBody');
        var fullText = '';

        // Android 端：原生桥不支持流式，改用一次性请求（无 CORS、不阻塞 UI）；
        // 浏览器端：保留流式输出体验
        if (typeof NativeHttp !== 'undefined' && typeof AndroidHttp !== 'undefined') {
            NativeHttp.postJson(url, { Authorization: 'Bearer ' + config.apiKey }, {
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: method.systemPrompt },
                    { role: 'user', content: '请分析以下笔记内容：\n\n' + plainText }
                ],
                max_tokens: 800, temperature: 0.7
            }).then(function(data) {
                var text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (!text) throw new Error('AI 返回为空');
                text = stripThinkBlocks(text);
                bodyEl.innerHTML =
                    '<div class="insight-note-preview" id="insightNotePreview" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;position:relative;cursor:pointer" onclick="toggleInsightNote()">' +
                    '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文 · 点击展开</div>' +
                    '<div class="insight-note-text" id="insightNoteText" style="font-size:13px;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-family:\'Noto Serif SC\',serif">' + noteText + '</div>' +
                    '</div>' +
                    '<div class="insight-stream-content" id="insightStreamContent" style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)">' + (renderMarkdown(text) || '(暂无内容)') + '</div>';
                saveInsightHistory({ at: Date.now(), methodId: methodId, methodName: method.name, noteId: noteId, noteContent: noteText, notePreview: noteText.substring(0, 80), result: text });
            }).catch(function(e) {
                bodyEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:#c0392b">请求失败: ' + e.message + '</div>';
            });
            return;
        }

        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.apiKey },
            body: JSON.stringify({
                model: config.model || 'gpt-4o',
                messages: [
                    { role: 'system', content: method.systemPrompt },
                    { role: 'user', content: '请分析以下笔记内容：\n\n' + plainText }
                ],
                stream: true, max_tokens: 800, temperature: 0.7
            })
        }).then(function(response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            var reader = response.body.getReader();
            var decoder = new TextDecoder();
            var buffer = '';

            // Replace loading with stream content + note preview
            bodyEl.innerHTML =
                '<div class="insight-note-preview" id="insightNotePreview" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;position:relative;cursor:pointer" onclick="toggleInsightNote()">' +
                '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文 · 点击展开</div>' +
                '<div class="insight-note-text" id="insightNoteText" style="font-size:13px;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-family:\'Noto Serif SC\',serif">' + noteText + '</div>' +
                '</div>' +
                '<div class="insight-stream-content" id="insightStreamContent" style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)"></div>';

            function readChunk() {
                reader.read().then(function(result) {
                    if (result.done) {
                        var clean = stripThinkBlocks(fullText);
                        if (!document.getElementById('insightStreamContent')) {
                            bodyEl.innerHTML = bodyEl.innerHTML.replace('小满正在思考...', '');
                            bodyEl.innerHTML += '<div class="insight-stream-content" id="insightStreamContent" style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)"></div>';
                        }
                        document.getElementById('insightStreamContent').innerHTML = renderMarkdown(clean) || '(暂无内容)';
                        saveInsightHistory({ at: Date.now(), methodId: methodId, methodName: method.name, noteId: noteId, noteContent: noteText, notePreview: noteText.substring(0, 80), result: clean });
                        return;
                    }
                    buffer += decoder.decode(result.value, {stream: true});
                    var lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    lines.forEach(function(line) {
                        if (line.indexOf('data: ') === 0) {
                            var data = line.substring(6).trim();
                            if (data === '[DONE]') return;
                            try {
                                var json = JSON.parse(data);
                                var content = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
                                if (content) { fullText += content; }
                            } catch(e) {}
                        }
                    });
                    // Check if think block has ended — then show content
                    var hasThinkEnd = /<\/think>/i.test(fullText);
                    var hasContent = stripThinkBlocks(fullText).trim().length > 0;
                    if ((hasThinkEnd || hasContent) && !document.getElementById('insightStreamContent')) {
                        bodyEl.innerHTML =
                            '<div class="insight-note-preview" id="insightNotePreview" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;position:relative;cursor:pointer" onclick="toggleInsightNote()">' +
                            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文 · 点击展开</div>' +
                            '<div class="insight-note-text" id="insightNoteText" style="font-size:13px;color:var(--text-secondary);line-height:1.6;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;font-family:\'Noto Serif SC\',serif">' + noteText + '</div>' +
                            '</div>' +
                            '<div class="insight-stream-content" id="insightStreamContent" style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)"></div>';
                    }
                    if (document.getElementById('insightStreamContent')) {
                        var displayText = stripThinkBlocks(fullText);
                        document.getElementById('insightStreamContent').innerHTML = renderMarkdown(displayText);
                    }
                    readChunk();
                }).catch(function() {});
            }
            readChunk();
        }).catch(function(e) {
            bodyEl.innerHTML = '<div style="text-align:center;padding:40px 0;color:#c0392b">请求失败: ' + e.message + '</div>';
        });
    };

    window.toggleInsightNote = function() {
        var el = document.getElementById('insightNoteText');
        if (!el) return;
        var expanded = el.style.webkitLineClamp === 'unset';
        el.style.display = expanded ? '-webkit-box' : 'block';
        el.style.webkitLineClamp = expanded ? '4' : 'unset';
        el.style.overflow = expanded ? 'hidden' : 'visible';
        var label = el.parentElement.querySelector('div');
        if (label) label.textContent = expanded ? '笔记原文 · 点击展开' : '笔记原文 · 点击收起';
    };

    // ── Insight Hub Page ──
    function loadAllInsightPrompts() {
        var prompts = [];
        try {
            var s = JSON.parse(typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : (localStorage.getItem('nian_settings') || '{}'));
            if (s && s.insightPrompts) prompts = typeof s.insightPrompts === 'string' ? JSON.parse(s.insightPrompts) : s.insightPrompts;
        } catch(e) {}
        if (!prompts || !prompts.length) {
            try { prompts = INSIGHT_PROMPTS; } catch(e) { prompts = []; }
        }
        return prompts;
    }

    window.switchToInsightHub = function() {
        ['notesPage','nianPage','mePage','explorePage'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });
        document.getElementById('insightHubPage').classList.add('active');
        ['navNotes','navNian','navExplore'].forEach(function(id) { document.getElementById(id).classList.remove('active'); });

        // Header: back button replaces hamburger, add action icons
        var header = document.getElementById('appHeader');
        header.style.display = 'flex';
        var hamburger = header.querySelector('.header-icon');
        if (hamburger) hamburger.setAttribute('onclick', 'switchToNotes()');
        // Update hamburger SVG to back arrow
        var svg = hamburger ? hamburger.querySelector('svg') : null;
        if (svg) svg.innerHTML = '<polyline points="15 18 9 12 15 6"/>';

        var brand = document.getElementById('headerBrand'); if (brand) brand.remove();
        var dd = document.getElementById('headerTagDropdown'); if (dd) dd.remove();
        var sc = document.getElementById('searchContainer'); if (sc) sc.remove();
        var si = document.querySelector('.search-icon'); if (si) si.remove();
        var hi = document.getElementById('historyIcon'); if (hi) hi.style.display = 'none';
        var hr = document.getElementById('headerRight');
        if (hr) {
            hr.style.display = '';
            hr.innerHTML = '<div class="header-icon" onclick="insightHubHistory()" title="历史洞察">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>';
        }

        // Hide bottom nav
        var bn = document.querySelector('.bottom-nav'); if (bn) bn.style.display = 'none';
        var fab = document.getElementById('noteFab'); if (fab) fab.classList.add('hidden');
        closeFab(); closeSidebar(); showNoteFab(false);

        // Render method grid
        var prompts = loadAllInsightPrompts();
        var grid = document.getElementById('insightHubGrid');
        if (grid) {
            grid.className = 'insight-hub-grid';
            grid.innerHTML = prompts.map(function(p) {
                return '<div class="insight-hub-card" onclick="openMethodEditor(\'' + p.id + '\')">' +
                    '<div class="insight-hub-card-name">' + p.name + '</div>' +
                    '<div class="insight-hub-card-desc">' + (p.desc || '') + '</div></div>';
            }).join('');
        }
        updateDrawerActive('insight');
    };

    // ── Method Editor Popup ──
    window.openMethodEditor = function(methodId) {
        var prompts = loadAllInsightPrompts();
        var method = prompts.find(function(p) { return p.id === methodId; });
        if (!method) return;

        var viewer = document.getElementById('noteExpandViewer');
        var overlay = document.getElementById('noteExpandOverlay');
        if (!viewer || !overlay) return;
        viewer.style.transformOrigin = (window.innerWidth/2) + 'px ' + (window.innerHeight*0.3) + 'px';

        document.getElementById('noteExpandDate').textContent = '';
        document.getElementById('noteExpandBody').innerHTML =
            '<div style="padding:8px 0 4px">' +
            '<div style="font-family:\'Noto Sans SC\',sans-serif;font-size:10px;color:var(--text-muted);letter-spacing:0.2em;margin-bottom:4px">' + methodId + '</div>' +
            '<div style="font-family:\'Noto Serif SC\',serif;font-size:17px;font-weight:600;color:var(--text);margin-bottom:6px" id="editMethodName" contenteditable="false">' + method.name + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;font-family:\'Noto Sans SC\',sans-serif" id="editMethodDesc" contenteditable="false">' + (method.desc || '') + '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">提示词</div>' +
            '<div id="editMethodPrompt" contenteditable="false" style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;font-family:\'Noto Serif SC\',serif;font-size:13px;line-height:1.7;color:var(--text);min-height:120px;white-space:pre-wrap">' + (method.systemPrompt || '') + '</div>' +
            '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">' +
            '<button id="editMethodBtn" onclick="toggleMethodEdit(\'' + methodId + '\')" style="padding:8px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent-light);color:var(--accent);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">编辑</button>' +
            '<button id="saveMethodBtn" onclick="saveMethodEdit(\'' + methodId + '\')" style="display:none;padding:8px 18px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">保存</button>' +
            '</div>';

        overlay.classList.add('open'); viewer.classList.add('open');
        document.body.style.overflow = 'hidden';
    };

    window.toggleMethodEdit = function(methodId) {
        document.getElementById('editMethodName').contentEditable = 'true';
        document.getElementById('editMethodDesc').contentEditable = 'true';
        document.getElementById('editMethodPrompt').contentEditable = 'true';
        document.getElementById('editMethodName').focus();
        document.getElementById('editMethodBtn').style.display = 'none';
        document.getElementById('saveMethodBtn').style.display = '';
    };

    window.saveMethodEdit = function(methodId) {
        var name = document.getElementById('editMethodName').textContent.trim();
        var desc = document.getElementById('editMethodDesc').textContent.trim();
        var prompt = document.getElementById('editMethodPrompt').textContent.trim();
        if (!name || !prompt) return;

        // Save to settings
        try {
            var raw = typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
            var s = raw ? JSON.parse(raw) : {};
            var prompts = s.insightPrompts;
            if (typeof prompts === 'string') prompts = JSON.parse(prompts);
            if (!prompts || !Array.isArray(prompts)) prompts = INSIGHT_PROMPTS.slice();

            var found = false;
            for (var i = 0; i < prompts.length; i++) {
                if (prompts[i].id === methodId) {
                    prompts[i].name = name;
                    prompts[i].desc = desc;
                    prompts[i].systemPrompt = prompt;
                    found = true; break;
                }
            }
            if (!found) prompts.push({ id: methodId, name: name, desc: desc, systemPrompt: prompt });

            s.insightPrompts = prompts;
            if (typeof AndroidSettings !== 'undefined') {
                AndroidSettings.saveSettings(JSON.stringify(s));
            } else {
                localStorage.setItem('nian_settings', JSON.stringify(s));
            }
        } catch(e) {}

        // Update UI
        document.getElementById('editMethodName').contentEditable = 'false';
        document.getElementById('editMethodDesc').contentEditable = 'false';
        document.getElementById('editMethodPrompt').contentEditable = 'false';
        document.getElementById('editMethodBtn').style.display = '';
        document.getElementById('saveMethodBtn').style.display = 'none';

        // Refresh grid
        var grid = document.getElementById('insightHubGrid');
        if (grid) {
            var prompts = loadAllInsightPrompts();
            grid.innerHTML = prompts.map(function(p) {
                return '<div class="insight-hub-card" onclick="openMethodEditor(\'' + p.id + '\')">' +
                    '<div class="insight-hub-card-name">' + p.name + '</div>' +
                    '<div class="insight-hub-card-desc">' + (p.desc || '') + '</div></div>';
            }).join('');
        }
    };

    window.insightHubPickNote = function(methodId) {
        var prompts = loadAllInsightPrompts();
        var method = prompts.find(function(p) { return p.id === methodId; });
        var grid = document.getElementById('insightHubGrid');
        if (!grid) return;
        grid.className = 'insight-hub-list';
        grid.innerHTML = '<div style="font-family:\'Ma Shan Zheng\',\'KaiTi\',serif;font-size:22px;color:var(--accent);letter-spacing:4px;text-align:center;padding:8px 0 16px">' + (method ? method.name : '') + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);text-align:center;margin-bottom:12px;font-family:\'Noto Sans SC\',sans-serif">选择一篇笔记</div>' +
            notes.slice(0, 30).map(function(n) {
                var d = new Date(n.createdAt);
                var ds = (d.getMonth()+1)+'月'+d.getDate()+'日';
                return '<div class="insight-hub-history-item" onclick="startInsightStream(\'' + n.id + '\',\'' + methodId + '\')">' +
                    '<div class="insight-hub-history-meta"><span class="insight-hub-history-name">' + ds + '</span></div>' +
                    '<div class="insight-hub-history-preview">' + (n.content || '').replace(/<[^>]+>/g, '').substring(0, 60) + '</div></div>';
            }).join('');
    };

    window.insightHubHistory = function() {
        var grid = document.getElementById('insightHubGrid');
        if (!grid) return;
        var history = loadInsightHistory();
        grid.className = 'insight-hub-list';
        if (history.length === 0) {
            grid.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--text-muted);font-family:\'Noto Serif SC\',serif">暂无历史洞察</div>';
        } else {
            grid.innerHTML = history.map(function(h, i) {
                var d = new Date(h.at);
                var ds = (d.getMonth()+1)+'月'+d.getDate()+'日 '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
                return '<div class="insight-hub-history-item" onclick="insightHubViewHistory(' + i + ')">' +
                    '<div class="insight-hub-history-meta"><span class="insight-hub-history-name">' + (h.methodName || '洞察') + '</span><span class="insight-hub-history-date">' + ds + '</span></div>' +
                    '<div class="insight-hub-history-preview">' + (h.notePreview || '').substring(0, 60) + '</div></div>';
            }).join('');
        }
    };

    window.insightHubViewHistory = function(index) {
        var history = loadInsightHistory();
        var h = history[index];
        if (!h) return;
        var grid = document.getElementById('insightHubGrid');
        if (!grid) return;
        grid.className = 'insight-hub-list';
        grid.innerHTML = '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;cursor:pointer" onclick="insightHubHistory()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;color:var(--accent)"><polyline points="15 18 9 12 15 6"/></svg>' +
            '<span style="font-size:13px;color:var(--accent);font-family:\'Noto Sans SC\',sans-serif">返回列表</span></div>' +
            '<div class="insight-hub-history-item" style="cursor:default"><div class="insight-hub-history-meta"><span class="insight-hub-history-name">' + (h.methodName || '') + '</span><span class="insight-hub-history-date">' + (h.at ? new Date(h.at).toLocaleString() : '') + '</span></div></div>' +
            '<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px"><div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;font-family:\'Noto Sans SC\',sans-serif">笔记原文</div><div style="font-size:13px;color:var(--text-secondary);line-height:1.6;font-family:\'Noto Serif SC\',serif">' + (h.noteContent || '') + '</div></div>' +
            '<div style="font-family:\'Noto Serif SC\',serif;font-size:15px;line-height:1.9;color:var(--text)">' + renderMarkdown(h.result || '') + '</div>';
    };

    // Monkey-patch: sidebar 洞察 → hub page
    var _origOpenInsight = openInsight;
    window.openInsight = function() { switchToInsightHub(); };

    // Monkey-patch: note menu 洞察 → note-based viewer
    var _origOpenInsightSheet = openInsightSheet;
    window.openInsightSheet = function(noteId) {
        closeAllNoteMenus();
        openInsightViewer(noteId);
    };

    document.addEventListener('click', function(e) {
        var card = e.target.closest('.insight-method-card');
        if (card) {
            card.style.transform = 'scale(0.96)';
            card.style.borderColor = 'var(--accent)';
        }
    });

    var _toggleNoteExpand = toggleNoteExpand;
    window.toggleNoteExpand = function(cardEl) { openNoteExpand(cardEl); };

    // ── Fix note menu stacking: elevate wrapper + section when menu opens ──
    var _origToggleNoteMenu = toggleNoteMenu;
    window.toggleNoteMenu = function(btn) {
        _origToggleNoteMenu(btn);
        document.querySelectorAll('.note-card-wrapper').forEach(function(w) { w.style.zIndex = ''; });
        document.querySelectorAll('.notes-section').forEach(function(s) { s.style.zIndex = ''; });
        var menu = btn.nextElementSibling;
        if (menu && menu.classList.contains('open')) {
            var wrapper = btn.closest('.note-card-wrapper');
            var section = btn.closest('.notes-section');
            if (wrapper) wrapper.style.zIndex = '999';
            if (section) section.style.zIndex = '10';
        }
    };

    // Also reset z-index when menus close via click-outside
    var _origCloseAllNoteMenus = closeAllNoteMenus;
    window.closeAllNoteMenus = function() {
        _origCloseAllNoteMenus();
        document.querySelectorAll('.note-card-wrapper').forEach(function(w) { w.style.zIndex = ''; });
        document.querySelectorAll('.notes-section').forEach(function(s) { s.style.zIndex = ''; });
    };

    // ── Note Picker: single-column, 3-line, searchable ──
    window.filterNotePicker = function() {
        var query = (document.getElementById('notePickerSearch').value || '').toLowerCase();
        var items = document.querySelectorAll('#notePickerList .penpal-sheet-item');
        items.forEach(function(item) {
            var text = (item.textContent || '').toLowerCase();
            item.style.display = query ? (text.indexOf(query) >= 0 ? '' : 'none') : '';
        });
    };
    var _openNotePicker = openNotePicker;
    window.openNotePicker = function() {
        _openNotePicker();
        setTimeout(function() {
            var items = document.querySelectorAll('#notePickerList .penpal-sheet-item');
            items.forEach(function(item) {
                var children = item.children;
                if (children.length >= 2 && !item.querySelector('.np-date')) {
                    children[0].className = 'np-date';
                    children[1].className = 'np-text';
                }
            });
            var searchEl = document.getElementById('notePickerSearch');
            if (searchEl) searchEl.value = '';
            filterNotePicker();
        }, 10);
    };

    // ── Pull-down Header Reveal ──
    var contentEl = document.getElementById('appContent');
    var yearBar = document.getElementById('notesYearBar');
    var headerEl = document.getElementById('notesEditorialHeader');
    var revealTimer = null, hasScrolled = false;

    var updateYearBar = function() {
        if (!yearBar || typeof notes === 'undefined' || !notes.length) return;
        var y = new Date(notes[0].createdAt).getFullYear();
        yearBar.innerHTML = '<span class="yr">' + y + '</span> · JOURNAL';
    };

    var updateHeaderMeta = function() {
        if (typeof notes === 'undefined' || !notes.length) return;
        var years = notes.map(function(n) { return new Date(n.createdAt).getFullYear(); });
        var minY = Math.min.apply(null, years);
        var maxY = Math.max.apply(null, years);
        var countEl = document.getElementById('headerNoteCount');
        if (countEl) countEl.textContent = notes.length;
        var metaEl = document.querySelector('.notes-header-meta');
        if (metaEl) metaEl.textContent = minY === maxY ? '— from the quiet hours, ' + maxY + ' —' : '— from the quiet hours, ' + minY + '-' + maxY + ' —';
    };

    // Year bar always visible
    setTimeout(function() { updateYearBar(); updateHeaderMeta(); }, 300);

    if (contentEl) {
        contentEl.addEventListener('scroll', function() {
            updateYearBar();
            if (contentEl.scrollTop > 80) {
                hasScrolled = true;
                if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
                if (headerEl) headerEl.classList.remove('revealed');
            }
            // Reveal on pull to top (more generous threshold)
            if (contentEl.scrollTop <= 10 && hasScrolled && headerEl && !headerEl.classList.contains('revealed')) {
                if (!revealTimer) revealTimer = setTimeout(function() {
                    headerEl.classList.add('revealed');
                    updateHeaderMeta();
                    revealTimer = null;
                }, 350);
            }
            // Scroll away from top → hide
            if (contentEl.scrollTop > 30 && headerEl && headerEl.classList.contains('revealed')) {
                headerEl.classList.remove('revealed');
            }
        }, {passive: true});
    }

    // ── Scroll Stagger ──
    var staggerTimer = null, lastScrollY = 0, scrollVelocity = 0;
    if (contentEl) {
        contentEl.addEventListener('scroll', function() {
            var sy = contentEl.scrollTop;
            scrollVelocity = sy - lastScrollY; lastScrollY = sy;
            if (staggerTimer) clearTimeout(staggerTimer);
            var cards = document.querySelectorAll('#notesList .note-card-wrapper');
            cards.forEach(function(wrapper) {
                var rect = wrapper.getBoundingClientRect();
                var dist = (rect.top + rect.height / 2 - contentEl.clientHeight / 2) / contentEl.clientHeight;
                var offset = Math.max(-12, Math.min(12, scrollVelocity * 0.15 * dist));
                wrapper.style.transform = 'translateY(' + offset + 'px)';
            });
            staggerTimer = setTimeout(function() {
                document.querySelectorAll('#notesList .note-card-wrapper').forEach(function(w) { w.style.transform = ''; });
            }, 150);
        }, {passive: true});
    }

    var expandObserver = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                var section = entry.target.closest('.notes-section');
                if (section && section.classList.contains('collapsed')) {
                    section.classList.remove('collapsed');
                }
                expandObserver.unobserve(entry.target);
            }
        });
    }, { rootMargin: '0px 0px 200px 0px' });

    setTimeout(function() {
        document.querySelectorAll('.notes-section.collapsed .notes-section-header').forEach(function(h) {
            expandObserver.observe(h);
        });
    }, 1000);

    // ── Heatmap tooltips: show note count per day ──
    window.addHeatmapTooltips = function() {
        var cells = document.querySelectorAll('.heatmap-cell, .sidebar-heatmap-cell');
        if (!cells.length || typeof notes === 'undefined') return;
        var now = new Date();
        cells.forEach(function(cell, i) {
            var date = new Date(now);
            date.setDate(date.getDate() - (cells.length - 1 - i));
            var ds = date.toISOString().substring(0, 10);
            var count = notes.filter(function(n) { return n.createdAt.substring(0, 10) === ds; }).length;
            if (count > 0) {
                var m = date.getMonth() + 1, d = date.getDate();
                cell.title = m + '月' + d + '日 — ' + count + ' 篇笔记';
            }
        });
    };

    // ── Init ──
    if (document.getElementById('notesPage').classList.contains('active')) { updateDrawerActive('notes'); showNoteFab(true); }
    else if (document.getElementById('nianPage').classList.contains('active')) { updateDrawerActive('nian'); showNoteFab(false); }

    // ── Me Profile: editable name/avatar/signature ──
    window.loadMeProfile = function() {
        try {
            var s = JSON.parse(typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : (localStorage.getItem('nian_settings') || '{}'));
            var p = s.meProfile || {};
            if (p.name) document.getElementById('meName').textContent = p.name;
            if (p.avatar) document.getElementById('meAvatar').textContent = p.avatar;
            if (p.signature) document.getElementById('meSub').textContent = p.signature;
        } catch(e) {}
    };

    var saveMeTimer = null;
    function saveMeProfile() {
        if (saveMeTimer) clearTimeout(saveMeTimer);
        saveMeTimer = setTimeout(function() {
            try {
                var raw = typeof AndroidSettings !== 'undefined' ? AndroidSettings.loadSettings() : localStorage.getItem('nian_settings');
                var s = raw ? JSON.parse(raw) : {};
                s.meProfile = {
                    name: document.getElementById('meName').textContent.trim(),
                    avatar: document.getElementById('meAvatar').textContent.trim(),
                    signature: document.getElementById('meSub').textContent.trim()
                };
                if (typeof AndroidSettings !== 'undefined') AndroidSettings.saveSettings(JSON.stringify(s));
                else localStorage.setItem('nian_settings', JSON.stringify(s));
            } catch(e) {}
        }, 500);
    }

    window.editMeAvatar = function() {
        var avatars = ['我','风','月','光','静','暖','心','星','梦','云','花','雨','雪','山','海','空'];
        var cur = document.getElementById('meAvatar').textContent.trim();
        var idx = avatars.indexOf(cur);
        idx = (idx + 1) % avatars.length;
        document.getElementById('meAvatar').textContent = avatars[idx];
        saveMeProfile();
    };

    // Auto-save on blur/input
    var meName = document.getElementById('meName'), meSub = document.getElementById('meSub');
    if (meName) meName.addEventListener('blur', saveMeProfile);
    if (meName) meName.addEventListener('input', saveMeProfile);
    if (meSub) meSub.addEventListener('blur', saveMeProfile);
    if (meSub) meSub.addEventListener('input', saveMeProfile);
})();

const state = {
    user: document.body.getAttribute('data-username'),
    isOwner: document.body.getAttribute('data-is-owner') === 'true',
    path: '',
    isVault: false,
    selection: [],
    clipboard: null,
    chatTarget: null,
    chatInterval: null,
    dragCounter: 0,
    editingPath: null
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function showToast(msg, type = 'info') {
    const box = $('#toast-container');
    if (!box) return;
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-circle-exclamation';
    div.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${escapeHtml(msg)}</span>`;
    box.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateY(-20px)';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
}

function formatTime(timestamp) {
    return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function api(url, opts = {}) {
    try {
        const res = await fetch(url, opts);
        if (res.status === 401 && !url.includes('/login')) {
            window.location.reload();
            return null;
        }
        const type = res.headers.get("content-type");
        if (type && type.includes("application/json")) {
            const data = await res.json();
            if (!res.ok) throw new Error(data.msg || data.error || `Error ${res.status}`);
            return data;
        }
        if (!res.ok) throw new Error(res.statusText);
        return await res.text();
    } catch (e) {
        showToast(e.message, 'error');
        throw e;
    }
}

function switchAuth(mode) {
    if (mode === 'login') {
        $('#form-login').classList.remove('hidden');
        $('#form-register').classList.add('hidden');
        $('#tab-login').classList.add('active');
        $('#tab-register').classList.remove('active');
    } else {
        $('#form-login').classList.add('hidden');
        $('#form-register').classList.remove('hidden');
        $('#tab-login').classList.remove('active');
        $('#tab-register').classList.add('active');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;
    const fd = new FormData();
    fd.append('username', $('#login-user').value);
    fd.append('password', $('#login-pass').value);
    try {
        const res = await fetch('/login', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') window.location.reload();
        else showToast(data.msg, 'error');
    } catch (err) {
        showToast('Connection Failed', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;
    const fd = new FormData();
    fd.append('username', $('#reg-user').value);
    fd.append('password', $('#reg-pass').value);
    try {
        const res = await fetch('/register', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.status === 'success') {
            showToast('Account Created!', 'success');
            switchAuth('login');
        } else {
            showToast(data.msg, 'error');
        }
    } catch (err) {
        showToast('Connection Failed', 'error');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

if (state.user) {
    document.addEventListener('DOMContentLoaded', () => {
        navigate('home');
        $('#theme-toggle')?.addEventListener('click', () => {
            const b = document.body;
            const t = b.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            b.setAttribute('data-theme', t);
            $('#theme-toggle i').className = t === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.context-menu')) $('#context-menu').classList.add('hidden');
            if (!e.target.closest('.create-menu') && !e.target.closest('#create-trigger')) $('#create-menu').classList.add('hidden');
        });
        if (window.matchMedia("(min-width: 768px)").matches) {
            const dropZone = $('#drop-zone');
            document.body.addEventListener('dragenter', (e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    state.dragCounter++;
                    dropZone.classList.add('active');
                }
            });
            document.body.addEventListener('dragleave', (e) => {
                if (e.dataTransfer.types.includes('Files')) {
                    e.preventDefault();
                    state.dragCounter--;
                    if (state.dragCounter === 0) dropZone.classList.remove('active');
                }
            });
            document.body.addEventListener('dragover', (e) => e.preventDefault());
            document.body.addEventListener('drop', (e) => {
                e.preventDefault();
                state.dragCounter = 0;
                dropZone.classList.remove('active');
                if (e.dataTransfer.files.length > 0) FileManager.upload({ files: e.dataTransfer.files });
            });
        }
    });
}

function navigate(view) {
    $$('.view-port').forEach(v => v.classList.remove('active'));
    $$('.nav-link').forEach(n => n.classList.remove('active'));
    $(`#view-${view}`)?.classList.add('active');
    $$(`[data-target="${view}"]`).forEach(el => el.classList.add('active'));
    if (view === 'files') FileManager.load();
    if (view === 'home') loadStats();
    if (view === 'chat') Chat.loadLobby();
    else clearInterval(state.chatInterval);
}

function openLibrary(isVault) {
    state.isVault = isVault;
    state.path = '';
    navigate('files');
}

const FileManager = {
    async load() {
        $('#loader').classList.remove('hidden');
        state.selection = [];
        this.updateUI();
        try {
            const data = await api(`/api/files?path=${encodeURIComponent(state.path)}&vault=${state.isVault ? '1' : '0'}`);
            this.render(data.files || []);
        } catch (e) {
            $('#file-list').innerHTML = `<div style="text-align:center; padding:30px; color:#666">Error loading files</div>`;
        } finally {
            $('#loader').classList.add('hidden');
        }
    },
    render(files) {
        const list = $('#file-list');
        list.innerHTML = '';
        const bc = $('#breadcrumbs');
        bc.innerHTML = `<span onclick="state.path='';FileManager.load()">${state.isVault ? 'Vault' : 'Public'}</span>` +
            state.path.split('/').filter(Boolean).map((p, i, a) =>
                ` / <span onclick="state.path='${a.slice(0, i + 1).join('/')}';FileManager.load()">${p}</span>`
            ).join('');
        if (state.path) {
            list.innerHTML += `<div class="file-row" onclick="FileManager.up()">
                <i class="fa-solid fa-turn-up" style="color:var(--accent)"></i> <b>..</b>
            </div>`;
        }
        if (files.length === 0) {
            list.innerHTML += `<div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Empty Folder</p></div>`;
            return;
        }
        files.sort((a, b) => (b.is_dir - a.is_dir) || a.name.localeCompare(b.name));
        files.forEach(f => {
            const isSel = state.selection.includes(f.name);
            const div = document.createElement('div');
            div.className = `file-row ${isSel ? 'selected' : ''}`;
            const icon = f.is_dir ? 'fa-folder' : 'fa-file';
            const color = f.is_dir ? '#fbbf24' : '#888';
            div.innerHTML = `
                <i class="fa-solid ${icon}" style="color:${color}"></i>
                <div class="file-info">
                    <div class="file-name">${escapeHtml(f.name)}</div>
                    <div class="file-meta">${f.is_dir ? 'Folder' : formatBytes(f.size)}</div>
                </div>
                <i class="fa-solid fa-ellipsis-vertical" style="padding:10px; color:var(--text-dim);" onclick="FileManager.menu(event, '${f.name}', ${f.is_dir})"></i>
            `;
            div.onclick = (e) => {
                if (e.target.classList.contains('fa-ellipsis-vertical')) return;
                if (state.selection.length > 0) this.toggle(f.name);
                else if (f.is_dir) { state.path = state.path ? `${state.path}/${f.name}` : f.name; this.load(); }
                else this.preview(f.name);
            };
            div.oncontextmenu = (e) => { e.preventDefault(); this.menu(e, f.name, f.is_dir); };
            list.appendChild(div);
        });
    },
    toggle(name) {
        if (state.selection.includes(name)) state.selection = state.selection.filter(n => n !== name);
        else state.selection.push(name);
        this.updateUI();
        this.load();
    },
    updateUI() {
        const bar = $('#selection-bar');
        if (state.selection.length > 0) {
            bar.classList.remove('hidden');
            $('#sel-count').innerText = state.selection.length;
        } else {
            bar.classList.add('hidden');
        }
        if (state.clipboard) $('#paste-btn').classList.remove('hidden');
        else $('#paste-btn').classList.add('hidden');
    },
    menu(e, name, isDir) {
        e.stopPropagation();
        e.preventDefault();
        state.contextTarget = name;
        const menu = $('#context-menu');
        const isZip = name.endsWith('.zip');
        menu.innerHTML = `
            <div class="context-item" onclick="FileManager.action('copy', '${name}')"><i class="fa-solid fa-copy"></i> Copy</div>
            <div class="context-item" onclick="FileManager.action('cut', '${name}')"><i class="fa-solid fa-scissors"></i> Cut</div>
            <div class="context-item" onclick="FileManager.rename('${name}')"><i class="fa-solid fa-pen"></i> Rename</div>
            ${isDir ? `<div class="context-item" onclick="FileManager.zip('${name}')"><i class="fa-solid fa-file-zipper"></i> Zip</div>` : ''}
            ${isZip ? `<div class="context-item" onclick="FileManager.unzip('${name}')"><i class="fa-solid fa-box-open"></i> Unzip</div>` : ''}
            <div class="context-divider"></div>
            <div class="context-item" style="color:var(--danger)" onclick="FileManager.deleteItem('${name}')"><i class="fa-solid fa-trash"></i> Delete</div>
        `;
        const menuWidth = 200;
        const menuHeight = 250;
        let x = e.clientX || e.touches?.[0].clientX || 50;
        let y = e.clientY || e.touches?.[0].clientY || 50;
        if (x + menuWidth > window.innerWidth) x -= menuWidth;
        if (y + menuHeight > window.innerHeight) y -= menuHeight;
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        menu.classList.remove('hidden');
    },
    action(mode, name) {
        state.clipboard = { mode, files: [name], path: state.path, vault: state.isVault };
        showToast(`${mode === 'copy' ? 'Copied' : 'Cut'} to clipboard`);
        $('#context-menu').classList.add('hidden');
        this.updateUI();
    },
    clipboard(mode) {
        state.clipboard = { mode, files: [...state.selection], path: state.path, vault: state.isVault };
        state.selection = [];
        this.load();
        showToast(`${state.clipboard.files.length} items to clipboard`);
    },
    async paste() {
        if (!state.clipboard) return;
        showToast("Simulating Paste...", "info");
        state.clipboard = null;
        this.load();
    },
    async rename(name) {
        $('#context-menu').classList.add('hidden');
        const newName = prompt("New Name:", name);
        if (newName && newName !== name) {
            await api('/api/rename', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_path: state.path ? `${state.path}/${name}` : name, new_name: newName, vault: state.isVault ? 1 : 0 })
            });
            this.load();
        }
    },
    async deleteItem(name) {
        if (!confirm(`Delete ${name}?`)) return;
        await this.runDelete([name]);
        $('#context-menu').classList.add('hidden');
    },
    async delete() {
        if (!confirm(`Delete ${state.selection.length} items?`)) return;
        await this.runDelete(state.selection);
    },
    async runDelete(files) {
        await api('/api/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: files.map(f => state.path ? `${state.path}/${f}` : f), vault: state.isVault ? 1 : 0 })
        });
        state.selection = [];
        this.load();
    },
    async zip(name) {
        showToast("Compressing...", "info");
        await api('/api/zip', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [name], path: state.path, vault: state.isVault ? 1 : 0 })
        });
        $('#context-menu').classList.add('hidden');
        this.load();
    },
    async unzip(name) {
        showToast("Extracting...", "info");
        await api('/api/unzip', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: name, path: state.path, vault: state.isVault ? 1 : 0 })
        });
        $('#context-menu').classList.add('hidden');
        this.load();
    },
    preview(name) {
        const ext = name.split('.').pop().toLowerCase();
        const fullPath = state.path ? `${state.path}/${name}` : name;
        const dlUrl = `/api/download?path=${encodeURIComponent(fullPath)}&vault=${state.isVault ? '1' : '0'}`;
        const modal = $('#media-modal');
        const content = $('#media-content');
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            content.innerHTML = `<img src="${dlUrl}" style="max-width:100%; border-radius:8px;">`;
            modal.classList.remove('hidden');
        } else if (['mp4', 'webm', 'mov'].includes(ext)) {
            content.innerHTML = `<video controls autoplay src="${dlUrl}" style="max-width:100%; border-radius:8px;"></video>`;
            modal.classList.remove('hidden');
        } else if (['txt', 'py', 'js', 'html', 'css', 'json', 'md', 'sh'].includes(ext)) {
            this.openEditor(fullPath);
        } else {
            window.location.href = dlUrl;
        }
    },
    async openEditor(path) {
        $('#loader').classList.remove('hidden');
        try {
            const res = await api(`/api/get_content?path=${encodeURIComponent(path)}&vault=${state.isVault ? 1 : 0}`);
            if (res.content !== undefined) {
                $('#editor-modal').classList.remove('hidden');
                $('#editor-filename').textContent = path;
                $('#code-content').value = res.content;
                state.editingPath = path;
            }
        } catch (e) {}
        $('#loader').classList.add('hidden');
    },
    async saveFile() {
        if (!state.editingPath) return;
        const content = $('#code-content').value;
        await api('/api/save_file', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: state.editingPath, content, vault: state.isVault ? 1 : 0 })
        });
        showToast('Saved!', 'success');
        $('#editor-modal').classList.add('hidden');
    },
    async create(type) {
        const name = prompt("Name:");
        if (name) {
            let finalName = name;
            if (type === 'file' && !name.includes('.')) finalName += '.txt';
            if (type === 'py' && !name.endsWith('.py')) finalName += '.py';
            await api('/api/create', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: finalName, type: type === 'folder' ? 'folder' : 'file', path: state.path, vault: state.isVault ? 1 : 0 })
            });
            this.load();
            if (type !== 'folder') this.openEditor(state.path ? `${state.path}/${finalName}` : finalName);
        }
        $('#create-menu').classList.add('hidden');
    },
    async createFolder() { this.create('folder'); },
    async upload(input) {
        const fd = new FormData();
        fd.append('path', state.path);
        fd.append('vault', state.isVault ? 1 : 0);
        const filesToUpload = input.files || (input instanceof HTMLInputElement ? input.files : []);
        if (filesToUpload.length === 0 && input.length > 0) {
            for (let f of input) fd.append('files', f);
        } else {
            for (let f of filesToUpload) fd.append('files', f);
        }
        $('#loader').classList.remove('hidden');
        await fetch('/api/upload', { method: 'POST', body: fd });
        $('#loader').classList.add('hidden');
        this.load();
        if (input.value) input.value = '';
    },
    up() {
        if (!state.path) return;
        state.path = state.path.split('/').slice(0, -1).join('/');
        this.load();
    },
    clearSelection() { state.selection = []; this.load(); }
};

const Chat = {
    async loadLobby() {
        $('#chat-lobby').classList.remove('hidden');
        $('#chat-room').classList.add('hidden');
        try {
            const data = await api('/api/chat_users');
            const list = $('#chat-user-list');
            list.innerHTML = (data.users || []).map(u => `
                <div class="chat-user-item" onclick="Chat.open('${u.name}')">
                    <img src="/api/avatar/${u.name}" class="chat-avatar">
                    <div style="flex:1">
                        <div style="font-weight:600">${u.name}</div>
                        <div style="font-size:0.8rem; color:${u.online ? '#22c55e' : '#666'}">${u.online ? 'Online' : 'Offline'}</div>
                    </div>
                </div>
            `).join('');
        } catch (e) {}
    },
    open(target) {
        state.chatTarget = target;
        $('#chat-lobby').classList.add('hidden');
        $('#chat-room').classList.remove('hidden');
        $('#chat-room').style.display = 'flex';
        $('#chat-title').textContent = target === 'global' ? 'Global Chat' : target;
        this.poll();
        clearInterval(state.chatInterval);
        state.chatInterval = setInterval(() => this.poll(), 2000);
    },
    close() {
        state.chatTarget = null;
        clearInterval(state.chatInterval);
        this.loadLobby();
    },
    async poll() {
        if (!state.chatTarget) return;
        try {
            // Add &t=${Date.now()} to prevent caching
const data = await api(`/api/messages?target=${state.chatTarget}&t=${Date.now()}`);

            const area = $('#msg-area');
            const atBottom = area.scrollHeight - area.scrollTop <= area.clientHeight + 100;
            
            // Store optimistic messages before clearing
            const optimisticMessages = [];
            const currentRows = area.querySelectorAll('.msg-row');
            currentRows.forEach(row => {
                if (row.hasAttribute('data-optimistic')) {
                    optimisticMessages.push(row.outerHTML);
                }
            });
            
            // Clear and rebuild with server messages
            area.innerHTML = '';
            
            // Add server messages
            const serverHtml = (data.messages || []).map(m => {
                const mine = m.sender === state.user;
                let content = escapeHtml(m.content);
                if (m.type === 'image') {
                    content = `<img src="/api/chat/file/${m.content}" style="max-width:200px; border-radius:8px; cursor:pointer;" onclick="window.open(this.src)">`;
                } else if (m.type === 'file') {
                    content = `<a href="/api/chat/file/${m.content}" target="_blank" style="color:var(--accent); text-decoration:none;"><i class="fa-solid fa-file"></i> File</a>`;
                }
                return `
                    <div class="msg-row ${mine ? 'mine' : ''}">
                        <div class="msg-bubble">
                            ${!mine && state.chatTarget === 'global' ? `<div class="msg-sender" style="font-size:0.7rem; color:var(--accent); font-weight:bold; margin-bottom:2px;">${m.sender}</div>` : ''}
                            ${content}
                            <div style="font-size:0.65rem; color:rgba(255,255,255,0.5); text-align:right; margin-top:4px;">${formatTime(m.timestamp)}</div>
                        </div>
                    </div>
                `;
            }).join('');
            
            area.innerHTML = serverHtml;
            
            // Add back optimistic messages if they haven't been confirmed by server
            const lastServerMsg = data.messages?.[data.messages.length - 1];
            const hasMatchingOptimistic = optimisticMessages.some(html => {
                // Check if any optimistic message matches the last server message
                if (!lastServerMsg) return false;
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                const bubble = tempDiv.querySelector('.msg-bubble');
                const contentDiv = bubble.querySelector('div:first-child');
                let optimisticContent = '';
                
                if (contentDiv && contentDiv.classList.contains('msg-sender')) {
                    optimisticContent = bubble.childNodes[2]?.textContent || '';
                } else {
                    optimisticContent = bubble.childNodes[0]?.textContent || '';
                }
                
                return optimisticContent.trim() === lastServerMsg.content.trim();
            });
            
            // If we have optimistic messages and none match the last server message, add them back
            if (optimisticMessages.length > 0 && !hasMatchingOptimistic) {
                optimisticMessages.forEach(html => {
                    area.innerHTML += html;
                });
            }
            
            if (atBottom) area.scrollTop = area.scrollHeight;
        } catch (e) {
            // If poll fails, keep existing messages
        }
    },
    async send() {
        const inp = $('#msg-in');
        const txt = inp.value.trim();
        if (!txt) return;
        
        // Optimistic update: add message to UI immediately
        const area = $('#msg-area');
        const isGlobal = state.chatTarget === 'global';
        const optimisticHtml = `
            <div class="msg-row mine" data-optimistic="true">
                <div class="msg-bubble">
                    ${!isGlobal ? '' : `<div class="msg-sender" style="font-size:0.7rem; color:var(--accent); font-weight:bold; margin-bottom:2px;">${state.user}</div>`}
                    ${escapeHtml(txt)}
                    <div style="font-size:0.65rem; color:rgba(255,255,255,0.5); text-align:right; margin-top:4px;">${formatTime(Math.floor(Date.now() / 1000))}</div>
                </div>
            </div>
        `;
        
        area.innerHTML += optimisticHtml;
        area.scrollTop = area.scrollHeight;
        
        // Clear input after adding to UI
        inp.value = '';
        
        // Send to server
        try {
            await api('/api/send_message', {
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ target: state.chatTarget, content: txt })
            });
            // Server will confirm in next poll
        } catch (e) {
            // If send fails, we keep the optimistic message for now
            // It will be removed if not confirmed in next poll
        }
        
        // Wait a bit before polling to give server time to save
        setTimeout(() => {
            if (state.chatTarget) {
                this.poll();
            }
        }, 300);
    },
    async uploadAttachment(input) {
        const file = input.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append('file', file);
        try {
            showToast('Uploading...', 'info');
            const res = await fetch('/api/chat/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (data.status === 'success') {
                const type = file.type.startsWith('image/') ? 'image' : 'file';
                await api('/api/send_message', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: state.chatTarget, content: data.filename, type: type })
                });
                this.poll();
            } else {
                showToast('Upload failed: ' + (data.msg || 'Unknown error'), 'error');
            }
        } catch (e) { showToast('Upload failed', 'error'); }
        input.value = '';
    }
};

const Profile = {
    async open() {
        $('#profile-modal').classList.remove('hidden');
        const data = await api(`/api/user/${state.user}`);
        $('#prof-header-name').textContent = data.username;
        $('#prof-nick').value = data.nickname || '';
        $('#prof-bio').value = data.bio || '';
        $('#prof-img').src = `/api/avatar/${state.user}?t=${Date.now()}`;
    },
    close() { $('#profile-modal').classList.add('hidden'); },
    async save() {
        const nick = $('#prof-nick').value;
        const bio = $('#prof-bio').value;
        await api('/api/profile/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nickname: nick, bio })
        });
        showToast('Profile Saved', 'success');
        this.close();
    },
    async upload(input) {
        if (!input.files.length) return;
        const fd = new FormData();
        fd.append('avatar', input.files[0]);
        await fetch('/api/upload_avatar', { method: 'POST', body: fd });
        const ts = Date.now();
        $('#prof-img').src = `/api/avatar/${state.user}?t=${ts}`;
        $('#my-profile-pic').src = `/api/avatar/${state.user}?t=${ts}`;
    }
};

async function loadStats() {
    try {
        const s = await api('/api/stats');
        $('#cpu-stat').textContent = s.cpu + '%';
        $('#ram-stat').textContent = s.ram + '%';
        const st = await api('/api/storage');
        $('#storage-bar').style.width = st.percent + '%';
        $('#storage-text').textContent = `${st.used} / ${st.total} (${st.percent}%)`;
        if (state.isOwner) {
            const users = await api('/api/users');
            $('#user-count').textContent = users.length + ' Users';
            $('#admin-user-list').innerHTML = users.map(u => `
                <div class="user-list-item">
                    <div class="user-meta">
                        <img src="/api/avatar/${u.username}" class="user-avatar-sm">
                        <div>
                            <div>${u.username}</div>
                            <div style="font-size:0.75rem; color:var(--text-dim)">
                                ${u.is_owner ? 'Admin' : 'User'} • ${u.nickname || 'No nick'}
                            </div>
                        </div>
                    </div>
                    <div class="flex" style="gap:5px;">
                        ${u.username !== state.user ? `<button class="btn btn-sm" onclick="toggleSidebar(); navigate('chat'); Chat.open('${u.username}')"><i class="fa-solid fa-message"></i></button>` : ''}
                        <button class="btn btn-sm btn-danger" onclick="adminDelete('${u.username}')"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {}
}

async function adminDelete(user) {
    if (!confirm(`Delete user ${user}?`)) return;
    await api('/api/admin/delete_user', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user })
    });
    loadStats();
}

async function adminWipeDB() {
    if (confirm('DANGER: Wipe all users and messages? This cannot be undone.')) {
        await api('/api/reset_users', { method: 'POST' });
        location.reload();
    }
}

$('#media-modal')?.addEventListener('click', () => $('#media-modal').classList.add('hidden'));
$('[data-save-file]')?.addEventListener('click', FileManager.saveFile);
$('[data-close-editor]')?.addEventListener('click', () => $('#editor-modal').classList.add('hidden'));

import { albumDatabase } from "./data/albumData.js";
import { generateStickerPdf } from "./features/pdfExport.js";
import { captureAndScan, closeScanner, openScanner } from "./features/scanner.js";
import { executeManualTrade, openTradeView } from "./features/trade.js";
import { loginUser, logoutUser, persistAuthSession, registerUser, watchAuthState } from "./services/authService.js";
import { getAlbumStats, getAllStickers, getDuplicateStickerIds, getSummaryLists, getTeamStickers } from "./services/albumService.js";
import { auth, db } from "./services/firebaseService.js";
import { addFriendByEmail, getFriendSummaries, getFriendTradeMatches, registerUserForFriendLookup } from "./services/friendsService.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

    // 3. Database State
    window.state = {};
    window.currentTeamContext = null; 
    let stateRef = null;
    let currentUser = null;
    let unsubscribeAlbum = null;

    /* === AUTHENTICATION LOGIC === */
    // Asegurar que la sesión quede guardada permanentemente
    persistAuthSession().catch(err => console.error("Persistence Error:", err));

    watchAuthState((user) => {
        if (user) {
            currentUser = user;
            stateRef = ref(db, 'users/' + user.uid + '/album');
            
            // Show Scanner Button
            document.getElementById('fab-scan').style.display = 'flex';
            
            // Register email in index for friend lookup
            registerUserForFriendLookup(user).catch(() => {});
            
            // Try loading local state first for speed
            const local = localStorage.getItem(`album-2026-${user.uid}`);
            if (local) window.state = JSON.parse(local);
            else window.state = {};

            // Detach previous listener if exists
            if (unsubscribeAlbum) unsubscribeAlbum();

            // Listen for Cloud Data for this specific user
            unsubscribeAlbum = onValue(stateRef, (snapshot) => {
                if (snapshot.exists()) {
                    window.state = snapshot.val();
                    localStorage.setItem(`album-2026-${user.uid}`, JSON.stringify(window.state));
                    refreshLocalUI(); 
                }
            }, (error) => {
                // Solo mostrar alerta si el usuario sigue logueado (evita error al cerrar sesion)
                if (auth.currentUser && error.message.includes('permission_denied')) {
                    console.error("Firebase Permission Error:", error);
                }
            });

            window.goHome(); // Show app
        } else {
            // User is signed out
            if (unsubscribeAlbum) { unsubscribeAlbum(); unsubscribeAlbum = null; }
            currentUser = null;
            stateRef = null;
            window.state = {};
            document.getElementById('fab-scan').style.display = 'none';
            window.switchView('view-auth', false); // Show login screen
        }
    });

    window.handleLogin = () => {
        const emailInput = document.getElementById('auth-email');
        const passInput = document.getElementById('auth-password');
        const email = emailInput ? emailInput.value.trim() : "";
        const pass = passInput ? passInput.value : "";
        
        if(!email || !pass) return alert("❌ Por favor, llena tu correo y contraseña.");
        
        loginUser(email, pass)
            .catch(err => {
                console.error(err);
                if(err.code === 'auth/invalid-credential') alert("❌ Correo o contraseña incorrectos. Si no tienes cuenta, haz clic en Crear Cuenta.");
                else alert("⚠️ Error al entrar: " + err.message + "\n\nSi el error dice 'configuration-not-found', debes ir a tu consola de Firebase -> Authentication y habilitar el inicio de sesión por Correo/Contraseña.");
            });
    };

    window.handleRegister = () => {
        const emailInput = document.getElementById('auth-email');
        const passInput = document.getElementById('auth-password');
        const email = emailInput ? emailInput.value.trim() : "";
        const pass = passInput ? passInput.value : "";
        
        if(!email || !pass) return alert("❌ Por favor, llena tu correo y contraseña.");
        if(pass.length < 6) return alert("❌ La contraseña debe tener al menos 6 caracteres.");

        registerUser(email, pass)
            .catch(err => {
                console.error(err);
                if(err.code === 'auth/email-already-in-use') alert("❌ Este correo ya tiene una cuenta. Haz clic en 'Entrar al Álbum'.");
                else if(err.code === 'auth/admin-restricted-operation') alert("⚠️ Error de permisos. ¡Recuerda habilitar el proveedor de Email/Contraseña en la consola de Firebase Authentication!");
                else alert("⚠️ Error al crear cuenta: " + err.message + "\n\nSi el error es raro, asegúrate de haber habilitado el inicio de sesión por Correo/Contraseña en Firebase Authentication.");
            });
    };

    window.handleLogout = () => {
        if(confirm("¿Seguro que quieres cerrar sesión de tu álbum familiar?")) {
            logoutUser();
        }
    };


    /* === ALBUM LOGIC === */
    window.updateSticker = function(id, delta) {
        if (!currentUser || !stateRef) return;

        const newVal = (window.state[id] || 0) + delta;
        if (newVal < 0) return; 
        
        // Optimistic local update
        window.state[id] = newVal;
        localStorage.setItem(`album-2026-${currentUser.uid}`, JSON.stringify(window.state));
        refreshLocalUI();

        // Push to Cloud
        update(stateRef, { [id]: newVal }).catch(e => console.error("Firebase Update Error:", e));
    };

    window.DB = albumDatabase;

    window.refreshLocalUI = function() {
        if(window.updateStats) window.updateStats();
        
        if (document.getElementById('view-team').classList.contains('active') && window.currentTeamContext) {
            window.openTeam(window.currentTeamContext.code, window.currentTeamContext.name, window.currentTeamContext.isSpecial);
        } else if (document.getElementById('view-summary').classList.contains('active')) {
            window.openSummary();
        }
    };

    window.updateStats = function() {
        const stats = getAlbumStats(window.state);
        
        document.getElementById('stat-unq').innerHTML = `${stats.unique} <span class="total">/ ${stats.total}</span>`;
        document.getElementById('stat-dup').innerText = `${stats.duplicates}`;
        document.getElementById('stat-pct').innerText = `${stats.percentage}% Listo`;
        document.getElementById('progress-bar').style.width = `${stats.percentage}%`;
    };

    window.shareWsp = function() {
        let repetidas = [];
        for(let key in window.state) if(window.state[key] > 1) repetidas.push(`🚨 ${key} (x${window.state[key]-1})`);
        if(repetidas.length === 0) { alert("No tienes repetidas para intercambiar aún."); return; }
        repetidas.sort();
        let text = "🏆 *Mis Láminas Repetidas - Mundial 2026* 🏆\n\n" + repetidas.join('\n') + "\n\n♻️ ¿Cuáles te sirven? ¡Escríbeme! ⚽";
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    };

    window.getAllStickers = function() {
        return getAllStickers(window.DB);
    };

    window.openTrade = function() {
        const allStickers = window.getAllStickers();

        openTradeView({
            state: window.state,
            allStickers,
            duplicateStickerIds: getDuplicateStickerIds(allStickers, window.state),
            switchView: window.switchView
        });
    };

    window.executeTrade = function() {
        executeManualTrade({
            state: window.state,
            allStickers: window.getAllStickers(),
            updateSticker: window.updateSticker,
            reopenTrade: window.openTrade
        });
    };
    window.switchView = function(viewId, pushState = true) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        window.scrollTo(0,0);
        if (pushState && viewId !== 'view-auth') {
            history.pushState({ view: viewId }, '', '#' + viewId);
        }
    };

    // Handle iOS swipe back / browser back button
    window.addEventListener('popstate', (e) => {
        const currentActive = document.querySelector('.view.active');
        const id = currentActive ? currentActive.id : null;
        if (!id || id === 'view-auth' || id === 'view-home') {
            // nothing to go back to
        } else if (id === 'view-friend-trades') {
            window.openFriends();
        } else {
            window.goHome();
        }
    });

    window.goHome = function() { 
        if(!currentUser) return window.switchView('view-auth', false);
        window.switchView('view-home', false);
        history.replaceState({ view: 'view-home' }, '', '#home');
        window.updateStats(); 
    };

    window.toggleGroup = function(groupId) {
        document.querySelectorAll('.group-card').forEach(card => {
            if(card.id === groupId) card.classList.toggle('open'); 
            else card.classList.remove('open');
        });
    };

    window.filterTeams = function() {
        const query = document.getElementById('team-search').value.toLowerCase().trim();
        const cards = document.querySelectorAll('.group-card');
        
        cards.forEach(card => {
            const text = card.innerText.toLowerCase();
            if (text.includes(query)) {
                card.style.display = 'block';
                // Si la búsqueda es muy específica, abrir el grupo automáticamente
                if (query.length > 2 && text.includes(query)) {
                    // Solo si no estamos buscando algo muy genérico como "grupo"
                    if (!"grupo".includes(query)) card.classList.add('open');
                }
            } else {
                card.style.display = 'none';
                card.classList.remove('open');
            }
        });
        
        // Si no hay búsqueda, cerrar todo
        if (!query) {
            cards.forEach(c => {
                c.style.display = 'block';
                c.classList.remove('open');
            });
        }
    };

    window.openTeam = function(teamCode, teamName, isSpecial = false) {
        window.currentTeamContext = {code: teamCode, name: teamName, isSpecial};
        
        document.getElementById('team-title').innerText = teamName;
        let stickers = getTeamStickers(window.DB, teamCode, isSpecial);
        const grid = document.getElementById('sticker-grid');
        grid.innerHTML = '';
        stickers.forEach(id => grid.appendChild(window.createStickerEl(id)));
        window.switchView('view-team');
    };

    window.openSummary = function() {
        const { missing: m, got: g, duplicates: d } = getSummaryLists(window.getAllStickers(), window.state);

        document.getElementById('count-missing').innerText = m.length;
        document.getElementById('count-got').innerText = g.length;
        document.getElementById('count-dup').innerText = d.length;

        const populate = (elId, arr, cssClass) => {
            const el = document.getElementById(elId);
            if (arr.length === 0) el.innerHTML = `<div class="empty-state">No hay láminas en esta lista.</div>`;
            else el.innerHTML = arr.map(i => `<div class="code-tag ${cssClass}">${i}</div>`).join('');
        };

        populate('content-missing', m, ''); populate('content-got', g, 'got'); populate('content-dup', d, 'dup');
        window.switchView('view-summary');
    };

    window.switchTab = function(tabId) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.summary-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
        document.getElementById(`content-${tabId}`).classList.add('active');
    };

    window.createStickerEl = function(id) {
        const el = document.createElement('div');
        el.className = 'sticker';
        const count = window.state[id] || 0;
        
        if (count == 1) el.classList.add('status-1');
        else if (count > 1) el.classList.add('status-2');
        
        const codeSpan = document.createElement('div');
        codeSpan.className = 'sticker-code';
        const parts = id.split(' ');
        if(parts.length > 1) codeSpan.innerHTML = `${parts[0]}<br>${parts[1]}`;
        else codeSpan.innerText = id;
        el.appendChild(codeSpan);
        
        if (count > 1) {
            const badge = document.createElement('div');
            badge.className = 'badge-count';
            badge.innerText = `+${count - 1}`;
            el.appendChild(badge);
        }
        if (count > 0) {
            const minusBtn = document.createElement('div');
            minusBtn.className = 'btn-minus';
            minusBtn.innerHTML = '&minus;';
            minusBtn.onclick = (e) => {
                e.stopPropagation(); window.updateSticker(id, -1);
            };
            el.appendChild(minusBtn);
        }
        
        el.onclick = () => { window.updateSticker(id, 1); };
        return el;
    }

    // BOOTSTRAP INITIALIZATION
    window.onload = () => {
        // Init SW 
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e=>{});

        const list = document.getElementById('group-list');
        
        const espCard = document.createElement('div');
        espCard.className = 'group-card';
        espCard.id = 'group-especiales';
        espCard.innerHTML = `<div class="group-header" onclick="openTeam('FWC', 'Sección Especial', true)">
            <div class="group-meta">
                <div>🌟 Sección Especial</div>
                <div class="group-acronyms">Lámina 00, FWC 1 - FWC 19</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(-90deg);"><path d="M6 9l6 6 6-6"/></svg>
        </div>`;
        list.appendChild(espCard);

        window.DB.groups.forEach((g, idx) => {
            const card = document.createElement('div');
            card.className = 'group-card';
            const cardId = `group-${idx}`;
            card.id = cardId; 
            const acronyms = g.teams.map(t => t.code).join(', '); 
            
            card.innerHTML = `
                <div class="group-header" onclick="toggleGroup('${cardId}')">
                    <div class="group-meta">
                        <div>${g.name}</div>
                        <div class="group-acronyms">${acronyms}</div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                </div>
                <div class="group-content">
                    <div class="teams-grid">
                        ${g.teams.map(t => `<button class="team-btn" onclick="openTeam('${t.code}', '${t.name}')"><span class="team-code">${t.code}</span><span>${t.name}</span></button>`).join('')}
                    </div>
                </div>
            `;
            list.appendChild(card);
        });
        
        // Wait for onAuthStateChanged to show a view

        // Handle direct reload on a hash
        if (!location.hash || location.hash === '#home') {
            history.replaceState({ view: 'view-home' }, '', '#home');
        }
    };

    /* === FRIENDS LOGIC === */
    window.openFriends = function() {
        window.switchView('view-friends');
        window.renderFriends();
    };

    window.addFriend = async function() {
        const input = document.getElementById('friend-email-input');
        const status = document.getElementById('friends-status');
        const email = (input.value || '').trim().toLowerCase();
        if (!email) return;
        if (!currentUser) return;

        status.className = '';
        status.textContent = 'Buscando...';

        try {
            const result = await addFriendByEmail(currentUser, email);

            if (!result.ok && result.reason === 'not-found') {
                status.className = 'err';
                status.textContent = 'No se encontro un usuario con ese correo.';
                return;
            }

            if (!result.ok && result.reason === 'self') {
                status.className = 'err';
                status.textContent = 'No puedes agregarte a ti mismo.';
                return;
            }

            input.value = '';
            status.className = 'ok';
            status.textContent = 'Amigo agregado correctamente.';
            window.renderFriends();
            setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
        } catch(e) {
            status.className = 'err';
            status.textContent = 'Error al buscar. Verifica las reglas de Firebase.';
        }
    };

    window.renderFriends = async function() {
        if (!currentUser) return;
        const listEl = document.getElementById('friends-list');
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px 0;">Cargando...</div>';

        try {
            const allStickers = window.getAllStickers();
            const friendSummaries = await getFriendSummaries(currentUser, allStickers, window.state);

            if (friendSummaries.length === 0) {
                listEl.innerHTML = '<div class="friends-empty"><strong>Sin amigos aun</strong>Agrega el correo de un amigo arriba para ver sus laminas repetidas y encontrar canjes.</div>';
                return;
            }

            listEl.innerHTML = '';

            for (const friend of friendSummaries) {
                const card = document.createElement('div');
                card.className = 'friend-card';
                card.innerHTML = `
                    <div class="friend-info">
                        <div class="friend-email">${friend.email}</div>
                        <div class="friend-stats">${friend.duplicateCount} repetidas&nbsp;&nbsp;-&nbsp;&nbsp;${friend.totalOwned} en total</div>
                    </div>
                    ${friend.matchCount > 0 ? `<div class="friend-match-badge">${friend.matchCount} canjes</div>` : ''}
                    <svg class="friend-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                `;
                card.onclick = () => window.viewFriendTrades(friend.uid, friend.email, friend.state);
                listEl.appendChild(card);
            }
        } catch(e) {
            listEl.innerHTML = '<div class="friends-empty"><strong>Error</strong>No se pudieron cargar los amigos. Verifica las reglas de Firebase Database.</div>';
        }
    };
    window.viewFriendTrades = function(fUid, fEmail, fState) {
        document.getElementById('friend-trade-title').textContent = fEmail.split('@')[0].toUpperCase();
        window.switchView('view-friend-trades');

        const allStickers = window.getAllStickers();
        const { iCanGet, iCanGive } = getFriendTradeMatches(allStickers, window.state, fState);

        const content = document.getElementById('friend-trades-content');

        let html = '';

        if (iCanGet.length === 0 && iCanGive.length === 0) {
            html = '<div class="friends-empty"><strong>Sin canjes posibles</strong>Por ahora no hay laminas que coincidan para intercambiar. Vuelve a revisar mas tarde.</div>';
        } else {
            if (iCanGet.length > 0) {
                html += `<div class="match-give"><div class="match-section-title">Ellos te pueden dar (${iCanGet.length})</div><div class="match-tags">${iCanGet.map(id => `<div class="match-tag give">${id}</div>`).join('')}</div></div>`;
            }
            if (iCanGive.length > 0) {
                html += `<div class="match-take"><div class="match-section-title">Tu les puedes dar (${iCanGive.length})</div><div class="match-tags">${iCanGive.map(id => `<div class="match-tag take">${id}</div>`).join('')}</div></div>`;
            }
            // WhatsApp share button
            const msgLines = [];
            if (iCanGet.length) msgLines.push('*Necesito de ti:* ' + iCanGet.join(', '));
            if (iCanGive.length) msgLines.push('*Yo te puedo dar:* ' + iCanGive.join(', '));
            const msg = `Hola! Revisé nuestros álbumes del Mundial 2026:\n\n${msgLines.join('\n\n')}\n\nCoordina conmigo!`;
            html += `<button class="btn-secondary btn-flex" style="margin-top:28px;" onclick="window.open('https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}','_blank')">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-main)"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                Coordinar por WhatsApp
            </button>`;
        }
        content.innerHTML = html;
    };

    /* === SCANNER LOGIC === */
    window.openScanner = async function() {
        await openScanner({
            video: document.getElementById('scanner-video'),
            fab: document.getElementById('fab-scan'),
            switchView: window.switchView
        });
    };

    window.closeScanner = function() {
        closeScanner({
            fab: document.getElementById('fab-scan'),
            goHome: window.goHome
        });
    };

    window.captureAndScan = async function() {
        await captureAndScan({
            video: document.getElementById('scanner-video'),
            loader: document.getElementById('scanner-loader'),
            getAllStickers: window.getAllStickers,
            updateSticker: window.updateSticker
        });
    };
    /* === EXPORT LOGIC === */
    window.shareRepeated = function() {
        const allStickers = window.getAllStickers();
        const dups = getDuplicateStickerIds(allStickers, window.state);
        
        if (dups.length === 0) {
            alert("Aun no tienes laminas repetidas para compartir.");
            return;
        }

        const msg = `🏆 *Mundial 2026 - Mis Repetidas*:\n\n${dups.join(', ')}\n\n¿Cual necesitas?`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
    };

    window.generatePDF = function(type) {
        const { jsPDF } = window.jspdf;
        const allStickers = window.getAllStickers();
        const result = generateStickerPdf({ type, allStickers, state: window.state, jsPDF });

        if (!result.ok) alert(result.message);
    };

import { albumDatabase } from "./data/albumData.js";
import { addPackFromText } from "./features/pack.js";
import { generateStickerPdf } from "./features/pdfExport.js";
import { captureAndScan, closeScanner, openScanner } from "./features/scanner.js";
import { createCollectionShareCard } from "./features/shareCard.js";
import { executeManualTrade, openTradeView } from "./features/trade.js";
import { addActivity, getActivity } from "./services/activityService.js";
import { loginUser, logoutUser, persistAuthSession, registerUser, watchAuthState } from "./services/authService.js";
import { getAlbumStats, getAllStickers, getDuplicateStickerIds, getSummaryLists } from "./services/albumService.js";
import { auth, db } from "./services/firebaseService.js";
import { addFriendByEmail, addFriendToGroup, createFriendGroup, getFriendGroups, getFriendSummaries, getFriendTradeMatches, registerUserForFriendLookup } from "./services/friendsService.js";
import { addNotification, clearNotifications, formatNotificationTime, getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markMilestoneNotified, wasMilestoneNotified } from "./services/notificationService.js";
import { createStickerEl, filterTeams, openSummaryView, openTeamView, renderGroupList, switchSummaryTab, toggleGroup } from "./ui/albumView.js";
import { renderHomeDashboard, renderPowerDashboard } from "./ui/powerDashboard.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

    // 3. Database State
    window.state = {};
    window.currentTeamContext = null; 
    let stateRef = null;
    let currentUser = null;
    let unsubscribeAlbum = null;
    let lastFriendSummaries = [];
    let friendGroups = [];
    let activeFriendGroupId = 'all';
    window.smartProposalContext = null;

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
                // Solo mostrar alerta si el usuario sigue logueado (evita error al cerrar sesión)
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
    function pushNotification(data) {
        if (!currentUser) return;
        addNotification(currentUser.uid, data);
        window.renderNotificationBadge();
    }

    function maybeNotifyProgressMilestone(previousStats, nextStats) {
        if (!currentUser) return;

        const milestones = [25, 50, 75, 100];
        const previousPercentage = Number(previousStats.percentage);
        const nextPercentage = Number(nextStats.percentage);

        for (const milestone of milestones) {
            if (previousPercentage < milestone && nextPercentage >= milestone && !wasMilestoneNotified(currentUser.uid, milestone)) {
                pushNotification({
                    title: `Álbum al ${milestone}%`,
                    message: `Llegaste al ${milestone}% del álbum. Vas en ${nextStats.unique} láminas únicas.`,
                    type: 'milestone',
                    action: 'summary'
                });
                markMilestoneNotified(currentUser.uid, milestone);
            }
        }
    }

    window.updateSticker = function(id, delta) {
        if (!currentUser || !stateRef) return;

        const previousStats = getAlbumStats(window.state);
        const newVal = (window.state[id] || 0) + delta;
        if (newVal < 0) return; 
        
        // Optimistic local update
        window.state[id] = newVal;
        addActivity(currentUser.uid, `${delta > 0 ? 'Agregaste' : 'Quitaste'} ${id}`);
        if (delta > 0 && newVal > 1) {
            pushNotification({
                title: 'Nueva repetida',
                message: `${id} ahora está repetida y puede servir para canjes.`,
                type: 'duplicate',
                action: 'friends'
            });
        }
        maybeNotifyProgressMilestone(previousStats, getAlbumStats(window.state));
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
        window.renderNotificationBadge();
        renderHomeDashboard({
            container: document.getElementById('home-pro-dashboard'),
            albumDatabase: window.DB,
            state: window.state,
            activity: getActivity(currentUser?.uid)
        });
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

    window.openPackMode = function() {
        document.getElementById('pack-input').value = '';
        document.getElementById('pack-result').textContent = '';
        window.switchView('view-pack');
    };

    window.addPackStickers = function() {
        if (!currentUser) return;

        const input = document.getElementById('pack-input');
        const resultEl = document.getElementById('pack-result');
        const result = addPackFromText({
            text: input.value,
            allStickers: window.getAllStickers(),
            updateSticker: window.updateSticker
        });

        addActivity(currentUser.uid, `Agregaste paquete de ${result.accepted.length} láminas`);
        if (result.accepted.length > 0) {
            pushNotification({
                title: 'Sobre agregado',
                message: `Se agregaron ${result.accepted.length} láminas desde el sobre.`,
                type: 'pack',
                action: 'summary'
            });
        }
        resultEl.textContent = result.message;
        input.value = '';
    };

    window.openPowerDashboard = async function() {
        window.switchView('view-power');

        const container = document.getElementById('power-dashboard-content');
        container.innerHTML = '<div class="insight-card"><div class="insight-title">Cargando panel...</div></div>';

        try {
            if (currentUser) {
                lastFriendSummaries = await getFriendSummaries(currentUser, window.getAllStickers(), window.state);
            }
        } catch (e) {}

        renderPowerDashboard({
            container,
            albumDatabase: window.DB,
            state: window.state,
            activity: getActivity(currentUser?.uid),
            friendSummaries: lastFriendSummaries
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
        toggleGroup(groupId);
    };

    window.filterTeams = function() {
        filterTeams();
    };

    window.openTeam = function(teamCode, teamName, isSpecial = false) {
        window.currentTeamContext = {code: teamCode, name: teamName, isSpecial};

        openTeamView({
            albumDatabase: window.DB,
            teamCode,
            teamName,
            isSpecial,
            state: window.state,
            updateSticker: window.updateSticker,
            switchView: window.switchView
        });
    };

    window.openSummary = function() {
        openSummaryView({
            allStickers: window.getAllStickers(),
            state: window.state,
            switchView: window.switchView
        });
    };

    window.switchTab = function(tabId) {
        switchSummaryTab(tabId);
    };

    window.createStickerEl = function(id) {
        return createStickerEl(id, window.state, window.updateSticker);
    };

    window.renderNotificationBadge = function() {
        const badge = document.getElementById('notification-badge');
        if (!badge) return;
        if (!currentUser) {
            badge.hidden = true;
            return;
        }

        const count = getUnreadNotificationCount(currentUser.uid);
        badge.textContent = count > 9 ? '9+' : `${count}`;
        badge.hidden = count === 0;
    };

    function openNotificationAction(action) {
        if (action === 'friends') {
            window.openFriends();
            return;
        }

        if (action === 'summary') {
            window.openSummary();
            return;
        }

        window.goHome();
    }

    window.renderNotifications = function() {
        const list = document.getElementById('notification-list');
        if (!list || !currentUser) return;

        const notifications = getNotifications(currentUser.uid);

        if (notifications.length === 0) {
            list.className = '';
            list.innerHTML = '<div class="notification-empty"><strong>Sin notificaciones</strong><br>Cuando haya avances, grupos o canjes importantes aparecerán aquí.</div>';
            return;
        }

        list.className = 'notification-list';
        list.innerHTML = '';

        notifications.forEach(item => {
            const card = document.createElement('div');
            card.className = `notification-card ${item.read ? '' : 'unread'}`;
            card.innerHTML = `
                <div class="notification-top">
                    <div class="notification-title">${item.title}</div>
                    <div class="notification-time">${formatNotificationTime(item.at)}</div>
                </div>
                <div class="notification-message">${item.message}</div>
            `;

            if (item.action) {
                card.addEventListener('click', () => openNotificationAction(item.action));
                card.style.cursor = 'pointer';
            }

            list.appendChild(card);
        });
    };

    window.openNotifications = function() {
        if (!currentUser) return;
        markAllNotificationsRead(currentUser.uid);
        window.renderNotificationBadge();
        window.renderNotifications();
        window.switchView('view-notifications');
    };

    window.markNotificationsRead = function() {
        if (!currentUser) return;
        markAllNotificationsRead(currentUser.uid);
        window.renderNotificationBadge();
        window.renderNotifications();
    };

    window.clearAllNotifications = function() {
        if (!currentUser) return;
        clearNotifications(currentUser.uid);
        window.renderNotificationBadge();
        window.renderNotifications();
    };

    function bindStaticEvents() {
        if (document.body.dataset.eventsBound === 'true') return;
        document.body.dataset.eventsBound = 'true';

        const authForm = document.getElementById('auth-form');
        authForm?.addEventListener('submit', (event) => {
            event.preventDefault();
            window.handleLogin();
        });

        document.getElementById('team-search')?.addEventListener('input', window.filterTeams);
        document.getElementById('friend-email-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') window.addFriend();
        });
        document.getElementById('friend-group-name-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') window.createFriendGroupFromInput();
        });

        document.addEventListener('click', (event) => {
            const tabButton = event.target.closest('[data-tab]');
            if (tabButton) {
                window.switchTab(tabButton.dataset.tab);
                return;
            }

            const pdfButton = event.target.closest('[data-pdf]');
            if (pdfButton) {
                window.generatePDF(pdfButton.dataset.pdf);
                return;
            }

            const actionButton = event.target.closest('[data-action]');
            if (!actionButton) return;

            const actions = {
                'add-friend': window.addFriend,
                'add-pack': window.addPackStickers,
                'capture-scan': window.captureAndScan,
                'close-scanner': window.closeScanner,
                'create-friend-group': window.createFriendGroupFromInput,
                'execute-trade': window.executeTrade,
                'go-home': window.goHome,
                'go-register': () => { window.location.href = 'register.html'; },
                'logout': window.handleLogout,
                'open-friends': window.openFriends,
                'open-pack': window.openPackMode,
                'open-power': window.openPowerDashboard,
                'open-scanner': window.openScanner,
                'open-share': () => window.switchView('view-share'),
                'open-summary': window.openSummary,
                'open-notifications': window.openNotifications,
                'open-team': (button) => window.openTeam(button.dataset.teamCode, button.dataset.teamName, button.dataset.teamSpecial === 'true'),
                'open-trade': window.openTrade,
                'open-whatsapp': (button) => window.open(button.dataset.url, '_blank'),
                'mark-notifications-read': window.markNotificationsRead,
                'share-card': window.shareCollectionCard,
                'share-repeated': window.shareRepeated,
                'smart-proposal': window.sendSmartProposal,
                'switch-friend-group': (button) => {
                    activeFriendGroupId = button.dataset.groupId || 'all';
                    window.renderFriends();
                },
                'toggle-help': (button) => {
                    const help = document.getElementById(button.dataset.helpTarget);
                    if (help) help.hidden = !help.hidden;
                },
                'clear-notifications': window.clearAllNotifications,
                'toggle-group': (button) => window.toggleGroup(button.dataset.groupId)
            };

            actions[actionButton.dataset.action]?.(actionButton);
        });
    }

    // BOOTSTRAP INITIALIZATION
    window.onload = () => {
        bindStaticEvents();

        // Init SW 
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e=>{});

        renderGroupList(window.DB);
        
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

    function renderFriendGroupControls() {
        const tabsEl = document.getElementById('friend-group-tabs');
        const selectEl = document.getElementById('friend-group-select');
        if (!tabsEl || !selectEl) return;

        const groups = [{ id: 'all', name: 'Todos' }, ...friendGroups];

        tabsEl.innerHTML = groups.map(group => `
            <button class="friend-group-tab ${group.id === activeFriendGroupId ? 'active' : ''}" data-action="switch-friend-group" data-group-id="${group.id}">
                ${group.name}
            </button>
        `).join('');

        selectEl.innerHTML = groups.map(group => `
            <option value="${group.id}" ${group.id === activeFriendGroupId ? 'selected' : ''}>${group.name}</option>
        `).join('');
    }

    function getActiveFriendSummaries(friendSummaries) {
        if (activeFriendGroupId === 'all') return friendSummaries;

        const group = friendGroups.find(item => item.id === activeFriendGroupId);
        if (!group) return friendSummaries;

        const memberIds = new Set(Object.keys(group.members || {}));
        return friendSummaries.filter(friend => memberIds.has(friend.uid));
    }

    window.createFriendGroupFromInput = async function() {
        const input = document.getElementById('friend-group-name-input');
        const status = document.getElementById('friends-status');
        const name = (input?.value || '').trim();

        if (!name || !currentUser) return;

        status.className = '';
        status.textContent = 'Creando grupo...';

        try {
            const group = await createFriendGroup(currentUser, name);
            friendGroups.push(group);
            activeFriendGroupId = group.id;
            input.value = '';
            pushNotification({
                title: 'Grupo creado',
                message: `Ya puedes agregar amigos al grupo ${group.name} y comparar el ranking.`,
                type: 'group',
                action: 'friends'
            });
            status.className = 'ok';
            status.textContent = `Grupo ${group.name} creado.`;
            window.renderFriends();
            setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
        } catch (e) {
            status.className = 'err';
            status.textContent = 'No se pudo crear el grupo. Revisa Firebase.';
        }
    };

    window.addFriend = async function() {
        const input = document.getElementById('friend-email-input');
        const status = document.getElementById('friends-status');
        const groupSelect = document.getElementById('friend-group-select');
        const email = (input.value || '').trim().toLowerCase();
        const selectedGroupId = groupSelect?.value || activeFriendGroupId;
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
            await addFriendToGroup(currentUser, selectedGroupId, result.friendUid, result.email);
            activeFriendGroupId = selectedGroupId;
            pushNotification({
                title: 'Amigo agregado',
                message: selectedGroupId === 'all'
                    ? `${result.email} ya aparece en tus amigos.`
                    : `${result.email} fue agregado al grupo seleccionado.`,
                type: 'friend',
                action: 'friends'
            });
            status.className = 'ok';
            status.textContent = selectedGroupId === 'all' ? 'Amigo agregado correctamente.' : 'Amigo agregado al grupo.';
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
            friendGroups = await getFriendGroups(currentUser);
            if (activeFriendGroupId !== 'all' && !friendGroups.some(group => group.id === activeFriendGroupId)) {
                activeFriendGroupId = 'all';
            }
            renderFriendGroupControls();

            const friendSummaries = await getFriendSummaries(currentUser, allStickers, window.state);
            lastFriendSummaries = friendSummaries;
            const visibleFriendSummaries = getActiveFriendSummaries(friendSummaries);
            const activeGroupName = activeFriendGroupId === 'all'
                ? 'Todos'
                : friendGroups.find(group => group.id === activeFriendGroupId)?.name || 'Grupo';

            if (friendSummaries.length === 0) {
                listEl.innerHTML = '<div class="friends-empty"><strong>Sin amigos aún</strong>Crea un grupo y agrega correos para ver progreso, repetidas y canjes.</div>';
                return;
            }

            if (visibleFriendSummaries.length === 0) {
                listEl.innerHTML = `<div class="friends-empty"><strong>${activeGroupName}</strong>Este grupo todavía no tiene amigos. Elige el grupo arriba y agrega un correo.</div>`;
                return;
            }

            const myStats = getAlbumStats(window.state);
            const ranking = [
                { email: 'Tu álbum', totalOwned: myStats.unique },
                ...visibleFriendSummaries
            ].sort((a, b) => b.totalOwned - a.totalOwned);

            listEl.innerHTML = `
                <div class="insight-card">
                    <div class="insight-kicker">Ranking: ${activeGroupName}</div>
                    <div class="ranking-list">
                        ${ranking.map((item, index) => `<div class="ranking-row"><span class="ranking-name">${index + 1}. ${item.email}</span><span class="ranking-score">${item.totalOwned}</span></div>`).join('')}
                    </div>
                </div>
            `;

            for (const friend of visibleFriendSummaries) {
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
                card.addEventListener('click', () => window.viewFriendTrades(friend.uid, friend.email, friend.state));
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
            html = '<div class="friends-empty"><strong>Sin canjes posibles</strong>Por ahora no hay láminas que coincidan para intercambiar. Vuelve a revisar más tarde.</div>';
        } else {
            const proposalSize = Math.min(iCanGet.length, iCanGive.length, 5);
            window.smartProposalContext = {
                friendEmail: fEmail,
                iCanGet: iCanGet.slice(0, proposalSize),
                iCanGive: iCanGive.slice(0, proposalSize)
            };

            if (iCanGet.length > 0) {
                html += `<div class="match-give"><div class="match-section-title">Ellos te pueden dar (${iCanGet.length})</div><div class="match-tags">${iCanGet.map(id => `<div class="match-tag give">${id}</div>`).join('')}</div></div>`;
            }
            if (iCanGive.length > 0) {
                html += `<div class="match-take"><div class="match-section-title">Tu les puedes dar (${iCanGive.length})</div><div class="match-tags">${iCanGive.map(id => `<div class="match-tag take">${id}</div>`).join('')}</div></div>`;
            }
            if (proposalSize > 0) {
                html += `<div class="smart-proposal"><button class="btn-trade" data-action="smart-proposal">Enviar propuesta inteligente (${proposalSize} x ${proposalSize})</button></div>`;
            }
            // WhatsApp share button
            const msgLines = [];
            if (iCanGet.length) msgLines.push('*Necesito de ti:* ' + iCanGet.join(', '));
            if (iCanGive.length) msgLines.push('*Yo te puedo dar:* ' + iCanGive.join(', '));
            const msg = `Hola! Revisé nuestros álbumes del Mundial 2026:\n\n${msgLines.join('\n\n')}\n\nCoordina conmigo!`;
            html += `<button class="btn-secondary btn-flex" style="margin-top:28px;" data-action="open-whatsapp" data-url="https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="var(--text-main)"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
                Coordinar por WhatsApp
            </button>`;
        }
        content.innerHTML = html;
    };

    window.sendSmartProposal = function() {
        const proposal = window.smartProposalContext;
        if (!proposal || proposal.iCanGet.length === 0 || proposal.iCanGive.length === 0) {
            alert('No hay una propuesta equilibrada disponible todavía.');
            return;
        }

        const msg = `Hola! Te propongo este canje del álbum Mundial 2026:\n\nYo te doy: ${proposal.iCanGive.join(', ')}\n\nTú me das: ${proposal.iCanGet.join(', ')}\n\n¿Te sirve?`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
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
            alert("Aún no tienes láminas repetidas para compartir.");
            return;
        }

        const msg = `🏆 *Mundial 2026 - Mis Repetidas*:\n\n${dups.join(', ')}\n\n¿Cuál necesitas?`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
    };

    window.generatePDF = function(type) {
        const { jsPDF } = window.jspdf;
        const allStickers = window.getAllStickers();
        const result = generateStickerPdf({ type, allStickers, state: window.state, jsPDF });

        if (!result.ok) alert(result.message);
    };

    window.shareCollectionCard = function() {
        const allStickers = window.getAllStickers();
        const stats = getAlbumStats(window.state);
        const { missing } = getSummaryLists(allStickers, window.state);
        const duplicates = getDuplicateStickerIds(allStickers, window.state);
        const dataUrl = createCollectionShareCard({ stats, duplicates, missing });
        const win = window.open('', '_blank');

        if (!win) {
            alert('No se pudo abrir la imagen. Revisa el bloqueo de ventanas emergentes.');
            return;
        }

        win.document.write(`<title>Mi álbum Mundial 2026</title><body style="margin:0;background:#0A0A0A;display:grid;place-items:center;min-height:100vh;"><img src="${dataUrl}" style="width:min(100%,480px);height:auto;display:block;"></body>`);
    };

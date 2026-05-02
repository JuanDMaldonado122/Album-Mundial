import { albumDatabase } from "./data/albumData.js";
import { addPackFromText } from "./features/pack.js";
import { generateStickerPdf } from "./features/pdfExport.js";
import { captureAndScan, closeScanner, openScanner } from "./features/scanner.js";
import { createCollectionShareCard } from "./features/shareCard.js";
import { executeManualTrade, openTradeView } from "./features/trade.js";
import { addActivity } from "./services/activityService.js";
import { loginUser, logoutUser, persistAuthSession, registerUser, watchAuthState } from "./services/authService.js";
import { createTradeRequest, getUserTradeRequests, respondTradeRequest, sendChatMessage, watchChatMessages } from "./services/chatService.js";
import { getAlbumStats, getAllStickers, getDuplicateStickerIds, getSummaryLists, getTeamStickers } from "./services/albumService.js";
import { auth, db } from "./services/firebaseService.js";
import { addFriendByEmail, addFriendToGroup, createFriendGroup, getFriendGroups, getFriendSummaries, getFriendTradeMatches, getUserProfile, registerUserForFriendLookup, saveUserProfile } from "./services/friendsService.js";
import { calculateDistanceKm, disableNearbyAvailability, getNearbyCollectors, saveNearbyAvailability } from "./services/nearbyService.js";
import { addNotification, clearNotifications, formatNotificationTime, getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markMilestoneNotified, wasMilestoneNotified } from "./services/notificationService.js";
import { initMatchAudioControls, playUiSound, toggleMatchAudio } from "./services/audioService.js";
import { getAchievementDashboard, getTeamForSticker, isTeamComplete } from "./services/achievementService.js";
import { createStickerEl, filterTeams, openSummaryView, openTeamView, renderGroupList, switchSummaryTab, toggleGroup } from "./ui/albumView.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

    // 3. Database State
    window.state = {};
    window.currentTeamContext = null; 
    let stateRef = null;
    let currentUser = null;
    let currentProfile = {};
    let unsubscribeAlbum = null;
    let friendGroups = [];
    let activeFriendGroupId = 'all';
    let tradeRequestsById = {};
    let currentChat = null;
    let unsubscribeChat = null;
    let nearbyMap = null;
    let nearbyMarkers = [];
    let nearbyCandidates = [];
    let nearbyCandidatesByUid = {};
    let teamTradeCandidatesByUid = {};
    let myNearbyLocation = null;
    let suppressStickerAudio = false;
    let celebrationTimer = null;
    window.smartProposalContext = null;

    /* === AUTHENTICATION LOGIC === */
    // Asegurar que la sesión quede guardada permanentemente
    persistAuthSession().catch(err => console.error("Persistence Error:", err));

    watchAuthState(async (user) => {
        if (user) {
            currentUser = user;
            stateRef = ref(db, 'users/' + user.uid + '/album');
            
            // Show Scanner Button
            document.getElementById('fab-scan').style.display = 'flex';
            
            // Register email in index for friend lookup
            registerUserForFriendLookup(user).catch(() => {});
            try {
                currentProfile = await getUserProfile(user.uid);
            } catch (e) {
                currentProfile = {};
            }
            
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

            if (!currentProfile.displayName) {
                window.switchView('view-profile-setup', false);
            } else {
                window.goHome(); // Show app
            }
        } else {
            // User is signed out
            if (unsubscribeAlbum) { unsubscribeAlbum(); unsubscribeAlbum = null; }
            currentUser = null;
            currentProfile = {};
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

    window.saveDisplayName = async function() {
        const input = document.getElementById('display-name-input');
        const status = document.getElementById('profile-setup-status');
        const displayName = (input?.value || '').trim();

        if (!displayName || !currentUser) {
            status.textContent = 'Escribe un nombre o apodo para continuar.';
            return;
        }

        if (displayName.length < 2) {
            status.textContent = 'El nombre debe tener al menos 2 caracteres.';
            return;
        }

        status.textContent = 'Guardando...';

        try {
            const profile = { ...currentProfile, displayName };
            await saveUserProfile(currentUser, profile);
            currentProfile = { ...profile, email: currentUser.email };
            pushNotification({
                title: `Bienvenido, ${displayName}`,
                message: 'Tu perfil quedó listo para rankings, canjes y solicitudes.',
                type: 'profile',
                action: 'summary'
            });
            window.goHome();
        } catch (e) {
            status.textContent = 'No se pudo guardar el nombre. Revisa Firebase.';
        }
    };

    function getProfileFormData() {
        return {
            displayName: document.getElementById('profile-display-name')?.value.trim() || '',
            city: document.getElementById('profile-city')?.value.trim() || '',
            zone: document.getElementById('profile-zone')?.value.trim() || '',
            favoriteTeam: document.getElementById('profile-favorite-team')?.value.trim() || '',
            tradeStyle: document.getElementById('profile-trade-style')?.value || 'flexible',
            bio: document.getElementById('profile-bio')?.value.trim() || ''
        };
    }

    function getTradeStyleLabel(value = 'flexible') {
        return {
            flexible: 'Flexible',
            quick: 'Rápido y directo',
            collector: 'Coleccionista cuidadoso',
            family: 'Plan familiar'
        }[value] || 'Flexible';
    }

    function fillProfileForm() {
        const profile = currentProfile || {};
        const displayName = profile.displayName || '';
        const city = profile.city || '';
        const zone = profile.zone || '';
        const favoriteTeam = profile.favoriteTeam || '';
        const tradeStyle = profile.tradeStyle || 'flexible';
        const bio = profile.bio || '';

        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        };

        setValue('profile-display-name', displayName);
        setValue('profile-city', city);
        setValue('profile-zone', zone);
        setValue('profile-favorite-team', favoriteTeam);
        setValue('profile-trade-style', tradeStyle);
        setValue('profile-bio', bio);

        const previewName = document.getElementById('profile-preview-name');
        const previewMeta = document.getElementById('profile-preview-meta');
        const avatar = document.getElementById('profile-avatar');
        if (previewName) previewName.textContent = displayName || 'Coleccionista';
        if (avatar) avatar.textContent = (displayName || currentUser?.email || 'A').slice(0, 1).toUpperCase();
        if (previewMeta) {
            const parts = [city, zone, favoriteTeam ? `Hincha de ${favoriteTeam}` : '', getTradeStyleLabel(tradeStyle)].filter(Boolean);
            previewMeta.textContent = parts.join(' - ') || 'Listo para canjear';
        }
    }

    window.openProfile = function() {
        fillProfileForm();
        document.getElementById('profile-edit-status').textContent = '';
        window.switchView('view-profile');
    };

    window.saveProfile = async function() {
        if (!currentUser) return;

        const status = document.getElementById('profile-edit-status');
        const profile = getProfileFormData();

        if (profile.displayName.length < 2) {
            status.textContent = 'El apodo debe tener al menos 2 caracteres.';
            return;
        }

        if (profile.bio.length > 120) {
            status.textContent = 'La frase debe tener máximo 120 caracteres.';
            return;
        }

        status.textContent = 'Guardando perfil...';

        try {
            await saveUserProfile(currentUser, profile);
            currentProfile = { ...profile, email: currentUser.email };
            status.textContent = 'Perfil actualizado. Ahora tus canjes cercanos tienen más personalidad.';
            playUiSound('tap');
            fillProfileForm();
            if (myNearbyLocation) {
                await saveNearbyAvailability(currentUser, {
                    latitude: myNearbyLocation.lat,
                    longitude: myNearbyLocation.lng
                }, currentProfile);
            }
        } catch (e) {
            status.textContent = 'No se pudo guardar el perfil. Revisa Firebase.';
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

    function showCelebration(title, message) {
        const overlay = document.getElementById('celebration-overlay');
        if (!overlay) return;

        document.getElementById('celebration-title').textContent = title;
        document.getElementById('celebration-message').textContent = message;
        overlay.hidden = false;
        overlay.classList.add('show');
        playUiSound('packGoal');

        window.clearTimeout(celebrationTimer);
        celebrationTimer = window.setTimeout(window.closeCelebration, 5200);
    }

    window.closeCelebration = function() {
        const overlay = document.getElementById('celebration-overlay');
        if (!overlay) return;
        overlay.classList.remove('show');
        overlay.hidden = true;
        window.clearTimeout(celebrationTimer);
    };

    function maybeCelebrateTeamCompletion(stickerId, previousState) {
        if (!currentUser || !stickerId) return false;

        const team = getTeamForSticker(window.DB, stickerId);
        if (!team) return false;

        const wasComplete = isTeamComplete(window.DB, previousState, team);
        const isComplete = isTeamComplete(window.DB, window.state, team);
        if (!wasComplete && isComplete) {
            const title = `${team.name} completo`;
            const message = `Brutal. Ya tienes todas las laminas de ${team.name}.`;
            showCelebration(title, message);
            pushNotification({
                title,
                message,
                type: 'achievement',
                action: 'summary'
            });
            return true;
        }

        return false;
    }

    function renderAchievements() {
        const list = document.getElementById('achievement-list');
        const score = document.getElementById('achievement-score');
        if (!list || !score) return;

        const dashboard = getAchievementDashboard(window.DB, window.state);
        score.textContent = `${dashboard.completedCount}/${dashboard.totalCount}`;

        const cards = [
            ...dashboard.activeMissions.map(item => ({
                title: item.title,
                detail: item.detail,
                meta: `${item.progress}/${item.target}`,
                percentage: item.percentage,
                completed: false
            })),
            ...dashboard.nextTeams.map(team => ({
                title: `Casi completas ${team.name}`,
                detail: `${team.owned} de ${team.total} laminas listas.`,
                meta: `${team.percentage}%`,
                percentage: team.percentage,
                completed: false
            }))
        ].slice(0, 4);

        if (cards.length === 0) {
            list.innerHTML = '<div class="achievement-empty">Agrega laminas para desbloquear misiones y celebraciones.</div>';
            return;
        }

        list.innerHTML = cards.map(card => `
            <div class="achievement-card ${card.completed ? 'complete' : ''}">
                <div class="achievement-card-top">
                    <div>
                        <div class="achievement-title">${escapeHtml(card.title)}</div>
                        <div class="achievement-detail">${escapeHtml(card.detail)}</div>
                    </div>
                    <div class="achievement-meta">${escapeHtml(card.meta)}</div>
                </div>
                <div class="achievement-progress"><span style="width:${Math.min(card.percentage, 100)}%"></span></div>
            </div>
        `).join('');
    }

    window.updateSticker = function(id, delta) {
        if (!currentUser || !stateRef) return;

        const previousStats = getAlbumStats(window.state);
        const previousState = { ...window.state };
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
        const playedCelebration = delta > 0 && maybeCelebrateTeamCompletion(id, previousState);
        if (!suppressStickerAudio) {
            if (delta > 0) {
                if (!playedCelebration) playUiSound(newVal > 1 ? 'duplicate' : 'goal');
            } else {
                playUiSound('tap');
            }
        }
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
        renderAchievements();
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
        let result;
        suppressStickerAudio = true;
        try {
            result = addPackFromText({
                text: input.value,
                allStickers: window.getAllStickers(),
                updateSticker: window.updateSticker
            });
        } finally {
            suppressStickerAudio = false;
        }

        addActivity(currentUser.uid, `Agregaste paquete de ${result.accepted.length} láminas`);
        if (result.accepted.length > 0) {
            playUiSound(result.accepted.length > 1 ? 'packGoal' : 'goal');
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
        const greeting = document.getElementById('home-greeting');
        if (greeting) {
            greeting.innerHTML = currentProfile.displayName
                ? `Bienvenido, ${escapeHtml(currentProfile.displayName)} <span style="color:var(--fifa-lime); opacity:0.8;">v5.11</span>`
                : 'Álbum Sincronizado <span style="color:var(--fifa-lime); opacity:0.8;">v5.11</span>';
        }
        const profileButtonLabel = document.querySelector('.profile-button span');
        if (profileButtonLabel) {
            profileButtonLabel.textContent = currentProfile.displayName || 'Perfil';
        }
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

    function buildTeamTradeProposal(candidate) {
        const proposalSize = Math.min(candidate.iCanGet.length, candidate.iCanGive.length, 5);
        if (proposalSize <= 0) return null;

        return {
            friendUid: candidate.uid,
            friendEmail: candidate.email,
            friendDisplayName: candidate.displayName || candidate.email,
            teamName: candidate.teamName,
            iCanGet: candidate.iCanGet.slice(0, proposalSize),
            iCanGive: candidate.iCanGive.slice(0, proposalSize)
        };
    }

    function getTeamTradeWhatsappMessage(candidate) {
        const proposal = buildTeamTradeProposal(candidate);

        if (proposal) {
            return `Hola! Estoy completando ${candidate.teamName} en el álbum Mundial 2026.\n\nMe puedes ayudar con: ${proposal.iCanGet.join(', ')}\n\nYo te puedo dar: ${proposal.iCanGive.join(', ')}\n\n¿Hacemos ese canje?`;
        }

        return `Hola! Vi que podrías ayudarme con ${candidate.iCanGet.join(', ')} para completar ${candidate.teamName} en el álbum Mundial 2026.\n\n¿Te interesa revisar un canje conmigo?`;
    }

    function renderTeamTradeCandidates(teamName, missingTeam, candidates) {
        const content = document.getElementById('friend-trades-content');
        const missingPreview = missingTeam.slice(0, 10).join(', ');

        if (missingTeam.length === 0) {
            content.innerHTML = '<div class="friends-empty"><strong>Equipo completo</strong>Ya tienes todas las laminas de este equipo. Es momento de celebrar o ayudar a alguien mas.</div>';
            return;
        }

        if (candidates.length === 0) {
            content.innerHTML = `
                <div class="friend-msg-box">Te faltan ${missingTeam.length} laminas de ${escapeHtml(teamName)}: ${escapeHtml(missingPreview)}${missingTeam.length > 10 ? '...' : ''}</div>
                <div class="friends-empty"><strong>Sin matches por ahora</strong>Ningun amigo tiene repetidas de este equipo que te sirvan todavia. Cuando agreguen mas laminas, vuelve a buscar.</div>
            `;
            return;
        }

        content.innerHTML = `
            <div class="friend-msg-box">Enfocado en ${escapeHtml(teamName)}: te faltan ${missingTeam.length} laminas. Ordenamos primero a quienes mas te pueden acercar a completarlo.</div>
            ${candidates.map(candidate => {
                const proposalSize = Math.min(candidate.iCanGet.length, candidate.iCanGive.length, 5);
                const canRequest = proposalSize > 0;
                const actionCopy = canRequest
                    ? `${proposalSize} x ${proposalSize} listo para solicitar.`
                    : 'Te puede ayudar, pero aun no tienes repetidas compatibles para ofrecerle.';

                return `
                    <div class="request-card team-trade-card">
                        <div class="team-trade-top">
                            <div>
                                <div class="request-title">${escapeHtml(candidate.displayName || candidate.email)}</div>
                                <div class="request-copy">${escapeHtml(actionCopy)}</div>
                            </div>
                            <div class="friend-match-badge">${candidate.iCanGet.length}</div>
                        </div>
                        <div class="match-give">
                            <div class="match-section-title">Te puede dar</div>
                            <div class="match-tags">${candidate.iCanGet.slice(0, 8).map(id => `<span class="match-tag give">${escapeHtml(id)}</span>`).join('')}</div>
                        </div>
                        ${candidate.iCanGive.length ? `
                            <div class="match-take">
                                <div class="match-section-title">Tu le puedes dar</div>
                                <div class="match-tags">${candidate.iCanGive.slice(0, 8).map(id => `<span class="match-tag take">${escapeHtml(id)}</span>`).join('')}</div>
                            </div>
                        ` : ''}
                        <div class="request-actions">
                            ${canRequest ? `<button class="btn-trade" data-action="send-team-trade-request" data-uid="${candidate.uid}">Solicitud interna</button>` : '<button class="btn-secondary" disabled>Sin propuesta justa</button>'}
                            <button class="btn-secondary" data-action="team-trade-whatsapp" data-uid="${candidate.uid}">WhatsApp</button>
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    }

    window.openTeamTrades = async function() {
        if (!currentUser || !window.currentTeamContext) return;

        const { code, name, isSpecial } = window.currentTeamContext;
        const allStickers = window.getAllStickers();
        const teamStickers = getTeamStickers(window.DB, code, isSpecial);
        const missingTeam = teamStickers.filter(id => (window.state[id] || 0) === 0);
        const myDuplicates = allStickers.filter(id => (window.state[id] || 0) > 1);
        const title = document.getElementById('friend-trade-title');
        const content = document.getElementById('friend-trades-content');
        const backButton = document.querySelector('#view-friend-trades .btn-back');

        if (title) title.textContent = `CANJES ${name}`.toUpperCase();
        if (backButton) {
            backButton.dataset.action = 'open-team';
            backButton.dataset.teamCode = code;
            backButton.dataset.teamName = name;
            backButton.dataset.teamSpecial = isSpecial ? 'true' : 'false';
        }
        window.switchView('view-friend-trades');
        content.innerHTML = '<div class="friends-empty"><strong>Buscando matches</strong>Estamos revisando tus amigos para encontrar canjes utiles para este equipo.</div>';

        try {
            const friends = await getFriendSummaries(currentUser, allStickers, window.state);
            const candidates = friends.map(friend => {
                const iCanGet = missingTeam.filter(id => (friend.state?.[id] || 0) > 1);
                const iCanGive = myDuplicates.filter(id => (friend.state?.[id] || 0) === 0);

                return {
                    ...friend,
                    teamName: name,
                    iCanGet,
                    iCanGive,
                    proposalSize: Math.min(iCanGet.length, iCanGive.length, 5)
                };
            }).filter(candidate => candidate.iCanGet.length > 0)
              .sort((a, b) => b.proposalSize - a.proposalSize || b.iCanGet.length - a.iCanGet.length);

            teamTradeCandidatesByUid = Object.fromEntries(candidates.map(candidate => [candidate.uid, candidate]));
            renderTeamTradeCandidates(name, missingTeam, candidates);
        } catch (e) {
            content.innerHTML = '<div class="friends-empty"><strong>Error</strong>No se pudieron cargar los matches. Revisa las reglas de Firebase Database.</div>';
        }
    };

    window.sendTeamTradeRequest = async function(uid) {
        const candidate = teamTradeCandidatesByUid[uid];
        const proposal = candidate ? buildTeamTradeProposal(candidate) : null;

        if (!proposal) {
            alert('Todavia no hay una propuesta equilibrada para enviar solicitud interna.');
            return;
        }

        window.smartProposalContext = proposal;
        await window.sendInternalTradeRequest();
    };

    window.sendTeamTradeWhatsapp = function(uid) {
        const candidate = teamTradeCandidatesByUid[uid];
        if (!candidate) return;

        const msg = getTeamTradeWhatsappMessage(candidate);
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`, '_blank');
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

    function getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Tu navegador no soporta ubicación.'));
                return;
            }

            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 1000 * 60 * 5
            });
        });
    }

    function getLocationErrorMessage(error) {
        if (!window.isSecureContext) {
            return 'La ubicación real en celular necesita HTTPS. Este enlace local usa HTTP; usa Probar mapa o despliega la app en Firebase Hosting para probar permisos reales.';
        }

        if (error?.code === 1) {
            return 'El permiso de ubicación está bloqueado. En el navegador, abre permisos del sitio y permite Ubicación; luego toca Activar ubicación otra vez.';
        }

        if (error?.code === 2) {
            return 'No pudimos detectar tu ubicación en este momento. Revisa conexión/GPS o usa Probar mapa para validar el flujo.';
        }

        if (error?.code === 3) {
            return 'La ubicación tardó demasiado. Intenta de nuevo o usa Probar mapa para validar el flujo.';
        }

        return 'No se pudo obtener la ubicación. Revisa los permisos del navegador o usa Probar mapa para validar el flujo.';
    }

    function getNearbyFilters() {
        return {
            maxDistance: Number(document.getElementById('nearby-distance-filter')?.value || 999),
            minMatches: Number(document.getElementById('nearby-min-matches-filter')?.value || 0)
        };
    }

    function getNearbyLocationLabel(candidate = {}) {
        return [candidate.city, candidate.zone].filter(Boolean).join(' - ');
    }

    function getNearbyProfilePills(candidate = {}) {
        return [
            getNearbyLocationLabel(candidate),
            candidate.favoriteTeam ? `Hincha de ${candidate.favoriteTeam}` : '',
            getTradeStyleLabel(candidate.tradeStyle)
        ].filter(Boolean);
    }

    function getFilteredNearbyCandidates() {
        const filters = getNearbyFilters();
        return nearbyCandidates.filter(candidate =>
            candidate.distanceKm <= filters.maxDistance &&
            candidate.matchCount >= filters.minMatches
        );
    }

    function renderFilteredNearbyCandidates() {
        const filtered = getFilteredNearbyCandidates();
        nearbyCandidatesByUid = Object.fromEntries(filtered.map(candidate => [candidate.uid, candidate]));
        renderNearbyMap(filtered);
        renderNearbyList(filtered);
        return filtered;
    }

    function renderNearbyMap(candidates = []) {
        const mapEl = document.getElementById('nearby-map');
        if (!mapEl) return;

        if (!window.L || !myNearbyLocation) {
            mapEl.innerHTML = '<div class="nearby-map-empty">Activa tu ubicación para ver el mapa de canjes cerca.</div>';
            return;
        }

        mapEl.innerHTML = '';
        if (!nearbyMap) {
            nearbyMap = window.L.map(mapEl, { zoomControl: false });
            window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(nearbyMap);
        }

        nearbyMap.setView([myNearbyLocation.lat, myNearbyLocation.lng], 13);
        nearbyMarkers.forEach(marker => marker.remove());
        nearbyMarkers = [];

            nearbyMarkers.push(window.L.marker([myNearbyLocation.lat, myNearbyLocation.lng])
            .addTo(nearbyMap)
            .bindPopup('Tu zona aproximada'));

        candidates.forEach(candidate => {
            const name = escapeHtml(getDisplayName(candidate));
            const marker = window.L.marker([candidate.location.lat, candidate.location.lng])
                .addTo(nearbyMap)
                .bindPopup(`${name}<br>${candidate.matchCount} canjes posibles`);
            nearbyMarkers.push(marker);
        });

        setTimeout(() => nearbyMap.invalidateSize(), 100);
    }

    function renderNearbyList(candidates = []) {
        const listEl = document.getElementById('nearby-list');
        if (!listEl) return;

        if (!myNearbyLocation) {
            listEl.innerHTML = '<div class="notification-empty">Activa tu ubicación para encontrar coleccionistas cerca.</div>';
            return;
        }

        if (candidates.length === 0) {
            listEl.innerHTML = nearbyCandidates.length
                ? '<div class="notification-empty">No hay coleccionistas que coincidan con esos filtros.</div>'
                : '<div class="notification-empty">No hay coleccionistas cercanos activos todavía.</div>';
            return;
        }

        listEl.className = 'nearby-list';
        listEl.innerHTML = candidates.map((candidate, index) => `
            <div class="nearby-card" data-action="toggle-nearby-profile" data-uid="${candidate.uid}">
                <div class="nearby-card-summary">
                    <div>
                        <div class="nearby-card-title">#${index + 1} ${escapeHtml(getDisplayName(candidate))}</div>
                        <div class="nearby-card-copy">${candidate.distanceKm.toFixed(1)} km aprox.</div>
                        <div class="nearby-card-meta">
                            ${getNearbyProfilePills(candidate).map(item => `<span class="nearby-pill">${escapeHtml(item)}</span>`).join('')}
                        </div>
                    </div>
                    <div class="nearby-match-count">${candidate.matchCount}<span>canjes</span></div>
                </div>
                <div class="nearby-profile" id="nearby-profile-${candidate.uid}" hidden>
                    ${candidate.bio ? `<div class="nearby-card-copy">${escapeHtml(candidate.bio)}</div>` : ''}
                    <div class="nearby-profile-grid">
                        <div class="nearby-profile-stat"><strong>${candidate.iCanGetTotal || candidate.iCanGet.length}</strong><span>te puede dar</span></div>
                        <div class="nearby-profile-stat"><strong>${candidate.iCanGiveTotal || candidate.iCanGive.length}</strong><span>tu le das</span></div>
                    </div>
                    <div class="nearby-card-copy">Te puede dar ${candidate.iCanGet.length} láminas y tú le puedes dar ${candidate.iCanGive.length}.</div>
                    ${candidate.iCanGet.length ? `<div class="match-section-title">Te puede dar</div><div class="match-tags">${candidate.iCanGet.map(id => `<span class="match-tag give">${id}</span>`).join('')}</div>` : ''}
                    ${candidate.iCanGive.length ? `<div class="match-section-title">Tú le puedes dar</div><div class="match-tags">${candidate.iCanGive.map(id => `<span class="match-tag take">${id}</span>`).join('')}</div>` : ''}
                    ${candidate.matchCount > 0 ? `<button class="btn-trade" data-action="send-nearby-request" data-uid="${candidate.uid}">Enviar solicitud</button>` : '<div class="nearby-card-copy">Por ahora no hay canjes compatibles.</div>'}
                </div>
            </div>
        `).join('');
    }

    async function refreshNearbyCandidates() {
        const status = document.getElementById('nearby-status');
        if (!currentUser || !myNearbyLocation) return;

        status.textContent = 'Buscando coleccionistas cerca...';

        const allStickers = window.getAllStickers();
        const collectors = await getNearbyCollectors(currentUser);
        nearbyCandidates = collectors.map(collector => {
            const { iCanGet, iCanGive } = getFriendTradeMatches(allStickers, window.state, collector.state || {});
            const matchCount = Math.min(iCanGet.length, iCanGive.length);

            return {
                ...collector,
                iCanGet: iCanGet.slice(0, 8),
                iCanGive: iCanGive.slice(0, 8),
                iCanGetTotal: iCanGet.length,
                iCanGiveTotal: iCanGive.length,
                matchCount,
                distanceKm: calculateDistanceKm(myNearbyLocation, collector.location)
            };
        }).sort((a, b) => (b.matchCount - a.matchCount) || (a.distanceKm - b.distanceKm));

        const filtered = renderFilteredNearbyCandidates();
        status.textContent = nearbyCandidates.length
            ? `Ranking cercano actualizado: ${filtered.length} visibles de ${nearbyCandidates.length}.`
            : 'Tu zona quedó activa. Aún no hay coleccionistas cerca.';
    }

    window.openNearby = function() {
        window.switchView('view-nearby');
        const status = document.getElementById('nearby-status');
        if (status && !window.isSecureContext) {
            status.textContent = 'Estás en HTTP local. En celular, la ubicación real suele requerir HTTPS; usa Probar mapa o despliega en Firebase Hosting.';
        }
        if (myNearbyLocation && nearbyCandidates.length) renderFilteredNearbyCandidates();
        else {
            renderNearbyMap();
            renderNearbyList();
        }
    };

    window.enableNearby = async function() {
        const status = document.getElementById('nearby-status');
        if (!currentUser) return;

        status.textContent = 'Solicitando permiso de ubicación...';

        try {
            const position = await getCurrentPosition();
            myNearbyLocation = await saveNearbyAvailability(currentUser, position.coords, currentProfile);
            pushNotification({
                title: 'Canjes cerca activado',
                message: 'Tu zona aproximada ya aparece para encontrar canjes cercanos.',
                type: 'nearby',
                action: 'friends'
            });
            await refreshNearbyCandidates();
        } catch (e) {
            status.textContent = getLocationErrorMessage(e);
            renderNearbyMap();
        }
    };

    window.enableNearbyDemo = async function() {
        const status = document.getElementById('nearby-status');
        if (!currentUser) return;

        status.textContent = 'Usando una zona de prueba para validar el mapa...';

        try {
            myNearbyLocation = await saveNearbyAvailability(currentUser, {
                latitude: 4.71,
                longitude: -74.07
            }, currentProfile);
            await refreshNearbyCandidates();
            status.textContent = 'Mapa en modo prueba. Para canjes reales, activa la ubicación del navegador.';
        } catch (e) {
            status.textContent = 'No se pudo activar el modo prueba. Revisa Firebase.';
        }
    };

    window.disableNearby = async function() {
        if (!currentUser) return;
        await disableNearbyAvailability(currentUser);
        myNearbyLocation = null;
        nearbyCandidates = [];
        nearbyCandidatesByUid = {};
        document.getElementById('nearby-status').textContent = 'Tu ubicación para canjes cercanos quedó pausada.';
        renderNearbyMap();
        renderNearbyList();
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
        document.getElementById('chat-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') window.sendCurrentChatMessage();
        });
        document.getElementById('display-name-input')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') window.saveDisplayName();
        });
        document.getElementById('nearby-distance-filter')?.addEventListener('change', () => {
            if (myNearbyLocation) {
                const filtered = renderFilteredNearbyCandidates();
                document.getElementById('nearby-status').textContent = `Filtros aplicados: ${filtered.length} visibles de ${nearbyCandidates.length}.`;
            }
        });
        document.getElementById('nearby-min-matches-filter')?.addEventListener('change', () => {
            if (myNearbyLocation) {
                const filtered = renderFilteredNearbyCandidates();
                document.getElementById('nearby-status').textContent = `Filtros aplicados: ${filtered.length} visibles de ${nearbyCandidates.length}.`;
            }
        });
        ['profile-display-name', 'profile-city', 'profile-zone', 'profile-favorite-team', 'profile-trade-style', 'profile-bio'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const originalProfile = currentProfile;
                currentProfile = { ...currentProfile, ...getProfileFormData() };
                fillProfileForm();
                currentProfile = originalProfile;
            });
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

            const soundByAction = {
                'execute-trade': 'trade',
                'open-friends': 'nav',
                'open-nearby': 'nav',
                'open-notifications': 'nav',
                'open-pack': 'nav',
                'open-profile': 'nav',
                'open-share': 'nav',
                'open-summary': 'nav',
                'open-trade': 'trade',
                'open-team-trades': 'trade',
                'send-nearby-request': 'trade',
                'send-team-trade-request': 'trade',
                'send-trade-request': 'trade',
                'share-friend-invite': 'trade',
                'team-trade-whatsapp': 'trade',
                'toggle-group': 'tap'
            };

            const actions = {
                'add-friend': window.addFriend,
                'add-pack': window.addPackStickers,
                'accept-trade-request': (button) => window.respondToTradeRequest(button.dataset.requestId, 'accepted'),
                'capture-scan': window.captureAndScan,
                'close-scanner': window.closeScanner,
                'copy-friend-invite': window.copyFriendInvite,
                'create-friend-group': window.createFriendGroupFromInput,
                'execute-trade': window.executeTrade,
                'go-home': window.goHome,
                'go-register': () => { window.location.href = 'register.html'; },
                'logout': window.handleLogout,
                'open-friends': window.openFriends,
                'open-chat': (button) => window.openTradeChat(button.dataset.requestId),
                'open-nearby': window.openNearby,
                'open-pack': window.openPackMode,
                'open-scanner': window.openScanner,
                'open-share': () => window.switchView('view-share'),
                'open-summary': window.openSummary,
                'open-notifications': window.openNotifications,
                'open-profile': window.openProfile,
                'open-team': (button) => window.openTeam(button.dataset.teamCode, button.dataset.teamName, button.dataset.teamSpecial === 'true'),
                'open-team-trades': window.openTeamTrades,
                'open-trade': window.openTrade,
                'open-whatsapp': (button) => window.open(button.dataset.url, '_blank'),
                'mark-notifications-read': window.markNotificationsRead,
                'reject-trade-request': (button) => window.respondToTradeRequest(button.dataset.requestId, 'rejected'),
                'save-display-name': window.saveDisplayName,
                'save-profile': window.saveProfile,
                'send-chat-message': window.sendCurrentChatMessage,
                'send-nearby-request': (button) => window.sendNearbyTradeRequest(button.dataset.uid),
                'send-team-trade-request': (button) => window.sendTeamTradeRequest(button.dataset.uid),
                'send-trade-request': window.sendInternalTradeRequest,
                'share-card': window.shareCollectionCard,
                'share-friend-invite': window.shareFriendInvite,
                'share-repeated': window.shareRepeated,
                'smart-proposal': window.sendSmartProposal,
                'team-trade-whatsapp': (button) => window.sendTeamTradeWhatsapp(button.dataset.uid),
                'switch-friend-group': (button) => {
                    activeFriendGroupId = button.dataset.groupId || 'all';
                    window.renderFriends();
                },
                'toggle-help': (button) => {
                    const help = document.getElementById(button.dataset.helpTarget);
                    if (help) help.hidden = !help.hidden;
                },
                'toggle-audio': toggleMatchAudio,
                'toggle-nearby-profile': (button) => {
                    if (event.target.closest('[data-action="send-nearby-request"]')) return;
                    const profile = document.getElementById(`nearby-profile-${button.dataset.uid}`);
                    if (profile) profile.hidden = !profile.hidden;
                },
                'clear-notifications': window.clearAllNotifications,
                'close-celebration': window.closeCelebration,
                'disable-nearby': window.disableNearby,
                'enable-nearby': window.enableNearby,
                'enable-nearby-demo': window.enableNearbyDemo,
                'toggle-group': (button) => window.toggleGroup(button.dataset.groupId)
            };

            if (actionButton.dataset.action !== 'toggle-audio') {
                playUiSound(soundByAction[actionButton.dataset.action] || 'tap');
            }
            actions[actionButton.dataset.action]?.(actionButton);
        });
    }

    // BOOTSTRAP INITIALIZATION
    window.onload = () => {
        bindStaticEvents();
        initMatchAudioControls(document.getElementById('sound-toggle'));

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
        renderFriendInviteText();
        window.renderFriends();
    };

    function getFriendInviteUrl() {
        const url = new URL(window.location.href);
        url.hash = 'home';
        url.search = '';
        return url.toString();
    }

    function getFriendInviteMessage() {
        const name = currentProfile.displayName || currentUser?.email || 'un coleccionista';
        const email = currentUser?.email || '';

        return `Hola! Soy ${name} y estoy llenando mi álbum Mundial 2026 en esta app. Quiero comparar canjes contigo.\n\nEntra aquí:\n${getFriendInviteUrl()}\n\nCuando te registres, agrégame con este correo:\n${email}\n\nAsí vemos qué láminas nos faltan, repetidas y posibles canjes.`;
    }

    function renderFriendInviteText(show = false) {
        const box = document.getElementById('friend-invite-text');
        if (!box || !currentUser) return null;

        box.value = getFriendInviteMessage();
        box.hidden = !show;
        return box;
    }

    function setInviteStatus(message, ok = true) {
        const status = document.getElementById('friend-invite-status');
        if (!status) return;

        status.className = ok ? 'mini-feedback ok' : 'mini-feedback err';
        status.textContent = message;
        setTimeout(() => {
            status.className = 'mini-feedback';
            status.textContent = '';
        }, 3200);
    }

    window.shareFriendInvite = function() {
        if (!currentUser) return;
        const msg = getFriendInviteMessage();
        const box = renderFriendInviteText(true);
        const encoded = encodeURIComponent(msg);
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        const url = isMobile
            ? `whatsapp://send?text=${encoded}`
            : `https://api.whatsapp.com/send?text=${encoded}`;

        if (box) {
            box.focus();
            box.select();
            box.setSelectionRange(0, box.value.length);
        }

        setInviteStatus('Si WhatsApp abre sin texto, el mensaje quedó listo abajo para copiar y pegar.');

        try {
            window.location.href = url;
        } catch (e) {
            window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank', 'noopener');
        }
    };

    window.copyFriendInvite = async function() {
        if (!currentUser) return;
        const msg = getFriendInviteMessage();
        const box = renderFriendInviteText(true);

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(msg);
                setInviteStatus('Invitación copiada. Ya puedes pegarla en WhatsApp o donde quieras.');
                return;
            }

            if (box) {
                box.focus();
                box.select();
                box.setSelectionRange(0, box.value.length);
                const copied = document.execCommand('copy');
                if (copied) {
                    setInviteStatus('Invitación copiada. Ya puedes pegarla en WhatsApp o donde quieras.');
                    return;
                }
            }
        } catch (e) {}

        if (box) {
            box.focus();
            box.select();
            box.setSelectionRange(0, box.value.length);
            setInviteStatus('El texto quedó listo abajo. Mantén presionado y copia manualmente.', false);
        } else {
            setInviteStatus('No se pudo preparar el texto. Usa el botón de WhatsApp.', false);
        }
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

    function getFriendInsights(friendSummaries, allStickers) {
        return friendSummaries.map(friend => {
            const { iCanGet, iCanGive } = getFriendTradeMatches(allStickers, window.state, friend.state || {});
            const progress = Math.round((friend.totalOwned / allStickers.length) * 1000) / 10;

            return {
                ...friend,
                iCanGet,
                iCanGive,
                balancedMatches: Math.min(iCanGet.length, iCanGive.length),
                progress
            };
        });
    }

    function renderFriendGroupSummary({ activeGroupName, insights, ranking, allStickers }) {
        const summaryEl = document.getElementById('friends-group-summary');
        if (!summaryEl) return;

        if (insights.length === 0) {
            summaryEl.innerHTML = '';
            return;
        }

        const bestFriend = insights.slice().sort((a, b) => b.totalOwned - a.totalOwned)[0];
        const bestTrade = insights.slice().sort((a, b) => b.balancedMatches - a.balancedMatches || b.iCanGet.length - a.iCanGet.length)[0];
        const totalCanGet = insights.reduce((total, friend) => total + friend.iCanGet.length, 0);
        const topThree = ranking.slice(0, 3);

        summaryEl.innerHTML = `
            <section class="friends-social-panel">
                <div class="social-panel-head">
                    <div>
                        <div class="insight-kicker">Grupo activo</div>
                        <h3>${escapeHtml(activeGroupName)}</h3>
                    </div>
                    <div class="social-group-count">${insights.length} amigos</div>
                </div>
                <div class="social-stat-grid">
                    <div class="social-stat"><strong>${escapeHtml(getDisplayName(bestFriend))}</strong><span>Lider del grupo</span></div>
                    <div class="social-stat"><strong>${totalCanGet}</strong><span>Laminas que te pueden dar</span></div>
                    <div class="social-stat"><strong>${bestTrade?.balancedMatches || 0}</strong><span>Mejor canje justo</span></div>
                </div>
                <div class="ranking-podium">
                    ${topThree.map((item, index) => `
                        <div class="podium-card rank-${index + 1}">
                            <div class="podium-rank">#${index + 1}</div>
                            <div class="podium-name">${escapeHtml(getDisplayName(item))}</div>
                            <div class="podium-score">${item.totalOwned}/${allStickers.length}</div>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
    }

    function getRequestSummary(request) {
        const give = request.proposal?.iCanGive?.length || 0;
        const get = request.proposal?.iCanGet?.length || 0;
        return `${Math.min(give, get)} canjes posibles: tu das ${give} y recibes ${get}.`;
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[char]);
    }

    function getDisplayName(entity = {}) {
        return entity.displayName || entity.fromDisplayName || entity.toDisplayName || entity.email || entity.fromEmail || entity.toEmail || 'Coleccionista';
    }

    function renderTradeRequests(requests) {
        const container = document.getElementById('trade-requests-list');
        if (!container || !currentUser) return;

        const relevant = requests.filter(request => request.status !== 'rejected').slice(0, 5);

        if (relevant.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div class="insight-card">
                <div class="insight-kicker">Solicitudes de canje</div>
                ${relevant.map(request => {
                    const incoming = request.toUid === currentUser.uid;
                    const otherName = incoming
                        ? (request.fromDisplayName || request.fromEmail)
                        : (request.toDisplayName || request.toEmail);
                    const title = incoming ? `${otherName} quiere canjear` : `Solicitud para ${otherName}`;
                    const status = request.status === 'accepted' ? 'Aceptada' : 'Pendiente';
                    const actions = request.status === 'accepted'
                        ? `<button class="btn-trade" data-action="open-chat" data-request-id="${request.id}">Abrir chat</button>`
                        : incoming
                            ? `<button class="btn-trade" data-action="accept-trade-request" data-request-id="${request.id}">Aceptar</button><button class="btn-secondary" data-action="reject-trade-request" data-request-id="${request.id}">Rechazar</button>`
                            : `<button class="btn-secondary" data-action="open-chat" data-request-id="${request.id}">Ver solicitud</button>`;

                    return `
                        <div class="request-card ${request.status}">
                            <div class="request-title">${escapeHtml(title)}</div>
                            <div class="request-copy">${escapeHtml(status)}. ${escapeHtml(getRequestSummary(request))}</div>
                            <div class="request-actions">${actions}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
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
        const summaryEl = document.getElementById('friends-group-summary');
        if (summaryEl) summaryEl.innerHTML = '';
        listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px 0;">Cargando...</div>';

        try {
            const allStickers = window.getAllStickers();
            friendGroups = await getFriendGroups(currentUser);
            if (activeFriendGroupId !== 'all' && !friendGroups.some(group => group.id === activeFriendGroupId)) {
                activeFriendGroupId = 'all';
            }
            renderFriendGroupControls();
            const tradeRequests = await getUserTradeRequests(currentUser);
            tradeRequestsById = Object.fromEntries(tradeRequests.map(request => [request.id, request]));
            renderTradeRequests(tradeRequests);

            const friendSummaries = await getFriendSummaries(currentUser, allStickers, window.state);
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
            const friendInsights = getFriendInsights(visibleFriendSummaries, allStickers);
            const ranking = [
                {
                    uid: currentUser.uid,
                    displayName: currentProfile.displayName || 'Tu album',
                    email: currentUser.email,
                    totalOwned: myStats.unique,
                    duplicateCount: myStats.duplicates,
                    iCanGet: [],
                    iCanGive: [],
                    balancedMatches: 0,
                    progress: Math.round((myStats.unique / allStickers.length) * 1000) / 10,
                    isMe: true
                },
                ...friendInsights
            ].sort((a, b) => b.totalOwned - a.totalOwned);

            renderFriendGroupSummary({ activeGroupName, insights: friendInsights, ranking, allStickers });

            listEl.innerHTML = `
                <div class="insight-card">
                    <div class="insight-kicker">Ranking completo</div>
                </div>
            `;

            ranking.forEach((friend, index) => {
                const card = document.createElement('div');
                const isMe = friend.isMe;
                const progress = Math.min(friend.progress || 0, 100);
                const helpCopy = isMe
                    ? `${friend.duplicateCount || 0} repetidas disponibles para canjear`
                    : friend.iCanGet.length > 0
                        ? `Te puede ayudar con ${friend.iCanGet.length} laminas`
                        : 'Por ahora no tiene repetidas que te falten';
                const tradeCopy = isMe
                    ? 'Tu progreso'
                    : friend.balancedMatches > 0
                        ? `${friend.balancedMatches} canjes justos`
                        : `${friend.iCanGive.length} posibles para ofrecer`;

                card.className = `friend-card social-friend-card ${isMe ? 'is-me' : ''}`;
                card.innerHTML = `
                    <div class="friend-rank">#${index + 1}</div>
                    <div class="friend-info">
                        <div class="friend-email">${escapeHtml(getDisplayName(friend))}</div>
                        <div class="friend-stats">${friend.totalOwned}/${allStickers.length} laminas - ${progress}% listo</div>
                        <div class="friend-progress-track"><span style="width:${progress}%"></span></div>
                        <div class="friend-help-copy">${escapeHtml(helpCopy)}</div>
                    </div>
                    <div class="friend-match-badge">${escapeHtml(tradeCopy)}</div>
                    ${isMe ? '' : '<svg class="friend-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'}
                `;
                if (!isMe) {
                    card.addEventListener('click', () => window.viewFriendTrades(friend.uid, friend.email, friend.state, friend.displayName));
                }
                listEl.appendChild(card);
            });
        } catch(e) {
            if (summaryEl) summaryEl.innerHTML = '';
            listEl.innerHTML = '<div class="friends-empty"><strong>Error</strong>No se pudieron cargar los amigos. Verifica las reglas de Firebase Database.</div>';
        }
    };
    window.viewFriendTrades = function(fUid, fEmail, fState, fDisplayName = '') {
        document.getElementById('friend-trade-title').textContent = (fDisplayName || fEmail.split('@')[0]).toUpperCase();
        const backButton = document.querySelector('#view-friend-trades .btn-back');
        if (backButton) {
            backButton.dataset.action = 'open-friends';
            delete backButton.dataset.teamCode;
            delete backButton.dataset.teamName;
            delete backButton.dataset.teamSpecial;
        }
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
                friendUid: fUid,
                friendEmail: fEmail,
                friendDisplayName: fDisplayName || fEmail,
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
                html += `<div class="smart-proposal">
                    <button class="btn-trade" data-action="send-trade-request">Enviar solicitud interna (${proposalSize} x ${proposalSize})</button>
                    <button class="btn-secondary" data-action="smart-proposal">Enviar por WhatsApp</button>
                </div>`;
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

    window.sendInternalTradeRequest = async function() {
        const proposal = window.smartProposalContext;
        if (!currentUser || !proposal || !proposal.friendUid) return;

        try {
            const request = await createTradeRequest({
                currentUser,
                currentProfile,
                targetUid: proposal.friendUid,
                targetEmail: proposal.friendEmail,
                targetDisplayName: proposal.friendDisplayName,
                proposal: {
                    iCanGet: proposal.iCanGet,
                    iCanGive: proposal.iCanGive
                }
            });

            pushNotification({
                title: 'Solicitud enviada',
                message: `Tu solicitud de canje para ${proposal.friendDisplayName || proposal.friendEmail} quedó pendiente.`,
                type: 'trade-request',
                action: 'friends'
            });
            alert('Solicitud enviada. Cuando la otra persona acepte, se habilita el chat.');
            tradeRequestsById[request.id] = request;
            window.openFriends();
        } catch (e) {
            alert('No se pudo enviar la solicitud. Revisa Firebase.');
        }
    };

    window.sendNearbyTradeRequest = async function(uid) {
        const candidate = nearbyCandidatesByUid[uid];
        if (!currentUser || !candidate || candidate.matchCount === 0) return;

        try {
            await createTradeRequest({
                currentUser,
                currentProfile,
                targetUid: candidate.uid,
                targetEmail: candidate.email,
                targetDisplayName: candidate.displayName,
                proposal: {
                    iCanGet: candidate.iCanGet,
                    iCanGive: candidate.iCanGive
                }
            });

            pushNotification({
                title: 'Solicitud cercana enviada',
                message: `Tu solicitud de canje para ${getDisplayName(candidate)} quedó pendiente.`,
                type: 'nearby',
                action: 'friends'
            });
            alert('Solicitud enviada. Si la otra persona acepta, se habilita el chat interno.');
        } catch (e) {
            alert('No se pudo enviar la solicitud cercana.');
        }
    };

    window.respondToTradeRequest = async function(requestId, status) {
        const request = tradeRequestsById[requestId];
        if (!request || !currentUser) return;

        try {
            await respondTradeRequest({ request, currentUser, status });
            pushNotification({
                title: status === 'accepted' ? 'Solicitud aceptada' : 'Solicitud rechazada',
                message: status === 'accepted' ? 'Ya puedes abrir el chat para coordinar el canje.' : 'La solicitud fue rechazada.',
                type: 'trade-request',
                action: 'friends'
            });
            await window.renderFriends();
            if (status === 'accepted') window.openTradeChat(requestId);
        } catch (e) {
            alert('No se pudo actualizar la solicitud.');
        }
    };

    window.openTradeChat = function(requestId) {
        const request = tradeRequestsById[requestId];
        if (!request || !currentUser) return;

        if (request.status !== 'accepted') {
            alert('El chat se habilita cuando la solicitud sea aceptada.');
            return;
        }

        if (unsubscribeChat) unsubscribeChat();
        currentChat = request;
        const otherName = request.fromUid === currentUser.uid
            ? (request.toDisplayName || request.toEmail)
            : (request.fromDisplayName || request.fromEmail);
        document.getElementById('chat-title').textContent = otherName.toUpperCase();
        document.getElementById('chat-context').textContent = getRequestSummary(request);
        document.getElementById('chat-input').value = '';
        window.switchView('view-chat');

        unsubscribeChat = watchChatMessages(request.chatId, (messages) => {
            const container = document.getElementById('chat-messages');
            container.innerHTML = messages.length ? '' : '<div class="friends-empty"><strong>Sin mensajes</strong>Escribe el primer mensaje para coordinar el canje.</div>';

            messages.forEach(message => {
                const bubble = document.createElement('div');
                bubble.className = `chat-bubble ${message.fromUid === currentUser.uid ? 'mine' : ''}`;
                const meta = document.createElement('div');
                meta.className = 'chat-meta';
                meta.textContent = message.fromDisplayName || message.fromEmail;
                const text = document.createElement('div');
                text.textContent = message.text;
                bubble.appendChild(meta);
                bubble.appendChild(text);
                container.appendChild(bubble);
            });

            container.scrollTop = container.scrollHeight;
        });
    };

    window.sendCurrentChatMessage = async function() {
        const input = document.getElementById('chat-input');
        if (!currentChat || !currentUser || !input) return;

        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        await sendChatMessage({
            chatId: currentChat.chatId,
            currentUser,
            currentProfile,
            text
        });
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

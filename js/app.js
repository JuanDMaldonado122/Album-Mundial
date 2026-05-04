import { albumDatabase } from "./data/albumData.js";
import { addPackFromText } from "./features/pack.js";
import { generateStickerPdf } from "./features/pdfExport.js";
import { captureAndScan, closeScanner, openScanner } from "./features/scanner.js";
import { createCollectionShareCard } from "./features/shareCard.js";
import { executeManualTrade, openTradeView } from "./features/trade.js";
import { addActivity, formatActivityHour, formatActivityTime, getActivity } from "./services/activityService.js";
import { loginUser, logoutUser, persistAuthSession, registerUser, watchAuthState } from "./services/authService.js";
import { createTradeRequest, getUserTradeRequests, respondTradeRequest, sendChatMessage, watchChatMessages } from "./services/chatService.js";
import { getAlbumStats, getAllStickers, getDuplicateStickerIds, getSummaryLists, getTeamStickers } from "./services/albumService.js";
import { auth, db } from "./services/firebaseService.js";
import { addFriendByEmail, addFriendToGroup, createFriendGroup, getFriendGroups, getFriendSummaries, getFriendTradeMatches, getUserProfile, registerUserForFriendLookup, saveUserProfile } from "./services/friendsService.js";
import { calculateDistanceKm, disableNearbyAvailability, getNearbyCollectors, saveNearbyAvailability } from "./services/nearbyService.js";
import { addNotification, clearNotifications, formatNotificationTime, getNotifications, getUnreadNotificationCount, markAllNotificationsRead, markMilestoneNotified, wasMilestoneNotified } from "./services/notificationService.js";
import { initMatchAudioControls, isMatchAudioEnabled, playUiSound, toggleMatchAudio } from "./services/audioService.js";
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
    let homeTradeCandidatesByUid = {};
    let myNearbyLocation = null;
    let suppressStickerAudio = false;
    let celebrationTimer = null;
    let deferredInstallPrompt = null;
    const APP_VERSION = 'v5.31';
    const INSTALL_DISMISSED_KEY = 'album26-install-dismissed';
    const ONBOARDING_SEEN_KEY = 'album26-onboarding-seen';
    const SOCIAL_STARTED_KEY = 'album26-social-started';
    let currentHomeTab = 'inicio';
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
            trackActivity('profile', 'Perfil listo', `Elegiste el nombre ${displayName}.`);
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

    function getCollectorLevel(stats) {
        const unique = stats.unique || 0;
        if (unique >= 800) return { label: 'Leyenda mundial', level: 5, next: 980, base: 800 };
        if (unique >= 500) return { label: 'Capitán del álbum', level: 4, next: 800, base: 500 };
        if (unique >= 250) return { label: 'Titular fijo', level: 3, next: 500, base: 250 };
        if (unique >= 75) return { label: 'Promesa mundialista', level: 2, next: 250, base: 75 };
        return { label: 'Debut mundialista', level: 1, next: 75, base: 0 };
    }

    function getProfileReadiness(profile = {}) {
        const steps = [
            { label: 'Apodo visible', done: Boolean(profile.displayName?.trim()) },
            { label: 'Ciudad o zona', done: Boolean(profile.city?.trim() || profile.zone?.trim()) },
            { label: 'Equipo favorito', done: Boolean(profile.favoriteTeam?.trim()) },
            { label: 'Estilo de canje', done: Boolean(profile.tradeStyle) },
            { label: 'Frase personal', done: Boolean(profile.bio?.trim()) }
        ];
        const done = steps.filter(step => step.done).length;
        return { steps, done, percentage: Math.round((done / steps.length) * 100) };
    }

    function renderProfileChecklist(containerId, readiness) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = readiness.steps.map(step => `
            <div class="profile-check-item ${step.done ? 'is-done' : ''}">
                <span>${step.done ? '✓' : '·'}</span>
                <strong>${escapeHtml(step.label)}</strong>
            </div>
        `).join('');
    }

    function renderProfileReadiness(profile = {}) {
        const readiness = getProfileReadiness(profile);
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        const setWidth = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.style.width = `${value}%`;
        };

        setText('home-profile-readiness-score', `${readiness.percentage}%`);
        setText('profile-readiness-score', `${readiness.percentage}%`);
        setWidth('home-profile-readiness-bar', readiness.percentage);
        setWidth('profile-readiness-bar', readiness.percentage);
        renderProfileChecklist('home-profile-checklist', readiness);
        renderProfileChecklist('profile-readiness-list', readiness);
    }

    function renderHomeProfileCard() {
        if (!currentUser) return;

        const profile = currentProfile || {};
        const stats = getAlbumStats(window.state || {});
        const displayName = profile.displayName || currentUser.email?.split('@')[0] || 'Coleccionista';
        const metaParts = [
            profile.favoriteTeam ? `Hincha de ${profile.favoriteTeam}` : '',
            profile.city || profile.zone || '',
            getTradeStyleLabel(profile.tradeStyle)
        ].filter(Boolean);
        const level = getCollectorLevel(stats);
        const levelProgress = level.next === level.base
            ? 100
            : Math.min(100, Math.max(0, Math.round(((stats.unique - level.base) / (level.next - level.base)) * 100)));

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setText('home-profile-avatar', displayName.slice(0, 1).toUpperCase());
        setText('home-profile-name', displayName);
        setText('home-profile-meta', metaParts.join(' - ') || 'Completa tu perfil para que tus canjes tengan más personalidad.');
        setText('home-profile-level', `Nivel ${level.level} - ${level.label}`);
        setText('home-profile-unique', stats.unique);
        setText('home-profile-duplicates', stats.duplicates);
        setText('home-profile-percent', `${stats.percentage}%`);
        setText('home-profile-team', profile.favoriteTeam || 'Por elegir');
        setText('home-profile-location', [profile.city, profile.zone].filter(Boolean).join(' - ') || 'Sin zona');
        setText('home-profile-style', getTradeStyleLabel(profile.tradeStyle));
        setText('home-profile-bio', profile.bio || 'Agrega una frase para que otros coleccionistas sepan como te gusta canjear.');

        const bar = document.getElementById('home-profile-level-bar');
        if (bar) bar.style.width = `${levelProgress}%`;
        const avatar = document.getElementById('home-profile-avatar');
        if (avatar) avatar.className = `profile-dashboard-avatar level-${level.level}`;
        renderProfileReadiness(profile);
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
        renderProfileReadiness({ displayName, city, zone, favoriteTeam, tradeStyle, bio });
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
            trackActivity('profile', 'Perfil actualizado', 'Actualizaste tu información visible para rankings y canjes.');
            fillProfileForm();
            renderHomeProfileCard();
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

    function getSettingsStatusItems() {
        const notifications = currentUser ? getNotifications(currentUser.uid) : [];
        const unread = currentUser ? getUnreadNotificationCount(currentUser.uid) : 0;
        const locationCopy = myNearbyLocation
            ? 'Activa para canjes cerca'
            : window.isSecureContext
                ? 'Pausada'
                : 'Limitada en HTTP local';

        return [
            {
                label: 'Conexion',
                value: navigator.onLine ? 'En linea' : 'Sin conexion',
                state: navigator.onLine ? 'good' : 'warn'
            },
            {
                label: 'Cuenta',
                value: currentUser ? 'Firebase activo' : 'Sin sesion',
                state: currentUser ? 'good' : 'warn'
            },
            {
                label: 'Sonido',
                value: isMatchAudioEnabled() ? 'Modo gol activo' : 'Silenciado',
                state: isMatchAudioEnabled() ? 'good' : 'muted'
            },
            {
                label: 'Notificaciones',
                value: notifications.length ? `${unread} nuevas / ${notifications.length} total` : 'Sin avisos',
                state: unread > 0 ? 'warn' : 'good'
            },
            {
                label: 'Ubicacion',
                value: locationCopy,
                state: myNearbyLocation ? 'good' : 'muted'
            },
            {
                label: 'Instalacion',
                value: isStandaloneApp() ? 'Instalada como app' : 'Lista para instalar',
                state: isStandaloneApp() ? 'good' : 'warn'
            }
        ];
    }

    window.renderSettingsView = function() {
        const name = document.getElementById('settings-display-name');
        const email = document.getElementById('settings-email');
        const version = document.getElementById('settings-version');
        const statusList = document.getElementById('settings-status-list');
        const soundButton = document.getElementById('settings-sound-toggle');
        const locationHint = document.getElementById('settings-location-hint');

        if (name) name.textContent = currentProfile.displayName || 'Coleccionista';
        if (email) email.textContent = currentUser?.email || 'Sin cuenta activa';
        if (version) version.textContent = APP_VERSION;
        if (soundButton) soundButton.textContent = isMatchAudioEnabled() ? 'Apagar sonido' : 'Activar modo gol';
        if (locationHint) {
            locationHint.textContent = myNearbyLocation
                ? 'Tu zona aproximada esta activa para encontrar canjes cercanos.'
                : 'Activa la ubicacion desde Canjes Cerca cuando quieras aparecer en el ranking cercano.';
        }

        if (statusList) {
            statusList.innerHTML = getSettingsStatusItems().map(item => `
                <div class="settings-status-row">
                    <span class="settings-dot ${item.state}"></span>
                    <div>
                        <strong>${item.label}</strong>
                        <small>${item.value}</small>
                    </div>
                </div>
            `).join('');
        }
    };

    window.openSettings = function() {
        window.renderSettingsView();
        const status = document.getElementById('settings-action-status');
        if (status) status.textContent = '';
        window.switchView('view-settings');
    };

    window.testSettingsSound = function() {
        if (!isMatchAudioEnabled()) toggleMatchAudio();
        playUiSound('packGoal');
        window.renderSettingsView();
    };

    window.resetOnboardingGuide = function() {
        localStorage.removeItem(ONBOARDING_SEEN_KEY);
        const status = document.getElementById('settings-action-status');
        if (status) status.textContent = 'Guia reiniciada. La puedes abrir de nuevo cuando quieras.';
        window.renderSettingsView();
    };

    window.refreshSettings = function() {
        window.renderSettingsView();
        const status = document.getElementById('settings-action-status');
        if (status) status.textContent = 'Estado actualizado.';
    };


    /* === ALBUM LOGIC === */
    function pushNotification(data) {
        if (!currentUser) return;
        addNotification(currentUser.uid, data);
        window.renderNotificationBadge();
    }

    function trackActivity(type, title, message) {
        if (!currentUser) return;
        addActivity(currentUser.uid, { type, title, message });
        renderActivityCenter();
    }

    function getActivityIcon(type = 'general') {
        return {
            sticker: 'L',
            duplicate: 'R',
            pack: 'S',
            achievement: 'G',
            friend: 'A',
            group: 'G',
            trade: 'C',
            nearby: 'U',
            profile: 'P',
            general: 'A'
        }[type] || 'A';
    }

    function renderActivityCenter() {
        const feed = document.getElementById('activity-feed');
        const count = document.getElementById('activity-count');
        if (!feed || !count || !currentUser) return;

        const activity = getActivity(currentUser.uid);
        count.innerHTML = `<strong>${activity.length}</strong><span>movs</span>`;

        if (activity.length === 0) {
            const stats = getAlbumStats(window.state || {});
            feed.innerHTML = stats.unique > 0
                ? `<div class="activity-card activity-card-featured">
                    <div class="activity-icon">A</div>
                    <div>
                        <div class="activity-title">Álbum en marcha</div>
                        <div class="activity-message">Ya tienes ${stats.unique} láminas únicas y ${stats.duplicates} repetidas. Tus próximos movimientos se guardarán aquí.</div>
                    </div>
                    <div class="activity-date">Ahora</div>
                </div>`
                : '<div class="activity-empty">Agrega una lámina, un sobre o una solicitud de canje y aquí aparecerá tu historia del álbum.</div>';
            return;
        }

        feed.innerHTML = activity.slice(0, 6).map(item => `
            <div class="activity-card">
                <div class="activity-icon">${escapeHtml(getActivityIcon(item.type))}</div>
                <div>
                    <div class="activity-title">${escapeHtml(item.title || 'Movimiento')}</div>
                    <div class="activity-message">${escapeHtml(item.message)}</div>
                </div>
                <div class="activity-date">${escapeHtml(formatActivityTime(item.at))}<br>${escapeHtml(formatActivityHour(item.at))}</div>
            </div>
        `).join('');
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
                trackActivity('achievement', `Álbum al ${milestone}%`, `Llegaste a ${nextStats.unique} láminas únicas.`);
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

    function getSocialStartedKey() {
        return currentUser ? `${SOCIAL_STARTED_KEY}-${currentUser.uid}` : SOCIAL_STARTED_KEY;
    }

    function markSocialStarted() {
        if (!currentUser) return;
        localStorage.setItem(getSocialStartedKey(), 'true');
        renderQuickStartPanel();
    }

    function getQuickStartSteps() {
        const stats = getAlbumStats(window.state || {});
        const hasProfile = Boolean(currentProfile.displayName && (currentProfile.city || currentProfile.zone || currentProfile.favoriteTeam || currentProfile.bio));
        const socialStarted = localStorage.getItem(getSocialStartedKey()) === 'true'
            || friendGroups.some(group => Object.keys(group.members || {}).length > 0);

        return [
            {
                id: 'profile',
                done: hasProfile,
                title: 'Perfil con personalidad',
                detail: hasProfile ? 'Tu apodo ya tiene contexto para rankings y canjes.' : 'Agrega ciudad, zona o equipo favorito para que otros te ubiquen mejor.',
                action: 'open-profile',
                actionLabel: hasProfile ? 'Editar' : 'Completar'
            },
            {
                id: 'stickers',
                done: stats.unique > 0,
                title: 'Primeras láminas',
                detail: stats.unique > 0 ? `Ya tienes ${stats.unique} únicas en el álbum.` : 'Carga un sobre o abre un equipo para marcar tus primeras láminas.',
                action: 'open-pack',
                actionLabel: stats.unique > 0 ? 'Sumar' : 'Agregar'
            },
            {
                id: 'friends',
                done: socialStarted,
                title: 'Tu gente invitada',
                detail: socialStarted ? 'Ya empezaste la parte social del álbum.' : 'Invita amigos o arma un grupo familiar para comparar progreso.',
                action: 'open-friends',
                actionLabel: socialStarted ? 'Ver' : 'Invitar'
            },
            {
                id: 'trades',
                done: stats.duplicates > 0,
                title: 'Material para canjear',
                detail: stats.duplicates > 0 ? `Tienes ${stats.duplicates} repetidas para buscar canjes inteligentes.` : 'Cuando tengas repetidas, la app podrá recomendar propuestas.',
                action: 'open-friends',
                actionLabel: stats.duplicates > 0 ? 'Buscar' : 'Ver'
            }
        ];
    }

    function renderQuickStartPanel() {
        if (!currentUser) return;

        const steps = getQuickStartSteps();
        const doneCount = steps.filter(step => step.done).length;
        const percent = Math.round((doneCount / steps.length) * 100);
        const list = document.getElementById('quick-start-list');
        const score = document.getElementById('quick-start-score');
        const bar = document.getElementById('quick-start-bar');
        const title = document.getElementById('quick-start-title');
        const onboardingTitle = document.getElementById('onboarding-title');
        const onboardingCopy = document.getElementById('onboarding-copy');
        const onboardingScore = document.getElementById('onboarding-progress-score');
        const onboardingBar = document.getElementById('onboarding-progress-bar');
        const primary = document.getElementById('onboarding-primary');
        const nextStep = steps.find(step => !step.done) || steps[steps.length - 1];

        if (title) title.textContent = doneCount === steps.length ? 'Listo para canjear' : 'Tu álbum, listo para jugar';
        if (score) score.textContent = `${doneCount}/${steps.length}`;
        if (bar) bar.style.width = `${percent}%`;
        if (onboardingScore) onboardingScore.textContent = `${doneCount}/${steps.length}`;
        if (onboardingBar) onboardingBar.style.width = `${percent}%`;
        if (onboardingTitle) onboardingTitle.textContent = currentProfile.displayName ? `Hola, ${currentProfile.displayName}` : 'Que empiece el álbum';
        if (onboardingCopy) {
            onboardingCopy.textContent = doneCount === steps.length
                ? 'Tu base está lista. Ahora puedes enfocarte en completar equipos y cerrar canjes inteligentes.'
                : `Te falta ${steps.length - doneCount} paso${steps.length - doneCount === 1 ? '' : 's'} para dejar el álbum bien armado.`;
        }
        if (primary) {
            primary.textContent = nextStep.done ? 'Ver canjes' : nextStep.actionLabel;
            primary.dataset.nextAction = nextStep.action;
        }

        if (list) {
            list.innerHTML = steps.map(step => `
                <div class="quick-start-item ${step.done ? 'is-done' : ''}">
                    <div class="quick-start-check">${step.done ? '✓' : '•'}</div>
                    <div>
                        <strong>${escapeHtml(step.title)}</strong>
                        <small>${escapeHtml(step.detail)}</small>
                    </div>
                    <button class="quick-start-action" data-action="${step.action}">${escapeHtml(step.actionLabel)}</button>
                </div>
            `).join('');
        }

        steps.forEach(step => {
            const element = document.querySelector(`[data-onboarding-step="${step.id}"]`);
            if (element) element.classList.toggle('is-done', step.done);
        });
    }

    function maybeShowOnboarding() {
        if (!currentUser || localStorage.getItem(ONBOARDING_SEEN_KEY) === 'true') return;
        window.setTimeout(() => window.showOnboarding(false), 450);
    }

    window.showOnboarding = function(force = true) {
        const overlay = document.getElementById('onboarding-overlay');
        if (!overlay) return;
        if (force) localStorage.removeItem(ONBOARDING_SEEN_KEY);
        renderQuickStartPanel();
        overlay.hidden = false;
    };

    window.finishOnboarding = function() {
        localStorage.setItem(ONBOARDING_SEEN_KEY, 'true');
        const overlay = document.getElementById('onboarding-overlay');
        if (overlay) overlay.hidden = true;
    };

    window.onboardingPrimary = function(button) {
        const nextAction = button?.dataset.nextAction || getQuickStartSteps().find(step => !step.done)?.action || 'open-friends';
        window.finishOnboarding();
        if (nextAction === 'open-profile') window.openProfile();
        else if (nextAction === 'open-pack') window.openPackMode();
        else if (nextAction === 'open-friends') window.openFriends();
        else window.goHome();
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
            trackActivity('achievement', title, message);
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
        trackActivity(delta > 0 ? 'sticker' : 'general', delta > 0 ? 'Lámina agregada' : 'Lámina ajustada', `${delta > 0 ? 'Agregaste' : 'Quitaste'} ${id}.`);
        if (delta > 0 && newVal > 1) {
            pushNotification({
                title: 'Nueva repetida',
                message: `${id} ahora está repetida y puede servir para canjes.`,
                type: 'duplicate',
                action: 'friends'
            });
            trackActivity('duplicate', 'Nueva repetida', `${id} ya está disponible para canjes.`);
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
        renderQuickStartPanel();
        renderAchievements();
        renderActivityCenter();
        renderHomeProfileCard();
        if (currentHomeTab === 'album') {
            renderGroupList(window.DB, window.state);
            filterTeams();
        }
        if (currentHomeTab === 'canjes') renderTradeHomePanel();
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

        trackActivity('pack', 'Sobre agregado', `Agregaste ${result.accepted.length} láminas desde un sobre.`);
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
        document.body.classList.toggle('home-active', viewId === 'view-home');
        window.scrollTo(0,0);
        if (pushState && viewId !== 'view-auth') {
            history.pushState({ view: viewId }, '', '#' + viewId);
        }
    };

    window.switchHomeTab = function(tab = 'inicio') {
        currentHomeTab = tab;
        document.querySelectorAll('[data-home-panel]').forEach(panel => {
            panel.classList.toggle('active', panel.dataset.homePanel === tab);
        });
        document.querySelectorAll('[data-action="switch-home-tab"]').forEach(button => {
            button.classList.toggle('active', button.dataset.homeTab === tab);
            button.setAttribute('aria-current', button.dataset.homeTab === tab ? 'page' : 'false');
        });
        if (tab === 'album') {
            renderGroupList(window.DB, window.state);
            filterTeams();
        }
        if (tab === 'canjes') renderTradeHomePanel();
        window.scrollTo(0, 0);
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
                ? `Bienvenido, ${escapeHtml(currentProfile.displayName)} <span style="color:var(--fifa-lime); opacity:0.8;">${APP_VERSION}</span>`
                : `Álbum Sincronizado <span style="color:var(--fifa-lime); opacity:0.8;">${APP_VERSION}</span>`;
        }
        const profileButtonLabel = document.querySelector('.profile-button span');
        if (profileButtonLabel) {
            profileButtonLabel.textContent = currentProfile.displayName || 'Perfil';
        }
        renderHomeProfileCard();
        window.switchView('view-home', false);
        window.switchHomeTab(currentHomeTab);
        history.replaceState({ view: 'view-home' }, '', '#home');
        window.updateStats(); 
        updateInstallCard();
        maybeShowOnboarding();
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
        const recommendation = buildSmartTradeRecommendation({
            friendUid: candidate.uid,
            friendEmail: candidate.email,
            friendDisplayName: candidate.displayName || candidate.email,
            friendState: candidate.state || {},
            iCanGet: candidate.iCanGet,
            iCanGive: candidate.iCanGive
        });

        if (!recommendation) return null;
        return {
            ...recommendation.proposal,
            teamName: candidate.teamName
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
                const proposal = buildTeamTradeProposal(candidate);
                const canRequest = Boolean(proposal);
                const actionCopy = canRequest
                    ? `${proposal.iCanGet.length} x ${proposal.iCanGive.length} recomendado. ${proposal.reason || ''}`
                    : 'Te puede ayudar, pero aun no tienes repetidas compatibles para ofrecerle.';

                return `
                    <div class="request-card team-trade-card">
                        <div class="team-trade-top">
                            <div>
                                <div class="request-title">${escapeHtml(candidate.displayName || candidate.email)}</div>
                                <div class="request-copy">${escapeHtml(actionCopy)}</div>
                            </div>
                            <div class="friend-match-badge">${canRequest ? escapeHtml(proposal.label || 'Match') : candidate.iCanGet.length}</div>
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
                    proposalSize: Math.min(iCanGet.length, iCanGive.length, 5),
                    smartScore: buildSmartTradeRecommendation({
                        friendUid: friend.uid,
                        friendEmail: friend.email,
                        friendDisplayName: friend.displayName,
                        friendState: friend.state || {},
                        iCanGet,
                        iCanGive
                    })?.score || 0
                };
            }).filter(candidate => candidate.iCanGet.length > 0)
              .sort((a, b) => b.smartScore - a.smartScore || b.proposalSize - a.proposalSize || b.iCanGet.length - a.iCanGet.length);

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
            trackActivity('nearby', 'Canjes cerca activado', 'Activaste tu zona aproximada para encontrar coleccionistas.');
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
            const tabButton = event.target.closest('.summary-tabs [data-tab]');
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
                'open-settings': 'nav',
                'open-scanner': 'nav',
                'open-share': 'nav',
                'open-summary': 'nav',
                'open-trade': 'trade',
                'open-team-trades': 'trade',
                'send-nearby-request': 'trade',
                'quick-chat': 'trade',
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
                'finish-onboarding': window.finishOnboarding,
                'go-home': window.goHome,
                'go-register': () => { window.location.href = 'register.html'; },
                'install-app': window.installApp,
                'logout': window.handleLogout,
                'open-friends': window.openFriends,
                'open-chat': (button) => window.openTradeChat(button.dataset.requestId),
                'open-nearby': window.openNearby,
                'open-pack': window.openPackMode,
                'onboarding-primary': window.onboardingPrimary,
                'open-scanner': window.openScanner,
                'open-share': () => window.switchView('view-share'),
                'open-settings': window.openSettings,
                'open-summary': window.openSummary,
                'open-notifications': window.openNotifications,
                'open-profile': window.openProfile,
                'open-home-best-trade': (button) => window.openHomeBestTrade(button.dataset.uid),
                'open-team': (button) => window.openTeam(button.dataset.teamCode, button.dataset.teamName, button.dataset.teamSpecial === 'true'),
                'open-team-trades': window.openTeamTrades,
                'open-trade': window.openTrade,
                'open-whatsapp': (button) => window.open(button.dataset.url, '_blank'),
                'mark-notifications-read': window.markNotificationsRead,
                'reject-trade-request': (button) => window.respondToTradeRequest(button.dataset.requestId, 'rejected'),
                'quick-chat': (button) => window.sendQuickChatMessage(button.dataset.message),
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
                'show-onboarding': () => window.showOnboarding(true),
                'refresh-settings': window.refreshSettings,
                'reset-onboarding-guide': window.resetOnboardingGuide,
                'switch-home-tab': (button) => window.switchHomeTab(button.dataset.homeTab),
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
                'test-settings-sound': window.testSettingsSound,
                'toggle-nearby-profile': (button) => {
                    if (event.target.closest('[data-action="send-nearby-request"]')) return;
                    const profile = document.getElementById(`nearby-profile-${button.dataset.uid}`);
                    if (profile) profile.hidden = !profile.hidden;
                },
                'clear-notifications': window.clearAllNotifications,
                'close-celebration': window.closeCelebration,
                'disable-nearby': window.disableNearby,
                'dismiss-install': window.dismissInstall,
                'enable-nearby': window.enableNearby,
                'enable-nearby-demo': window.enableNearbyDemo,
                'toggle-group': (button) => window.toggleGroup(button.dataset.groupId)
            };

            if (!['toggle-audio', 'test-settings-sound'].includes(actionButton.dataset.action)) {
                playUiSound(soundByAction[actionButton.dataset.action] || 'tap');
            }
            actions[actionButton.dataset.action]?.(actionButton);
            if (actionButton.dataset.action === 'toggle-audio') {
                window.renderSettingsView?.();
            }
            if (actionButton.dataset.action === 'open-profile') {
                window.finishOnboarding?.();
            }
        });
    }

    function isStandaloneApp() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function isIosDevice() {
        return /iPhone|iPad|iPod/i.test(navigator.userAgent);
    }

    function updateInstallCard(force = false) {
        const card = document.getElementById('install-card');
        const title = document.getElementById('install-title');
        const copy = document.getElementById('install-copy');
        const action = document.getElementById('install-action');
        if (!card || !title || !copy || !action) return;

        const dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY) === 'true';
        if (isStandaloneApp() || (dismissed && !force)) {
            card.hidden = true;
            return;
        }

        if (deferredInstallPrompt) {
            title.textContent = 'Instala Album 26';
            copy.textContent = 'Guardala como app para entrar directo al album, revisar canjes y seguir jugando en pantalla completa.';
            action.textContent = 'Instalar app';
            card.hidden = false;
            return;
        }

        if (isIosDevice()) {
            title.textContent = 'Llevala al inicio';
            copy.textContent = 'En iPhone toca Compartir, elige Agregar a pantalla de inicio y quedara como una app del album.';
            action.textContent = 'Ver guía';
            card.hidden = false;
            return;
        }

        if (force) {
            title.textContent = 'Instalacion manual';
            copy.textContent = 'Abre el menu del navegador y busca Instalar app o Agregar a pantalla principal.';
            action.textContent = 'Entendido';
            card.hidden = false;
        }
    }

    window.installApp = async function() {
        localStorage.removeItem(INSTALL_DISMISSED_KEY);

        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const choice = await deferredInstallPrompt.userChoice.catch(() => null);
            deferredInstallPrompt = null;
            if (choice?.outcome === 'accepted') {
                document.getElementById('install-card').hidden = true;
            } else {
                updateInstallCard(true);
            }
            return;
        }

        updateInstallCard(true);
    };

    window.dismissInstall = function() {
        localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
        const card = document.getElementById('install-card');
        if (card) card.hidden = true;
    };

    function updateConnectionBanner(isOnline = navigator.onLine, announceOnline = false) {
        const banner = document.getElementById('connection-banner');
        const title = document.getElementById('connection-title');
        const copy = document.getElementById('connection-copy');
        if (!banner || !title || !copy) return;

        banner.classList.toggle('online', isOnline);
        if (isOnline) {
            if (!announceOnline) {
                banner.hidden = true;
                return;
            }
            title.textContent = 'De vuelta en línea';
            copy.textContent = 'La app vuelve a sincronizar álbum, amigos y canjes.';
            banner.hidden = false;
            setTimeout(() => { banner.hidden = true; }, 2600);
            return;
        }

        title.textContent = 'Sin conexión';
        copy.textContent = 'Puedes revisar lo ya cargado; los cambios se sincronizan cuando vuelva internet.';
        banner.hidden = false;
    }

    function initPwaExperience() {
        window.addEventListener('beforeinstallprompt', (event) => {
            event.preventDefault();
            deferredInstallPrompt = event;
            updateInstallCard();
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            localStorage.setItem(INSTALL_DISMISSED_KEY, 'true');
            const card = document.getElementById('install-card');
            if (card) card.hidden = true;
        });

        window.addEventListener('online', () => updateConnectionBanner(true, true));
        window.addEventListener('offline', () => updateConnectionBanner(false));
        updateConnectionBanner(navigator.onLine);
        updateInstallCard();
    }

    // BOOTSTRAP INITIALIZATION
    window.onload = () => {
        bindStaticEvents();
        initMatchAudioControls(document.getElementById('sound-toggle'));
        initPwaExperience();

        // Init SW 
        if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e=>{});

        renderGroupList(window.DB, window.state);
        
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
        markSocialStarted();
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
        markSocialStarted();
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

    function getStickerTradeImpact(stickerId, state = {}) {
        const team = getTeamForSticker(window.DB, stickerId);
        if (!team) {
            return {
                score: 10,
                label: 'Nueva lamina',
                detail: 'Suma una lamina que falta en el album.',
                teamName: 'Album',
                missingBefore: 0,
                missingAfter: 0,
                completesTeam: false
            };
        }

        const stickers = getTeamStickers(window.DB, team.code, team.isSpecial);
        const owned = stickers.filter(id => (state[id] || 0) > 0).length;
        const missingBefore = Math.max(stickers.length - owned, 1);
        const missingAfter = Math.max(missingBefore - 1, 0);
        let score = 18 + Math.max(0, stickers.length - missingBefore);

        if (missingBefore === 1) score += 140;
        else if (missingBefore <= 3) score += 82;
        else if (missingBefore <= 5) score += 52;
        else if (missingBefore <= 10) score += 24;

        return {
            score,
            label: missingBefore === 1 ? 'Completa equipo' : missingBefore <= 5 ? 'Alta prioridad' : 'Buen avance',
            detail: missingBefore === 1
                ? `Completa ${team.name}.`
                : `Te deja a ${missingAfter} de completar ${team.name}.`,
            teamName: team.name,
            missingBefore,
            missingAfter,
            completesTeam: missingBefore === 1
        };
    }

    function buildSmartTradeRecommendation({ friendUid, friendEmail, friendDisplayName, friendState = {}, iCanGet, iCanGive }) {
        const proposalSize = Math.min(iCanGet.length, iCanGive.length, 5);
        if (proposalSize <= 0) return null;

        const incoming = iCanGet
            .map(id => ({ id, impact: getStickerTradeImpact(id, window.state) }))
            .sort((a, b) => b.impact.score - a.impact.score || a.id.localeCompare(b.id));
        const outgoing = iCanGive
            .map(id => ({ id, impact: getStickerTradeImpact(id, friendState) }))
            .sort((a, b) => b.impact.score - a.impact.score || a.id.localeCompare(b.id));
        const selectedIncoming = incoming.slice(0, proposalSize);
        const selectedOutgoing = outgoing.slice(0, proposalSize);
        const completeImpact = selectedIncoming.find(item => item.impact.completesTeam);
        const mainImpact = completeImpact || selectedIncoming[0];
        const score = selectedIncoming.reduce((total, item) => total + item.impact.score, 0)
            + selectedOutgoing.reduce((total, item) => total + item.impact.score * 0.35, 0)
            + proposalSize * 12;
        const label = completeImpact
            ? 'Completa equipo'
            : proposalSize >= 3
                ? 'Canje perfecto'
                : mainImpact?.impact.missingBefore <= 5
                    ? 'Alta prioridad'
                    : 'Buen canje';
        const reason = completeImpact
            ? `Con ${completeImpact.id} completas ${completeImpact.impact.teamName}.`
            : mainImpact
                ? `${mainImpact.id} te acerca a ${mainImpact.impact.teamName}; quedarías a ${mainImpact.impact.missingAfter} de completarlo.`
                : `Ganas ${proposalSize} laminas nuevas sin perder progreso.`;

        return {
            label,
            reason,
            score: Math.round(score),
            impactItems: selectedIncoming.slice(0, 3),
            proposal: {
                friendUid,
                friendEmail,
                friendDisplayName: friendDisplayName || friendEmail,
                iCanGet: selectedIncoming.map(item => item.id),
                iCanGive: selectedOutgoing.map(item => item.id),
                reason,
                label
            }
        };
    }

    function getFriendInsights(friendSummaries, allStickers) {
        return friendSummaries.map(friend => {
            const { iCanGet, iCanGive } = getFriendTradeMatches(allStickers, window.state, friend.state || {});
            const progress = Math.round((friend.totalOwned / allStickers.length) * 1000) / 10;
            const recommendation = buildSmartTradeRecommendation({
                friendUid: friend.uid,
                friendEmail: friend.email,
                friendDisplayName: friend.displayName,
                friendState: friend.state || {},
                iCanGet,
                iCanGive
            });

            return {
                ...friend,
                iCanGet,
                iCanGive,
                balancedMatches: Math.min(iCanGet.length, iCanGive.length),
                smartScore: recommendation?.score || 0,
                progress
            };
        });
    }

    function getWantedStickerHighlights(insights) {
        const wanted = new Map();

        insights.forEach(friend => {
            friend.iCanGet.forEach(id => {
                const current = wanted.get(id) || { id, friends: new Set() };
                current.friends.add(getDisplayName(friend));
                wanted.set(id, current);
            });
        });

        return [...wanted.values()]
            .map(item => ({ id: item.id, count: item.friends.size }))
            .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
            .slice(0, 5);
    }

    function getUsefulDuplicateHighlights(allStickers, insights) {
        return allStickers
            .filter(id => (window.state[id] || 0) > 1)
            .map(id => {
                const demand = insights.filter(friend => (friend.state?.[id] || 0) === 0).length;
                return { id, extras: (window.state[id] || 0) - 1, demand };
            })
            .filter(item => item.demand > 0)
            .sort((a, b) => b.demand - a.demand || b.extras - a.extras || a.id.localeCompare(b.id))
            .slice(0, 5);
    }

    function renderTradeInsightRows(items, emptyCopy, renderItem) {
        if (!items.length) {
            return `<div class="trade-empty-line">${escapeHtml(emptyCopy)}</div>`;
        }

        return items.map(renderItem).join('');
    }

    async function renderTradeHomePanel() {
        const panel = document.getElementById('trade-home-panel');
        if (!panel || !currentUser) return;

        const allStickers = window.getAllStickers();
        const stats = getAlbumStats(window.state || {});
        panel.innerHTML = `
            <div class="hub-card">
                <div>
                    <div class="hub-kicker">Canjes</div>
                    <h2>Buscando oportunidades</h2>
                    <p>Revisando repetidas, amigos y solicitudes para recomendarte el mejor movimiento.</p>
                </div>
                <div class="trade-home-loading">Calculando...</div>
            </div>
        `;

        try {
            const [friendSummaries, tradeRequests] = await Promise.all([
                getFriendSummaries(currentUser, allStickers, window.state),
                getUserTradeRequests(currentUser)
            ]);
            const insights = getFriendInsights(friendSummaries, allStickers);
            const bestTrade = insights
                .filter(friend => friend.balancedMatches > 0 || friend.iCanGet.length > 0)
                .sort((a, b) => b.smartScore - a.smartScore || b.balancedMatches - a.balancedMatches || b.iCanGet.length - a.iCanGet.length)[0];
            const activeRequests = tradeRequests.filter(request => request.status !== 'rejected').length;
            const totalCanGet = insights.reduce((total, friend) => total + friend.iCanGet.length, 0);
            const totalFairTrades = insights.reduce((total, friend) => total + friend.balancedMatches, 0);
            homeTradeCandidatesByUid = Object.fromEntries(insights.map(friend => [friend.uid, friend]));

            if (!friendSummaries.length) {
                panel.innerHTML = `
                    <section class="trade-opportunity-card">
                        <div class="trade-opportunity-head">
                            <div>
                                <div class="hub-kicker">Primer canje</div>
                                <h2 class="trade-opportunity-title">Trae tu combo</h2>
                            </div>
                            <div class="smart-trade-badge">${stats.duplicates} repetidas</div>
                        </div>
                        <p class="trade-opportunity-copy">Agrega amigos para comparar álbumes y descubrir quién tiene las láminas que te faltan.</p>
                        <div class="trade-mini-grid">
                            <div class="trade-mini-stat"><strong>${stats.duplicates}</strong><span>Repetidas tuyas</span></div>
                            <div class="trade-mini-stat"><strong>0</strong><span>Amigos cargados</span></div>
                            <div class="trade-mini-stat"><strong>${activeRequests}</strong><span>Solicitudes</span></div>
                        </div>
                        <div class="trade-action-grid">
                            <button class="btn-trade" data-action="open-friends">Invitar amigos</button>
                            <button class="btn-secondary" data-action="open-trade">Canje manual</button>
                            <button class="btn-nearby" data-action="open-nearby">Buscar cerca</button>
                        </div>
                    </section>
                `;
                return;
            }

            if (!bestTrade) {
                panel.innerHTML = `
                    <section class="trade-opportunity-card">
                        <div class="trade-opportunity-head">
                            <div>
                                <div class="hub-kicker">Radar de canjes</div>
                                <h2 class="trade-opportunity-title">Todavía no hay match</h2>
                            </div>
                            <div class="smart-trade-badge">${friendSummaries.length} amigos</div>
                        </div>
                        <p class="trade-opportunity-copy">Ya tienes amigos cargados. Suma más láminas o invita a más gente para que aparezcan canjes compatibles.</p>
                        <div class="trade-mini-grid">
                            <div class="trade-mini-stat"><strong>${stats.duplicates}</strong><span>Repetidas tuyas</span></div>
                            <div class="trade-mini-stat"><strong>${totalCanGet}</strong><span>Te pueden dar</span></div>
                            <div class="trade-mini-stat"><strong>${activeRequests}</strong><span>Solicitudes</span></div>
                        </div>
                        <div class="trade-action-grid">
                            <button class="btn-trade" data-action="open-friends">Ver amigos</button>
                            <button class="btn-secondary" data-action="open-trade">Canje manual</button>
                            <button class="btn-nearby" data-action="open-nearby">Buscar cerca</button>
                        </div>
                    </section>
                `;
                return;
            }

            const recommendation = buildSmartTradeRecommendation({
                friendUid: bestTrade.uid,
                friendEmail: bestTrade.email,
                friendDisplayName: bestTrade.displayName,
                friendState: bestTrade.state || {},
                iCanGet: bestTrade.iCanGet,
                iCanGive: bestTrade.iCanGive
            });
            const title = recommendation ? 'Mejor jugada' : 'Buen candidato';
            const reason = recommendation?.reason || `${getDisplayName(bestTrade)} puede ayudarte con ${bestTrade.iCanGet.length} láminas.`;

            const topHelpers = insights
                .filter(friend => friend.iCanGet.length > 0 || friend.balancedMatches > 0)
                .sort((a, b) => b.smartScore - a.smartScore || b.balancedMatches - a.balancedMatches || b.iCanGet.length - a.iCanGet.length)
                .slice(0, 3);
            const wantedHighlights = getWantedStickerHighlights(insights);
            const usefulDuplicates = getUsefulDuplicateHighlights(allStickers, insights);
            const activeRequestPreview = tradeRequests
                .filter(request => request.status !== 'rejected')
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .slice(0, 3);
            const receivePreview = recommendation?.proposal?.iCanGet || bestTrade.iCanGet.slice(0, 5);
            const givePreview = recommendation?.proposal?.iCanGive || bestTrade.iCanGive.slice(0, 5);

            panel.innerHTML = `
                <section class="trade-opportunity-card">
                    <div class="trade-opportunity-head">
                        <div>
                            <div class="hub-kicker">Canje recomendado</div>
                            <h2 class="trade-opportunity-title">${title}</h2>
                        </div>
                        <div class="smart-trade-badge">${escapeHtml(recommendation?.label || 'Oportunidad')}</div>
                    </div>
                    <p class="trade-opportunity-copy">${escapeHtml(reason)}</p>
                    <div class="trade-mini-grid">
                        <div class="trade-mini-stat"><strong>${escapeHtml(getDisplayName(bestTrade))}</strong><span>Persona</span></div>
                        <div class="trade-mini-stat"><strong>${bestTrade.balancedMatches}</strong><span>Canjes justos</span></div>
                        <div class="trade-mini-stat"><strong>${totalFairTrades}</strong><span>Total del grupo</span></div>
                    </div>
                    <div class="trade-proposal-preview">
                        <div>
                            <div class="request-mini-label">Recibes</div>
                            <div class="match-tags">${renderTradeChips(receivePreview, 'give')}</div>
                        </div>
                        <div>
                            <div class="request-mini-label">Das</div>
                            <div class="match-tags">${renderTradeChips(givePreview, 'take')}</div>
                        </div>
                    </div>
                    <div class="trade-action-grid">
                        <button class="btn-trade" data-action="open-home-best-trade" data-uid="${bestTrade.uid}">Ver propuesta</button>
                        <button class="btn-secondary" data-action="open-friends">Ranking amigos</button>
                        <button class="btn-nearby" data-action="open-nearby">Buscar cerca</button>
                    </div>
                </section>
                <section class="trade-dashboard-grid">
                    <article class="trade-insight-card">
                        <div class="trade-insight-head">
                            <div><div class="hub-kicker">Ranking</div><h3>Personas clave</h3></div>
                            <span>${topHelpers.length}</span>
                        </div>
                        <div class="trade-insight-list">
                            ${renderTradeInsightRows(topHelpers, 'Aun no hay personas con laminas compatibles.', friend => `
                                <button class="trade-person-row" data-action="open-home-best-trade" data-uid="${friend.uid}">
                                    <span><strong>${escapeHtml(getDisplayName(friend))}</strong><small>${friend.iCanGet.length} te sirven - ${friend.iCanGive.length} puedes dar</small></span>
                                    <em>${friend.balancedMatches}</em>
                                </button>
                            `)}
                        </div>
                    </article>
                    <article class="trade-insight-card">
                        <div class="trade-insight-head">
                            <div><div class="hub-kicker">Objetivo</div><h3>Laminas buscadas</h3></div>
                            <span>${wantedHighlights.length}</span>
                        </div>
                        <div class="trade-code-list">
                            ${renderTradeInsightRows(wantedHighlights, 'Cuando tus amigos tengan repetidas que te falten, apareceran aqui.', item => `
                                <div class="trade-code-row"><strong>${escapeHtml(item.id)}</strong><small>${item.count} amigo${item.count === 1 ? '' : 's'}</small></div>
                            `)}
                        </div>
                    </article>
                    <article class="trade-insight-card">
                        <div class="trade-insight-head">
                            <div><div class="hub-kicker">Tus cartas</div><h3>Repetidas utiles</h3></div>
                            <span>${usefulDuplicates.length}</span>
                        </div>
                        <div class="trade-code-list">
                            ${renderTradeInsightRows(usefulDuplicates, 'Tus repetidas apareceran aqui cuando le falten a alguien.', item => `
                                <div class="trade-code-row"><strong>${escapeHtml(item.id)}</strong><small>${item.extras} extra - le falta a ${item.demand}</small></div>
                            `)}
                        </div>
                    </article>
                    <article class="trade-insight-card">
                        <div class="trade-insight-head">
                            <div><div class="hub-kicker">Estado</div><h3>Solicitudes</h3></div>
                            <span>${activeRequests}</span>
                        </div>
                        <div class="trade-insight-list">
                            ${renderTradeInsightRows(activeRequestPreview, 'No tienes solicitudes activas por ahora.', request => `
                                <div class="trade-request-row">
                                    <span><strong>${escapeHtml(getRequestStatusLabel(request.status))}</strong><small>${escapeHtml(getRequestSummary(request))}</small></span>
                                </div>
                            `)}
                        </div>
                    </article>
                </section>
            `;
        } catch (e) {
            panel.innerHTML = `
                <section class="trade-opportunity-card">
                    <div class="trade-opportunity-head">
                        <div>
                            <div class="hub-kicker">Canjes</div>
                            <h2 class="trade-opportunity-title">Modo rápido</h2>
                        </div>
                        <div class="smart-trade-badge">${stats.duplicates} repetidas</div>
                    </div>
                    <p class="trade-opportunity-copy">No se pudieron cargar los amigos ahora mismo. Puedes seguir con canje manual o revisar cercanos.</p>
                    <div class="trade-action-grid">
                        <button class="btn-trade" data-action="open-trade">Intercambio rápido</button>
                        <button class="btn-secondary" data-action="open-friends">Amigos</button>
                        <button class="btn-nearby" data-action="open-nearby">Canjes cerca</button>
                    </div>
                </section>
            `;
        }
    }

    window.openHomeBestTrade = function(uid) {
        const friend = homeTradeCandidatesByUid[uid];
        if (!friend) return window.openFriends();
        window.viewFriendTrades(friend.uid, friend.email, friend.state || {}, friend.displayName);
    };

    function renderFriendGroupSummary({ activeGroupName, insights, ranking, allStickers }) {
        const summaryEl = document.getElementById('friends-group-summary');
        if (!summaryEl) return;

        if (insights.length === 0) {
            summaryEl.innerHTML = '';
            return;
        }

        const bestFriend = insights.slice().sort((a, b) => b.totalOwned - a.totalOwned)[0];
        const bestTrade = insights.slice().sort((a, b) => b.smartScore - a.smartScore || b.balancedMatches - a.balancedMatches || b.iCanGet.length - a.iCanGet.length)[0];
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

    function getRequestSides(request) {
        const incoming = request.toUid === currentUser?.uid;
        const proposal = request.proposal || {};

        return {
            incoming,
            iGive: incoming ? (proposal.iCanGet || []) : (proposal.iCanGive || []),
            iReceive: incoming ? (proposal.iCanGive || []) : (proposal.iCanGet || [])
        };
    }

    function renderTradeChips(items, cssClass = '') {
        if (!items || items.length === 0) return '<span class="trade-chip muted">Sin laminas</span>';
        return items.map(id => `<span class="trade-chip ${cssClass}">${escapeHtml(id)}</span>`).join('');
    }

    function getRequestStatusLabel(status) {
        return {
            pending: 'Pendiente',
            accepted: 'Aceptada',
            rejected: 'Rechazada'
        }[status] || 'Pendiente';
    }

    function renderTradeContext(request) {
        const { iGive, iReceive } = getRequestSides(request);

        return `
            <div class="trade-context-head">
                <div>
                    <div class="insight-kicker">Canje acordado</div>
                    <div class="trade-context-title">${Math.min(iGive.length, iReceive.length)} x ${Math.min(iGive.length, iReceive.length)}</div>
                </div>
                <div class="request-status ${request.status}">${escapeHtml(getRequestStatusLabel(request.status))}</div>
            </div>
            <div class="trade-context-grid">
                <div>
                    <div class="match-section-title">Tu das</div>
                    <div class="match-tags">${renderTradeChips(iGive, 'take')}</div>
                </div>
                <div>
                    <div class="match-section-title">Tu recibes</div>
                    <div class="match-tags">${renderTradeChips(iReceive, 'give')}</div>
                </div>
            </div>
        `;
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
                <div class="request-board-head">
                    <div>
                        <div class="insight-kicker">Solicitudes de canje</div>
                        <div class="request-board-title">${relevant.length} activas</div>
                    </div>
                    <div class="request-board-tabs">
                        <span>${relevant.filter(item => item.status === 'pending').length} pendientes</span>
                        <span>${relevant.filter(item => item.status === 'accepted').length} aceptadas</span>
                    </div>
                </div>
                ${relevant.map(request => {
                    const incoming = request.toUid === currentUser.uid;
                    const otherName = incoming
                        ? (request.fromDisplayName || request.fromEmail)
                        : (request.toDisplayName || request.toEmail);
                    const title = incoming ? `${otherName} quiere canjear` : `Solicitud para ${otherName}`;
                    const status = getRequestStatusLabel(request.status);
                    const { iGive, iReceive } = getRequestSides(request);
                    const actions = request.status === 'accepted'
                        ? `<button class="btn-trade" data-action="open-chat" data-request-id="${request.id}">Abrir chat</button>`
                        : incoming
                            ? `<button class="btn-trade" data-action="accept-trade-request" data-request-id="${request.id}">Aceptar</button><button class="btn-secondary" data-action="reject-trade-request" data-request-id="${request.id}">Rechazar</button>`
                            : `<button class="btn-secondary" data-action="open-chat" data-request-id="${request.id}">Ver solicitud</button>`;

                    return `
                        <div class="request-card ${request.status}">
                            <div class="request-card-head">
                                <div>
                                    <div class="request-title">${escapeHtml(title)}</div>
                                    <div class="request-copy">${escapeHtml(status)}. ${escapeHtml(getRequestSummary(request))}</div>
                                </div>
                                <div class="request-status ${request.status}">${escapeHtml(status)}</div>
                            </div>
                            <div class="request-trade-grid">
                                <div><div class="request-mini-label">Tu das</div><div class="match-tags">${renderTradeChips(iGive, 'take')}</div></div>
                                <div><div class="request-mini-label">Tu recibes</div><div class="match-tags">${renderTradeChips(iReceive, 'give')}</div></div>
                            </div>
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
            markSocialStarted();
            activeFriendGroupId = group.id;
            input.value = '';
            pushNotification({
                title: 'Grupo creado',
                message: `Ya puedes agregar amigos al grupo ${group.name} y comparar el ranking.`,
                type: 'group',
                action: 'friends'
            });
            trackActivity('group', 'Grupo creado', `Creaste el grupo ${group.name}.`);
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
            markSocialStarted();
            activeFriendGroupId = selectedGroupId;
            pushNotification({
                title: 'Amigo agregado',
                message: selectedGroupId === 'all'
                    ? `${result.email} ya aparece en tus amigos.`
                    : `${result.email} fue agregado al grupo seleccionado.`,
                type: 'friend',
                action: 'friends'
            });
            trackActivity('friend', 'Amigo agregado', `${result.email} ya puede comparar progreso y canjes contigo.`);
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
            const recommendation = buildSmartTradeRecommendation({
                friendUid: fUid,
                friendEmail: fEmail,
                friendDisplayName: fDisplayName || fEmail,
                friendState: fState || {},
                iCanGet,
                iCanGive
            });
            window.smartProposalContext = recommendation?.proposal || null;

            html += recommendation ? `
                <section class="smart-trade-card">
                    <div class="smart-trade-head">
                        <div>
                            <div class="insight-kicker">Canje inteligente</div>
                            <h3>Mejor propuesta</h3>
                        </div>
                        <div class="smart-trade-badge">${escapeHtml(recommendation.label)}</div>
                    </div>
                    <p>${escapeHtml(recommendation.reason)}</p>
                    <div class="smart-trade-score">
                        <span>${recommendation.proposal.iCanGet.length} x ${recommendation.proposal.iCanGive.length}</span>
                        <small>${recommendation.score} pts de impacto</small>
                    </div>
                    <div class="request-trade-grid smart-trade-grid">
                        <div>
                            <div class="request-mini-label">Recibes</div>
                            <div class="match-tags">${renderTradeChips(recommendation.proposal.iCanGet, 'give')}</div>
                        </div>
                        <div>
                            <div class="request-mini-label">Das</div>
                            <div class="match-tags">${renderTradeChips(recommendation.proposal.iCanGive, 'take')}</div>
                        </div>
                    </div>
                    <div class="smart-impact-list">
                        ${recommendation.impactItems.map(item => `
                            <div>
                                <strong>${escapeHtml(item.id)}</strong>
                                <span>${escapeHtml(item.impact.detail)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="smart-proposal">
                        <button class="btn-trade" data-action="send-trade-request">Enviar solicitud interna</button>
                        <button class="btn-secondary" data-action="smart-proposal">Enviar por WhatsApp</button>
                    </div>
                </section>
            ` : `
                <div class="friend-msg-box">Hay coincidencias, pero todavía no hay un canje equilibrado: uno de los dos no tiene repetidas útiles para ofrecer.</div>
            `;

            if (iCanGet.length > 0) {
                html += `<div class="match-give"><div class="match-section-title">Te pueden dar (${iCanGet.length})</div><div class="match-tags">${iCanGet.map(id => `<div class="match-tag give">${escapeHtml(id)}</div>`).join('')}</div></div>`;
            }
            if (iCanGive.length > 0) {
                html += `<div class="match-take"><div class="match-section-title">Tú puedes dar (${iCanGive.length})</div><div class="match-tags">${iCanGive.map(id => `<div class="match-tag take">${escapeHtml(id)}</div>`).join('')}</div></div>`;
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

        const intro = proposal.reason ? `La app me recomienda este canje porque: ${proposal.reason}\n\n` : '';
        const msg = `Hola! Te propongo este canje del álbum Mundial 2026:\n\n${intro}Yo te doy: ${proposal.iCanGive.join(', ')}\n\nTú me das: ${proposal.iCanGet.join(', ')}\n\n¿Te sirve?`;
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
            trackActivity('trade', 'Solicitud enviada', `Propusiste un canje a ${proposal.friendDisplayName || proposal.friendEmail}.`);
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
            trackActivity('trade', 'Solicitud cercana enviada', `Propusiste un canje a ${getDisplayName(candidate)}.`);
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
            trackActivity('trade', status === 'accepted' ? 'Canje aceptado' : 'Canje rechazado', status === 'accepted' ? 'Aceptaste una solicitud y se abrió el chat.' : 'Rechazaste una solicitud de canje.');
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
        document.getElementById('chat-context').innerHTML = renderTradeContext(request);
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

    window.sendQuickChatMessage = async function(message) {
        if (!currentChat || !currentUser || !message) return;

        await sendChatMessage({
            chatId: currentChat.chatId,
            currentUser,
            currentProfile,
            text: message
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

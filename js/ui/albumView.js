import { getSummaryLists, getTeamStickers } from "../services/albumService.js";

let activeTeamFilter = 'all';

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getStickerStatus(id, state) {
    const count = state[id] || 0;
    if (count > 1) return 'duplicate';
    if (count === 1) return 'got';
    return 'missing';
}

function getStickerStatusLabel(status) {
    const labels = {
        missing: 'Falta',
        got: 'Lista',
        duplicate: 'Canje'
    };

    return labels[status] || 'Falta';
}

function updateTeamProgressPanel(stickers, state) {
    const owned = stickers.filter(id => (state[id] || 0) > 0).length;
    const duplicates = stickers.reduce((total, id) => total + Math.max((state[id] || 0) - 1, 0), 0);
    const missing = stickers.length - owned;
    const percentage = stickers.length ? Math.round((owned / stickers.length) * 100) : 0;
    const nextSticker = stickers.find(id => (state[id] || 0) === 0) || 'Completo';

    document.getElementById('team-owned-count').innerText = owned;
    document.getElementById('team-total-count').innerText = stickers.length;
    document.getElementById('team-progress-percent').innerText = `${percentage}%`;
    document.getElementById('team-progress-bar').style.width = `${percentage}%`;
    document.getElementById('team-missing-count').innerText = missing;
    document.getElementById('team-duplicate-count').innerText = duplicates;
    document.getElementById('team-next-sticker').innerText = nextSticker;
}

function bindTeamFilters(render) {
    document.querySelectorAll('[data-team-filter]').forEach(button => {
        button.classList.toggle('active', button.dataset.teamFilter === activeTeamFilter);
        button.onclick = () => {
            activeTeamFilter = button.dataset.teamFilter || 'all';
            render();
        };
    });
}

export function toggleGroup(groupId) {
    document.querySelectorAll('.group-card').forEach(card => {
        if (card.id === groupId) card.classList.toggle('open');
        else card.classList.remove('open');
    });
}

export function filterTeams() {
    const query = document.getElementById('team-search').value.toLowerCase().trim();
    const cards = document.querySelectorAll('.group-card');

    cards.forEach(card => {
        const text = card.innerText.toLowerCase();

        if (text.includes(query)) {
            card.style.display = 'block';

            if (query.length > 2 && text.includes(query) && !"grupo".includes(query)) {
                card.classList.add('open');
            }
        } else {
            card.style.display = 'none';
            card.classList.remove('open');
        }
    });

    if (!query) {
        cards.forEach(card => {
            card.style.display = 'block';
            card.classList.remove('open');
        });
    }
}

function getTeamProgress(albumDatabase, team, state, isSpecial = false) {
    const stickers = getTeamStickers(albumDatabase, team.code, isSpecial);
    const owned = stickers.filter(id => (state[id] || 0) > 0).length;
    const duplicates = stickers.reduce((total, id) => total + Math.max((state[id] || 0) - 1, 0), 0);
    const missing = stickers.length - owned;
    const percentage = stickers.length ? Math.round((owned / stickers.length) * 100) : 0;

    return { total: stickers.length, owned, missing, duplicates, percentage };
}

function getTeamStatus(progress) {
    if (progress.missing === 0 && progress.total > 0) return { key: 'complete', label: 'Completo' };
    if (progress.percentage >= 70) return { key: 'almost', label: 'Casi' };
    if (progress.duplicates > 0) return { key: 'trades', label: 'Canjes' };
    if (progress.owned > 0) return { key: 'started', label: 'En marcha' };
    return { key: 'empty', label: 'Sin empezar' };
}

function getGroupProgress(albumDatabase, group, state) {
    const teams = group.teams.map(team => ({
        team,
        progress: getTeamProgress(albumDatabase, team, state)
    }));
    const total = teams.reduce((sum, item) => sum + item.progress.total, 0);
    const owned = teams.reduce((sum, item) => sum + item.progress.owned, 0);
    const duplicates = teams.reduce((sum, item) => sum + item.progress.duplicates, 0);
    const completedTeams = teams.filter(item => item.progress.missing === 0 && item.progress.total > 0).length;
    const startedTeams = teams.filter(item => item.progress.owned > 0).length;
    const percentage = total ? Math.round((owned / total) * 100) : 0;

    return { total, owned, duplicates, completedTeams, startedTeams, percentage };
}

function getPriorityTeams(albumDatabase, state) {
    return albumDatabase.groups
        .flatMap(group => group.teams.map(team => ({
            ...team,
            groupName: group.name,
            progress: getTeamProgress(albumDatabase, team, state)
        })))
        .filter(item => item.progress.owned > 0 && item.progress.missing > 0)
        .sort((a, b) => {
            if (b.progress.percentage !== a.progress.percentage) return b.progress.percentage - a.progress.percentage;
            return a.progress.missing - b.progress.missing;
        })
        .slice(0, 3);
}

function renderPriorityPanel(albumDatabase, state) {
    const priorities = getPriorityTeams(albumDatabase, state);

    if (priorities.length === 0) {
        return `
            <section class="album-priority-panel">
                <div>
                    <div class="album-priority-kicker">Siguiente jugada</div>
                    <h2>Elige un equipo para arrancar</h2>
                    <p>Cuando empieces a sumar laminas, aqui apareceran los equipos que estas mas cerca de completar.</p>
                </div>
            </section>
        `;
    }

    return `
        <section class="album-priority-panel">
            <div>
                <div class="album-priority-kicker">Siguiente jugada</div>
                <h2>Equipos para cerrar pronto</h2>
                <p>Estos son los equipos donde cada lamina nueva se siente como gol de ultimo minuto.</p>
            </div>
            <div class="album-priority-list">
                ${priorities.map(item => `
                    <button class="album-priority-item" data-action="open-team" data-team-code="${escapeHtml(item.code)}" data-team-name="${escapeHtml(item.name)}">
                        <span>
                            <strong>${escapeHtml(item.name)}</strong>
                            <small>${escapeHtml(item.groupName)} - faltan ${item.progress.missing}</small>
                        </span>
                        <em>${item.progress.percentage}%</em>
                    </button>
                `).join('')}
            </div>
        </section>
    `;
}

function renderTeamButton(albumDatabase, team, state) {
    const progress = getTeamProgress(albumDatabase, team, state);
    const status = getTeamStatus(progress);
    const duplicateCopy = progress.duplicates ? ` - ${progress.duplicates} canjes` : '';

    return `
        <button class="team-btn team-status-${status.key}" data-action="open-team" data-team-code="${escapeHtml(team.code)}" data-team-name="${escapeHtml(team.name)}">
            <span class="team-btn-top">
                <span class="team-code">${escapeHtml(team.code)}</span>
                <span class="team-status-pill">${status.label}</span>
            </span>
            <span class="team-name">${escapeHtml(team.name)}</span>
            <span class="team-progress-mini"><span style="width:${progress.percentage}%"></span></span>
            <span class="team-btn-meta">${progress.owned}/${progress.total} laminas${duplicateCopy}</span>
        </button>
    `;
}

export function createStickerEl(id, state, updateSticker) {
    const el = document.createElement('div');
    el.className = 'sticker';

    const count = state[id] || 0;
    const status = getStickerStatus(id, state);
    el.dataset.status = status;

    if (count === 1) el.classList.add('status-1');
    else if (count > 1) el.classList.add('status-2');

    const codeSpan = document.createElement('div');
    codeSpan.className = 'sticker-code';

    const parts = id.split(' ');
    if (parts.length > 1) codeSpan.innerHTML = `${parts[0]}<br>${parts[1]}`;
    else codeSpan.innerText = id;

    el.appendChild(codeSpan);

    const statusLabel = document.createElement('div');
    statusLabel.className = 'sticker-status-label';
    statusLabel.innerText = getStickerStatusLabel(status);
    el.appendChild(statusLabel);

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
        minusBtn.addEventListener('click', event => {
            event.stopPropagation();
            updateSticker(id, -1);
        });
        el.appendChild(minusBtn);
    }

    el.addEventListener('click', () => updateSticker(id, 1));

    return el;
}

export function openTeamView({ albumDatabase, teamCode, teamName, isSpecial = false, state, updateSticker, switchView }) {
    document.getElementById('team-title').innerText = teamName;

    const stickers = getTeamStickers(albumDatabase, teamCode, isSpecial);
    const grid = document.getElementById('sticker-grid');

    updateTeamProgressPanel(stickers, state);

    const renderGrid = () => {
        const visibleStickers = activeTeamFilter === 'all'
            ? stickers
            : stickers.filter(id => getStickerStatus(id, state) === activeTeamFilter);

        grid.innerHTML = '';

        if (visibleStickers.length === 0) {
            grid.innerHTML = '<div class="team-empty-state">No hay laminas en esta categoria.</div>';
            return;
        }

        visibleStickers.forEach(id => {
            grid.appendChild(createStickerEl(id, state, updateSticker));
        });
    };

    bindTeamFilters(renderGrid);
    renderGrid();

    switchView('view-team');
}

export function openSummaryView({ allStickers, state, switchView }) {
    const { missing, got, duplicates } = getSummaryLists(allStickers, state);

    document.getElementById('count-missing').innerText = missing.length;
    document.getElementById('count-got').innerText = got.length;
    document.getElementById('count-dup').innerText = duplicates.length;

    populateSummaryList('content-missing', missing, '');
    populateSummaryList('content-got', got, 'got');
    populateSummaryList('content-dup', duplicates, 'dup');

    switchView('view-summary');
}

export function switchSummaryTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.summary-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
    document.getElementById(`content-${tabId}`).classList.add('active');
}

export function renderGroupList(albumDatabase, state = {}) {
    const list = document.getElementById('group-list');
    const openedGroups = [...document.querySelectorAll('.group-card.open')].map(card => card.id);
    list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', renderPriorityPanel(albumDatabase, state));

    const specialProgress = getTeamProgress(albumDatabase, { code: 'FWC', name: 'Seccion Especial' }, state, true);
    const specialStatus = getTeamStatus(specialProgress);
    const specialCard = document.createElement('div');
    specialCard.className = `group-card special-group team-status-${specialStatus.key}`;
    specialCard.id = 'group-especiales';
    specialCard.innerHTML = `<div class="group-header" data-action="open-team" data-team-code="FWC" data-team-name="Sección Especial" data-team-special="true">
        <div class="group-meta">
            <div>Sección Especial</div>
            <div class="group-acronyms">Lámina 00, FWC 1 - FWC 19</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(-90deg);"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;
    specialCard.innerHTML = `<div class="group-header" data-action="open-team" data-team-code="FWC" data-team-name="Seccion Especial" data-team-special="true">
        <div class="group-meta">
            <div class="group-title-row"><span>Seccion Especial</span><span class="team-status-pill">${specialStatus.label}</span></div>
            <div class="group-acronyms">${specialProgress.owned}/${specialProgress.total} laminas - FWC 1 a FWC 19</div>
            <div class="group-progress-track"><span style="width:${specialProgress.percentage}%"></span></div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(-90deg);"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;
    list.appendChild(specialCard);

    albumDatabase.groups.forEach((group, index) => {
        const card = document.createElement('div');
        const cardId = `group-${index}`;
        const acronyms = group.teams.map(team => team.code).join(', ');
        const progress = getGroupProgress(albumDatabase, group, state);

        card.className = 'group-card';
        card.id = cardId;
        card.innerHTML = `
            <div class="group-header" data-action="toggle-group" data-group-id="${cardId}">
                <div class="group-meta">
                    <div class="group-title-row"><span>${escapeHtml(group.name)}</span><span class="group-progress-pill">${progress.percentage}%</span></div>
                    <div class="group-acronyms">${progress.completedTeams}/4 completos - ${progress.startedTeams}/4 empezados - ${escapeHtml(acronyms)}</div>
                    <div class="group-progress-track"><span style="width:${progress.percentage}%"></span></div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="group-content">
                <div class="teams-grid">
                    ${group.teams.map(team => renderTeamButton(albumDatabase, team, state)).join('')}
                </div>
            </div>
        `;
        list.appendChild(card);
    });

    openedGroups.forEach(id => document.getElementById(id)?.classList.add('open'));
}

function populateSummaryList(elementId, items, cssClass) {
    const el = document.getElementById(elementId);

    if (items.length === 0) {
        el.innerHTML = '<div class="empty-state">No hay láminas en esta lista.</div>';
        return;
    }

    el.innerHTML = items.map(item => `<div class="code-tag ${cssClass}">${item}</div>`).join('');
}

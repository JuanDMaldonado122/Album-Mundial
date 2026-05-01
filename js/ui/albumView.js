import { getSummaryLists, getTeamStickers } from "../services/albumService.js";

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

export function createStickerEl(id, state, updateSticker) {
    const el = document.createElement('div');
    el.className = 'sticker';

    const count = state[id] || 0;

    if (count === 1) el.classList.add('status-1');
    else if (count > 1) el.classList.add('status-2');

    const codeSpan = document.createElement('div');
    codeSpan.className = 'sticker-code';

    const parts = id.split(' ');
    if (parts.length > 1) codeSpan.innerHTML = `${parts[0]}<br>${parts[1]}`;
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
    grid.innerHTML = '';

    stickers.forEach(id => {
        grid.appendChild(createStickerEl(id, state, updateSticker));
    });

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

export function renderGroupList(albumDatabase) {
    const list = document.getElementById('group-list');
    list.innerHTML = '';

    const specialCard = document.createElement('div');
    specialCard.className = 'group-card';
    specialCard.id = 'group-especiales';
    specialCard.innerHTML = `<div class="group-header" data-action="open-team" data-team-code="FWC" data-team-name="Sección Especial" data-team-special="true">
        <div class="group-meta">
            <div>Sección Especial</div>
            <div class="group-acronyms">Lámina 00, FWC 1 - FWC 19</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(-90deg);"><path d="M6 9l6 6 6-6"/></svg>
    </div>`;
    list.appendChild(specialCard);

    albumDatabase.groups.forEach((group, index) => {
        const card = document.createElement('div');
        const cardId = `group-${index}`;
        const acronyms = group.teams.map(team => team.code).join(', ');

        card.className = 'group-card';
        card.id = cardId;
        card.innerHTML = `
            <div class="group-header" data-action="toggle-group" data-group-id="${cardId}">
                <div class="group-meta">
                    <div>${group.name}</div>
                    <div class="group-acronyms">${acronyms}</div>
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <div class="group-content">
                <div class="teams-grid">
                    ${group.teams.map(team => `<button class="team-btn" data-action="open-team" data-team-code="${team.code}" data-team-name="${team.name}"><span class="team-code">${team.code}</span><span>${team.name}</span></button>`).join('')}
                </div>
            </div>
        `;
        list.appendChild(card);
    });
}

function populateSummaryList(elementId, items, cssClass) {
    const el = document.getElementById(elementId);

    if (items.length === 0) {
        el.innerHTML = '<div class="empty-state">No hay láminas en esta lista.</div>';
        return;
    }

    el.innerHTML = items.map(item => `<div class="code-tag ${cssClass}">${item}</div>`).join('');
}

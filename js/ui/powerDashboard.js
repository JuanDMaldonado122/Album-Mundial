import { getAlbumStats } from "../services/albumService.js";
import { formatActivityTime } from "../services/activityService.js";

export function getTeamProgress(albumDatabase, state) {
    const teams = [];

    albumDatabase.groups.forEach(group => {
        group.teams.forEach(team => {
            let owned = 0;
            for (let i = 1; i <= 20; i++) {
                if ((state[`${team.code} ${i}`] || 0) > 0) owned++;
            }
            teams.push({ ...team, owned, total: 20, pct: Math.round((owned / 20) * 100) });
        });
    });

    return teams.sort((a, b) => b.pct - a.pct);
}

export function renderHomeDashboard({ container, albumDatabase, state, activity }) {
    if (!container) return;

    const stats = getAlbumStats(state);
    const topTeam = getTeamProgress(albumDatabase, state)[0];
    const recent = activity[0];

    container.innerHTML = `
        <div class="insight-card">
            <div class="insight-kicker">Panel vivo</div>
            <div class="insight-title">${stats.percentage}% completado</div>
            <div class="insight-copy">${topTeam ? `${topTeam.name} es tu selección más avanzada con ${topTeam.owned}/${topTeam.total}.` : 'Empieza marcando tus primeras láminas.'}</div>
        </div>
        <div class="insight-card">
            <div class="insight-kicker">Ultimo movimiento</div>
            <div class="insight-title">${recent ? recent.message : 'Sin actividad todavía'}</div>
            <div class="insight-copy">${recent ? formatActivityTime(recent.at) : 'Agrega láminas o paquetes para llenar este historial.'}</div>
        </div>
    `;
}

export function renderPowerDashboard({ container, albumDatabase, state, activity, friendSummaries = [] }) {
    const stats = getAlbumStats(state);
    const teamProgress = getTeamProgress(albumDatabase, state).slice(0, 5);
    const ranking = [
        { email: 'Tu álbum', totalOwned: stats.unique, self: true },
        ...friendSummaries
    ].sort((a, b) => b.totalOwned - a.totalOwned);

    container.innerHTML = `
        <div class="insight-card">
            <div class="insight-kicker">Dashboard</div>
            <div class="insight-title">${stats.unique}/${stats.total} láminas Únicas</div>
            <div class="insight-copy">${stats.duplicates} repetidas disponibles para mover canjes.</div>
        </div>
        <div class="insight-card">
            <div class="insight-kicker">Selecciones mas completas</div>
            <div class="ranking-list">
                ${teamProgress.map(team => `<div class="ranking-row"><span class="ranking-name">${team.name}</span><span class="ranking-score">${team.owned}/20</span></div>`).join('')}
            </div>
        </div>
        <div class="insight-card">
            <div class="insight-kicker">Ranking del grupo</div>
            <div class="ranking-list">
                ${ranking.map((item, index) => `<div class="ranking-row"><span class="ranking-name">${index + 1}. ${item.email}</span><span class="ranking-score">${item.totalOwned}</span></div>`).join('')}
            </div>
        </div>
        <div class="insight-card">
            <div class="insight-kicker">Actividad reciente</div>
            <div class="activity-list">
                ${(activity.length ? activity.slice(0, 8) : [{ message: 'Sin actividad todavía', at: new Date().toISOString() }]).map(item => `<div class="activity-row"><span class="activity-main">${item.message}</span><span class="activity-time">${formatActivityTime(item.at)}</span></div>`).join('')}
            </div>
        </div>
    `;
}

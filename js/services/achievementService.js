import { getAlbumStats, getTeamStickers } from "./albumService.js";

export function getTeamCatalog(albumDatabase) {
    return [
        { code: 'FWC', name: 'Seccion Especial', isSpecial: true },
        ...albumDatabase.groups.flatMap(group => group.teams.map(team => ({
            code: team.code,
            name: team.name,
            isSpecial: false,
            groupName: group.name
        })))
    ];
}

export function getTeamForSticker(albumDatabase, stickerId) {
    if (stickerId === '00' || stickerId.startsWith('FWC ')) {
        return { code: 'FWC', name: 'Seccion Especial', isSpecial: true };
    }

    const code = stickerId.split(' ')[0];
    return getTeamCatalog(albumDatabase).find(team => team.code === code && !team.isSpecial) || null;
}

export function getTeamProgress(albumDatabase, state, team) {
    const stickers = getTeamStickers(albumDatabase, team.code, team.isSpecial);
    const owned = stickers.filter(id => (state[id] || 0) > 0).length;

    return {
        ...team,
        owned,
        total: stickers.length,
        percentage: Math.round((owned / stickers.length) * 100)
    };
}

export function isTeamComplete(albumDatabase, state, team) {
    if (!team) return false;
    const progress = getTeamProgress(albumDatabase, state, team);
    return progress.owned === progress.total;
}

export function getAchievementDashboard(albumDatabase, state) {
    const stats = getAlbumStats(state);
    const teams = getTeamCatalog(albumDatabase).map(team => getTeamProgress(albumDatabase, state, team));
    const completedTeams = teams.filter(team => team.owned === team.total);
    const special = teams.find(team => team.isSpecial);

    const achievements = [
        {
            id: 'first-sticker',
            title: 'Primer fichaje',
            detail: 'Suma tu primera lamina al album.',
            progress: Math.min(stats.unique, 1),
            target: 1
        },
        {
            id: 'ten-stickers',
            title: 'Arranque mundialista',
            detail: 'Llega a 10 laminas unicas.',
            progress: Math.min(stats.unique, 10),
            target: 10
        },
        {
            id: 'first-duplicate',
            title: 'Material de canje',
            detail: 'Consigue tu primera repetida.',
            progress: Math.min(stats.duplicates, 1),
            target: 1
        },
        {
            id: 'first-team',
            title: 'Equipo completo',
            detail: 'Completa tu primer equipo.',
            progress: Math.min(completedTeams.length, 1),
            target: 1
        },
        {
            id: 'five-teams',
            title: 'Dominio de grupos',
            detail: 'Completa 5 equipos.',
            progress: Math.min(completedTeams.length, 5),
            target: 5
        },
        {
            id: 'special-hunter',
            title: 'Cazador especial',
            detail: 'Consigue 10 laminas de la seccion especial.',
            progress: Math.min(special?.owned || 0, 10),
            target: 10
        },
        {
            id: 'quarter-album',
            title: 'Album al 25%',
            detail: 'Llega a 245 laminas unicas.',
            progress: Math.min(stats.unique, 245),
            target: 245
        }
    ].map(item => ({
        ...item,
        completed: item.progress >= item.target,
        percentage: Math.round((item.progress / item.target) * 100)
    }));

    const activeMissions = achievements
        .filter(item => !item.completed)
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 3);

    const nextTeams = teams
        .filter(team => team.owned > 0 && team.owned < team.total)
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 2);

    return {
        achievements,
        completedCount: achievements.filter(item => item.completed).length,
        totalCount: achievements.length,
        completedTeams,
        activeMissions,
        nextTeams
    };
}

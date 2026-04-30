export const MAX_TOTAL_STICKERS = 980;

export function getAllStickers(albumDatabase) {
    const all = [...albumDatabase.especial];

    albumDatabase.groups.forEach(group => {
        group.teams.forEach(team => {
            for (let i = 1; i <= 20; i++) {
                all.push(`${team.code} ${i}`);
            }
        });
    });

    return all;
}

export function getTeamStickers(albumDatabase, teamCode, isSpecial = false) {
    return isSpecial
        ? albumDatabase.especial
        : Array.from({ length: 20 }, (_, i) => `${teamCode} ${i + 1}`);
}

export function getAlbumStats(state, total = MAX_TOTAL_STICKERS) {
    let unique = 0;
    let duplicates = 0;

    for (const key in state) {
        if (state[key] > 0) unique++;
        if (state[key] > 1) duplicates += state[key] - 1;
    }

    return {
        unique,
        duplicates,
        total,
        percentage: ((unique / total) * 100).toFixed(1)
    };
}

export function getSummaryLists(allStickers, state) {
    const missing = [];
    const got = [];
    const duplicates = [];

    allStickers.forEach(id => {
        const count = state[id] || 0;

        if (count === 0) missing.push(id);
        else if (count === 1) got.push(id);
        else duplicates.push(`${id} (+${count - 1})`);
    });

    return { missing, got, duplicates };
}

export function getDuplicateStickerIds(allStickers, state) {
    return allStickers.filter(id => (state[id] || 0) > 1);
}

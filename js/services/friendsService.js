import { get, ref, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from "./firebaseService.js";

function toEmailKey(email) {
    return email.replace(/\./g, ',');
}

export function registerUserForFriendLookup(user) {
    const emailKey = toEmailKey(user.email);

    return Promise.all([
        set(ref(db, `emailIndex/${emailKey}`), user.uid),
        set(ref(db, `profiles/${user.uid}/email`), user.email)
    ]);
}

export async function getUserProfile(uid) {
    const snap = await get(ref(db, `profiles/${uid}`));
    return snap.exists() ? snap.val() : {};
}

export function saveUserProfile(user, profile) {
    return set(ref(db, `profiles/${user.uid}`), {
        email: user.email,
        displayName: profile.displayName.trim(),
        updatedAt: Date.now()
    });
}

export async function addFriendByEmail(currentUser, email) {
    const normalizedEmail = email.trim().toLowerCase();
    const emailKey = toEmailKey(normalizedEmail);
    const snap = await get(ref(db, `emailIndex/${emailKey}`));

    if (!snap.exists()) {
        return { ok: false, reason: 'not-found' };
    }

    const friendUid = snap.val();

    if (friendUid === currentUser.uid) {
        return { ok: false, reason: 'self' };
    }

    await set(ref(db, `users/${currentUser.uid}/friends/${friendUid}`), normalizedEmail);

    return { ok: true, friendUid, email: normalizedEmail };
}

export async function createFriendGroup(currentUser, name) {
    const cleanName = name.trim();
    const groupId = cleanName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32) || 'grupo';
    const uniqueId = `${groupId}-${Date.now()}`;

    await set(ref(db, `users/${currentUser.uid}/friendGroups/${uniqueId}`), {
        name: cleanName,
        createdAt: Date.now(),
        members: {}
    });

    return { id: uniqueId, name: cleanName, members: {} };
}

export async function getFriendGroups(currentUser) {
    const snap = await get(ref(db, `users/${currentUser.uid}/friendGroups`));

    if (!snap.exists()) return [];

    return Object.entries(snap.val()).map(([id, group]) => ({
        id,
        name: group.name || 'Grupo',
        members: group.members || {},
        createdAt: group.createdAt || 0
    })).sort((a, b) => a.createdAt - b.createdAt);
}

export function addFriendToGroup(currentUser, groupId, friendUid, email) {
    if (!groupId || groupId === 'all') return Promise.resolve();

    return set(ref(db, `users/${currentUser.uid}/friendGroups/${groupId}/members/${friendUid}`), email);
}

export async function getFriendSummaries(currentUser, allStickers, myState) {
    const snap = await get(ref(db, `users/${currentUser.uid}/friends`));

    if (!snap.exists()) {
        return [];
    }

    const myMissing = new Set(allStickers.filter(id => (myState[id] || 0) === 0));
    const summaries = [];

    for (const [uid, email] of Object.entries(snap.val())) {
        let state = {};

        try {
            const friendAlbumSnap = await get(ref(db, `users/${uid}/album`));
            if (friendAlbumSnap.exists()) state = friendAlbumSnap.val();
        } catch (e) {}

        const duplicateIds = allStickers.filter(id => (state[id] || 0) > 1);
        const matches = duplicateIds.filter(id => myMissing.has(id));
        const totalOwned = Object.keys(state).filter(id => state[id] > 0).length;

        summaries.push({
            uid,
            email,
            state,
            duplicateCount: duplicateIds.length,
            matchCount: matches.length,
            totalOwned
        });
    }

    return summaries;
}

export function getFriendTradeMatches(allStickers, myState, friendState) {
    const myMissing = allStickers.filter(id => (myState[id] || 0) === 0);
    const myDuplicates = allStickers.filter(id => (myState[id] || 0) > 1);
    const friendMissing = allStickers.filter(id => (friendState[id] || 0) === 0);
    const friendDuplicates = allStickers.filter(id => (friendState[id] || 0) > 1);

    return {
        iCanGet: friendDuplicates.filter(id => myMissing.includes(id)),
        iCanGive: myDuplicates.filter(id => friendMissing.includes(id))
    };
}

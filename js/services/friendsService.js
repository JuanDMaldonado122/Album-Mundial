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

    return { ok: true, friendUid };
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

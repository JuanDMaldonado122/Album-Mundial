import { get, onValue, push, ref, set, update } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from "./firebaseService.js";

function normalizeRequest(snapshot, id) {
    return { id, ...snapshot };
}

export async function createTradeRequest({ currentUser, currentProfile = {}, targetUid, targetEmail, targetDisplayName, proposal }) {
    const requestRef = push(ref(db, 'tradeRequests'));
    const requestId = requestRef.key;
    const chatId = requestId;
    const payload = {
        id: requestId,
        chatId,
        status: 'pending',
        fromUid: currentUser.uid,
        fromEmail: currentUser.email,
        fromDisplayName: currentProfile.displayName || currentUser.email,
        toUid: targetUid,
        toEmail: targetEmail,
        toDisplayName: targetDisplayName || targetEmail,
        proposal,
        createdAt: Date.now()
    };

    await Promise.all([
        set(requestRef, payload),
        set(ref(db, `userTradeRequests/${currentUser.uid}/${requestId}`), true),
        set(ref(db, `userTradeRequests/${targetUid}/${requestId}`), true)
    ]);

    return payload;
}

export async function getUserTradeRequests(currentUser) {
    const indexSnap = await get(ref(db, `userTradeRequests/${currentUser.uid}`));
    if (!indexSnap.exists()) return [];

    const requestIds = Object.keys(indexSnap.val());
    const requests = [];

    for (const requestId of requestIds) {
        const requestSnap = await get(ref(db, `tradeRequests/${requestId}`));
        if (requestSnap.exists()) requests.push(normalizeRequest(requestSnap.val(), requestId));
    }

    return requests.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export async function respondTradeRequest({ request, currentUser, status }) {
    if (!['accepted', 'rejected'].includes(status)) return;
    if (request.toUid !== currentUser.uid) return;

    await update(ref(db, `tradeRequests/${request.id}`), {
        status,
        respondedAt: Date.now()
    });

    if (status === 'accepted') {
        await set(ref(db, `chats/${request.chatId}/meta`), {
            requestId: request.id,
            participants: {
                [request.fromUid]: request.fromDisplayName || request.fromEmail,
                [request.toUid]: request.toDisplayName || request.toEmail
            },
            createdAt: request.createdAt || Date.now(),
            acceptedAt: Date.now()
        });
    }
}

export function watchChatMessages(chatId, onMessages) {
    return onValue(ref(db, `chats/${chatId}/messages`), (snapshot) => {
        const messages = snapshot.exists()
            ? Object.entries(snapshot.val()).map(([id, message]) => ({ id, ...message }))
            : [];

        onMessages(messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
    });
}

export async function sendChatMessage({ chatId, currentUser, currentProfile = {}, text }) {
    const cleanText = text.trim();
    if (!cleanText) return;

    await set(push(ref(db, `chats/${chatId}/messages`)), {
        fromUid: currentUser.uid,
        fromEmail: currentUser.email,
        fromDisplayName: currentProfile.displayName || currentUser.email,
        text: cleanText,
        createdAt: Date.now()
    });
}

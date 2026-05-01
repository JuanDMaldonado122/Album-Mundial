import { get, ref, remove, set } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";
import { db } from "./firebaseService.js";

const LOCATION_PRECISION = 2;
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

function roundLocation(value) {
    return Number(value.toFixed(LOCATION_PRECISION));
}

export function calculateDistanceKm(a, b) {
    const radiusKm = 6371;
    const toRad = value => (value * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return radiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export async function saveNearbyAvailability(currentUser, coords, profile = {}) {
    const location = {
        lat: roundLocation(coords.latitude),
        lng: roundLocation(coords.longitude)
    };

    await set(ref(db, `nearbyCollectors/${currentUser.uid}`), {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: profile.displayName || currentUser.email,
        location,
        active: true,
        updatedAt: Date.now()
    });

    return location;
}

export function disableNearbyAvailability(currentUser) {
    return remove(ref(db, `nearbyCollectors/${currentUser.uid}`));
}

export async function getNearbyCollectors(currentUser) {
    const snap = await get(ref(db, 'nearbyCollectors'));
    if (!snap.exists()) return [];

    const now = Date.now();
    const collectors = Object.values(snap.val())
        .filter(item => item?.uid && item.uid !== currentUser.uid)
        .filter(item => item.active && item.location)
        .filter(item => !item.updatedAt || now - item.updatedAt <= MAX_AGE_MS);

    const withAlbum = [];

    for (const collector of collectors) {
        let state = {};
        let profile = {};
        try {
            const albumSnap = await get(ref(db, `users/${collector.uid}/album`));
            if (albumSnap.exists()) state = albumSnap.val();
        } catch (e) {}
        try {
            const profileSnap = await get(ref(db, `profiles/${collector.uid}`));
            if (profileSnap.exists()) profile = profileSnap.val();
        } catch (e) {}

        withAlbum.push({
            ...collector,
            displayName: profile.displayName || collector.displayName || collector.email,
            state
        });
    }

    return withAlbum;
}

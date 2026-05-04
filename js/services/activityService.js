const MAX_ACTIVITY_ITEMS = 30;

function getKey(uid) {
    return `album-2026-activity-${uid}`;
}

export function getActivity(uid) {
    if (!uid) return [];

    try {
        return JSON.parse(localStorage.getItem(getKey(uid))) || [];
    } catch (e) {
        return [];
    }
}

export function addActivity(uid, activity) {
    const message = typeof activity === 'string' ? activity : activity?.message;
    if (!uid || !message) return;

    const items = getActivity(uid);
    items.unshift({
        type: typeof activity === 'string' ? 'general' : activity.type || 'general',
        title: typeof activity === 'string' ? '' : activity.title || '',
        message,
        at: new Date().toISOString()
    });

    localStorage.setItem(getKey(uid), JSON.stringify(items.slice(0, MAX_ACTIVITY_ITEMS)));
}

export function formatActivityTime(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatActivityHour(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

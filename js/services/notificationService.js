const MAX_NOTIFICATION_ITEMS = 50;

function getKey(uid) {
    return `album-2026-notifications-${uid}`;
}

function getMilestoneKey(uid) {
    return `album-2026-notification-milestones-${uid}`;
}

export function getNotifications(uid) {
    if (!uid) return [];

    try {
        return JSON.parse(localStorage.getItem(getKey(uid))) || [];
    } catch (e) {
        return [];
    }
}

export function addNotification(uid, { title, message, type = 'info', action = null }) {
    if (!uid || !title || !message) return [];

    const items = getNotifications(uid);
    items.unshift({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title,
        message,
        type,
        action,
        read: false,
        at: new Date().toISOString()
    });

    const nextItems = items.slice(0, MAX_NOTIFICATION_ITEMS);
    localStorage.setItem(getKey(uid), JSON.stringify(nextItems));
    return nextItems;
}

export function getUnreadNotificationCount(uid) {
    return getNotifications(uid).filter(item => !item.read).length;
}

export function markAllNotificationsRead(uid) {
    const items = getNotifications(uid).map(item => ({ ...item, read: true }));
    localStorage.setItem(getKey(uid), JSON.stringify(items));
    return items;
}

export function clearNotifications(uid) {
    localStorage.removeItem(getKey(uid));
    return [];
}

export function wasMilestoneNotified(uid, milestone) {
    if (!uid) return false;

    try {
        const milestones = JSON.parse(localStorage.getItem(getMilestoneKey(uid))) || [];
        return milestones.includes(milestone);
    } catch (e) {
        return false;
    }
}

export function markMilestoneNotified(uid, milestone) {
    if (!uid) return;

    let milestones = [];
    try {
        milestones = JSON.parse(localStorage.getItem(getMilestoneKey(uid))) || [];
    } catch (e) {}

    if (!milestones.includes(milestone)) {
        milestones.push(milestone);
        localStorage.setItem(getMilestoneKey(uid), JSON.stringify(milestones));
    }
}

export function formatNotificationTime(isoDate) {
    const date = new Date(isoDate);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

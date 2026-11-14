import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

const MAX_QUEUED = 20;

// Intercept only notifications GNOME has already selected for banner display.
// Its source policies, DND/urgency rules, and fullscreen checks remain in charge.
export class NotificationSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._entries = new Map();
        this._queue = [];
        this._current = null;
        this._timeoutId = 0;
        this._drainId = 0;
        this._enabled = false;
        this._destroyed = false;
        this._wrapper = null;
        this._settingsIds = [
            settings.connect('changed::show-notifications', () => this._sync()),
            settings.connect('changed::auto-hide-delay', () => this._armTimeout()),
        ];
        this._hoverId = island.connect('notify::hover', () => this._armTimeout());
        this._sessionId = Main.sessionMode.connect('updated', () => {
            if (Main.sessionMode.isLocked || !Main.sessionMode.hasNotifications)
                this._clear();
        });
        this._sync();
    }

    _sync() {
        this._enabled = this._settings.get_boolean('show-notifications');
        if (!this._enabled) {
            this._restore();
            this._clear();
            return;
        }
        if (this._wrapper)
            return;
        const tray = Main.messageTray;
        const original = tray._showNotification;
        if (typeof original !== 'function') {
            console.warn('dynamic-island: unsupported notification API, keeping native banners');
            return;
        }
        this._original = original;
        const source = this;
        this._wrapper = function (...args) {
            if (!source._enabled || source._destroyed || Main.sessionMode.isLocked || !Main.sessionMode.hasNotifications)
                return original.apply(this, args);
            const notification = this._notificationQueue?.[0];
            if (!notification || typeof notification.activate !== 'function')
                return original.apply(this, args);
            const acknowledged = notification.acknowledged;
            this._notificationQueue.shift();
            try {
                source._enqueue(notification);
                this.emit('queue-changed');
                source._scheduleDrain();
            } catch (e) {
                console.warn(`dynamic-island: notification takeover failed, using native banner: ${e}`);
                source._clear();
                notification.acknowledged = acknowledged;
                if (!this._notificationQueue.includes(notification))
                    this._notificationQueue.unshift(notification);
                return original.apply(this, args);
            }
        };
        tray._showNotification = this._wrapper;
    }

    _restore() {
        if (this._wrapper && Main.messageTray._showNotification === this._wrapper)
            Main.messageTray._showNotification = this._original;
        this._wrapper = null;
        if (this._drainId)
            GLib.source_remove(this._drainId);
        this._drainId = 0;
    }

    _scheduleDrain() {
        if (this._drainId)
            return;
        // MessageTray is still inside _updateState(). Drain its next eligible
        // banner on the next main-loop turn rather than reentering that method.
        this._drainId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._drainId = 0;
            if (this._enabled && !this._destroyed)
                Main.messageTray._updateState();
            return GLib.SOURCE_REMOVE;
        });
    }

    _enqueue(notification) {
        if (this._entries.has(notification))
            return;
        // Overflow stays unread in notification history, just like GNOME's own
        // bounded banner queue. Never destroy notifications to make room.
        if (this._entries.size >= MAX_QUEUED)
            return;
        const entry = {notification, ids: []};
        this._entries.set(notification, entry);
        entry.ids.push(notification.connect('destroy', () => this._finish(entry)));
        entry.ids.push(notification.connect('notify', (_object, pspec) => {
            if (this._current === entry && ['title', 'body', 'gicon', 'use-body-markup'].includes(pspec.name)) {
                this._render(entry);
                this._armTimeout();
            }
        }));
        for (const signal of ['action-added', 'action-removed']) {
            entry.ids.push(notification.connect(signal, () => {
                if (this._current === entry)
                    this._render(entry);
            }));
        }
        this._queue.push(entry);
        this._queue.sort((a, b) => b.notification.urgency - a.notification.urgency);
        this._showNext();
    }

    _showNext() {
        if (this._current)
            return;
        // Policies may change while a notification waits behind another card.
        // Recheck them before displaying queued content.
        let entry;
        while ((entry = this._queue.shift())) {
            const notification = entry.notification;
            const critical = notification.urgency === Urgency.CRITICAL;
            const limited = Main.messageTray._busy || Main.layoutManager.primaryMonitor?.inFullscreen;
            const allowed = !Main.sessionMode.isLocked && Main.sessionMode.hasNotifications &&
                notification.urgency !== Urgency.LOW &&
                (notification.source?.policy?.showBanners !== false || critical) &&
                (!limited || notification.forFeedback || critical);
            if (allowed) {
                this._current = entry;
                break;
            }
            this._entries.delete(notification);
            this._disconnect(entry);
        }
        if (!this._current) {
            this._island.hideNotification();
            return;
        }
        this._render(this._current);
        this._current.notification.acknowledged = true;
        this._current.notification.playSound();
        this._armTimeout();
    }

    _render(entry) {
        const notification = entry.notification;
        let body = notification.body ?? '';
        if (notification.useBodyMarkup) {
            try {
                body = Pango.parse_markup(body, -1, '\0')[2];
            } catch {
                body = body.replace(/<[^>]*>/g, '');
            }
        }
        this._island.showNotification({
            app: notification.source?.title ?? 'Notification',
            title: notification.title ?? '',
            body,
            icon: notification.gicon ?? notification.source?.icon ?? new Gio.ThemedIcon({name: 'dialog-information-symbolic'}),
            actions: notification.actions.map(action => ({
                label: action.label,
                activate: () => this._activate(entry, () => action.activate()),
            })),
            activate: () => this._activate(entry, () => notification.activate()),
            dismiss: () => this._finish(entry),
        });
    }

    _activate(entry, action) {
        if (this._current !== entry)
            return;
        try {
            action();
        } catch (e) {
            console.warn(`dynamic-island: notification action failed: ${e}`);
        } finally {
            // Activation may already have destroyed and removed the notification.
            this._finish(entry);
        }
    }

    _armTimeout() {
        this._cancelTimeout();
        if (!this._current || this._island.hover)
            return;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            this._settings.get_int('auto-hide-delay'), () => {
                this._timeoutId = 0;
                if (this._current)
                    this._finish(this._current);
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelTimeout() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
    }

    _disconnect(entry) {
        for (const id of entry.ids) {
            try {
                entry.notification.disconnect(id);
            } catch {
                // A source can dispose its notification during activation.
            }
        }
        entry.ids = [];
    }

    _finish(entry) {
        if (!this._entries.delete(entry.notification))
            return;
        this._disconnect(entry);
        this._queue = this._queue.filter(queued => queued !== entry);
        if (this._current === entry) {
            this._cancelTimeout();
            this._current = null;
            this._showNext();
        }
    }

    _clear() {
        this._cancelTimeout();
        for (const entry of this._entries.values())
            this._disconnect(entry);
        this._entries.clear();
        this._queue = [];
        this._current = null;
        this._island.hideNotification();
    }

    destroy() {
        this._destroyed = true;
        this._enabled = false;
        this._restore();
        this._clear();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._island.disconnect(this._hoverId);
        Main.sessionMode.disconnect(this._sessionId);
    }
}

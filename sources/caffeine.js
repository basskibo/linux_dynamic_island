import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'caffeine@patapon.info';

// Filter feedback, not inhibition: leave Caffeine's fullscreen/media/app rules
// and user state untouched. No third-party extension files need to be modified.
export class CaffeineFeedbackSource {
    constructor(_island, settings) {
        this._settings = settings;
        this._indicator = null;
        this._manualDepth = 0;
        this._active = false;
        this._destroyed = false;
        this._settingId = settings.connect('changed::caffeine-manual-feedback', () => this._sync());
        this._extensionId = Main.extensionManager.connect('extension-state-changed', (_manager, extension) => {
            if (extension.uuid === UUID)
                this._sync();
        });
        this._sync();
    }

    _sync() {
        const indicator = Main.extensionManager.lookup(UUID)?.stateObj?._caffeineIndicator;
        if (!this._settings.get_boolean('caffeine-manual-feedback') || !indicator) {
            this._restore();
            return;
        }
        if (this._indicator === indicator)
            return;
        this._restore();
        if (typeof indicator._handleToggleClick !== 'function' ||
            typeof indicator._sendOSDNotification !== 'function' ||
            typeof indicator._inhibitorManager?.isFullscreen !== 'function')
            return;
        this._indicator = indicator;
        this._active = true;
        const source = this;
        const originalToggle = indicator._handleToggleClick;
        const originalFeedback = indicator._sendOSDNotification;
        this._originalToggle = originalToggle;
        this._originalFeedback = originalFeedback;
        this._toggleWrapper = function (...args) {
            // Timers, startup restoration, and CLI updates run outside input
            // dispatch; real pointer/key/touch toggles have a current event.
            const manual = source._active && !source._destroyed && !!Clutter.get_current_event();
            if (manual)
                source._manualDepth++;
            try {
                return originalToggle.apply(this, args);
            } finally {
                if (manual)
                    source._manualDepth--;
            }
        };
        this._feedbackWrapper = function (...args) {
            if (!source._active || source._destroyed)
                return originalFeedback.apply(this, args);
            if (!source._manualDepth || this._inhibitorManager?.isFullscreen())
                return;
            return originalFeedback.apply(this, args);
        };
        indicator._handleToggleClick = this._toggleWrapper;
        indicator._sendOSDNotification = this._feedbackWrapper;
    }

    _restore() {
        this._active = false;
        if (this._indicator) {
            if (this._indicator._handleToggleClick === this._toggleWrapper)
                this._indicator._handleToggleClick = this._originalToggle;
            if (this._indicator._sendOSDNotification === this._feedbackWrapper)
                this._indicator._sendOSDNotification = this._originalFeedback;
        }
        this._indicator = null;
        this._manualDepth = 0;
    }

    destroy() {
        this._destroyed = true;
        this._restore();
        this._settings.disconnect(this._settingId);
        Main.extensionManager.disconnect(this._extensionId);
    }
}

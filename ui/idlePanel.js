import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { t } from '../i18n.js';
import { ART_MAX_BYTES, formatLocalizedDate, toGicon } from './layout.js';

export class IdlePanel {
    constructor(settings) {
        this._settings = settings;
        this._destroyed = false;
        this._idleClockId = 0;
        this._batteryStatus = null;
        this._bluetoothStatus = { powered: false, connected: [] };

        this.compactActor = new St.Widget({
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this._idleClock = new St.Label({
            style_class: 'di-idle-clock',
            visible: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleIcon = new St.Icon({
            style_class: 'di-idle-icon',
            visible: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.compactActor.add_child(this._idleClock);
        this.compactActor.add_child(this._idleIcon);

        this.expandedActor = new St.BoxLayout({
            style_class: 'di-idle-expanded',
            visible: false,
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Left: Apple Lock Screen style big clock + localized full date
        this._idleExpandedText = new St.BoxLayout({
            style_class: 'di-idle-expanded-text',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleExpandedText.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        this._idleExpandedClock = new St.Label({
            style_class: 'di-idle-expanded-clock',
            x_align: Clutter.ActorAlign.START,
        });
        this._idleExpandedDate = new St.Label({
            style_class: 'di-idle-expanded-date',
            x_align: Clutter.ActorAlign.START,
        });
        this._idleExpandedText.add_child(this._idleExpandedClock);
        this._idleExpandedText.add_child(this._idleExpandedDate);

        // Center: enlarged minimal or custom SVG/PNG icon
        this._idleExpandedIcon = new St.Icon({
            style_class: 'di-idle-expanded-icon',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleExpandedIconWrap = new St.Bin({
            style_class: 'di-idle-expanded-icon-wrap',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._idleExpandedIcon,
        });

        // Right: live system status summary (battery + Bluetooth)
        this._idleStatusBox = new St.BoxLayout({
            style_class: 'di-idle-status',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleStatusBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;

        this._idleBatRow = new St.BoxLayout({
            style_class: 'di-idle-status-row',
            visible: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleBatIcon = new St.Icon({ style_class: 'di-idle-status-icon', y_align: Clutter.ActorAlign.CENTER });
        this._idleBatLabel = new St.Label({ style_class: 'di-idle-status-label', y_align: Clutter.ActorAlign.CENTER });
        this._idleBatRow.add_child(this._idleBatIcon);
        this._idleBatRow.add_child(this._idleBatLabel);

        this._idleBtRow = new St.BoxLayout({
            style_class: 'di-idle-status-row',
            visible: false,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._idleBtIcon = new St.Icon({ style_class: 'di-idle-status-icon', y_align: Clutter.ActorAlign.CENTER });
        this._idleBtLabel = new St.Label({ style_class: 'di-idle-status-label', y_align: Clutter.ActorAlign.CENTER });
        this._idleBtLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._idleBtRow.add_child(this._idleBtIcon);
        this._idleBtRow.add_child(this._idleBtLabel);

        this._idleStatusBox.add_child(this._idleBatRow);
        this._idleStatusBox.add_child(this._idleBtRow);

        this._idleExpandedEmpty = new St.Widget({ visible: false, width: 170, height: 38 });
        this.expandedActor.add_child(this._idleExpandedText);
        this.expandedActor.add_child(this._idleExpandedIconWrap);
        this.expandedActor.add_child(this._idleStatusBox);
        this.expandedActor.add_child(this._idleExpandedEmpty);

        this.syncIcon();
        this._renderSystemStatus();
    }

    get hasBattery() {
        return !!this._batteryStatus;
    }

    syncIcon() {
        if (this._destroyed)
            return;
        const path = this._settings.get_string('idle-icon-path');
        let gicon = new Gio.ThemedIcon({ name: 'audio-x-generic-symbolic' });
        if (path) {
            try {
                const file = Gio.File.new_for_path(path);
                if (file.query_exists(null)) {
                    const info = file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, null);
                    if (info.get_file_type() === Gio.FileType.REGULAR && info.get_size() <= ART_MAX_BYTES)
                        gicon = new Gio.FileIcon({ file });
                }
            } catch (e) {
                console.warn(`dynamic-island: failed to load custom idle icon: ${e.message}`);
            }
        }
        this._idleIcon.gicon = gicon;
        this._idleExpandedIcon.gicon = gicon;
    }

    setBatteryStatus(status) {
        if (this._destroyed)
            return false;
        const hadBattery = !!this._batteryStatus;
        this._batteryStatus = status;
        this._renderSystemStatus();
        return hadBattery !== !!status;
    }

    setBluetoothStatus(status) {
        if (this._destroyed)
            return;
        this._bluetoothStatus = status ?? { powered: false, connected: [] };
        this._renderSystemStatus();
    }

    applyState({
        showCompact, expandedIdle, idleMode,
        showClock, showIcon, showBat, showBt,
        showStatus, showTopIdle, hasPanelContent,
    }) {
        this.compactActor.visible = showCompact;
        this._idleClock.visible = showCompact && idleMode === 'clock';
        this._idleIcon.visible = showCompact && idleMode === 'icon';

        this.expandedActor.visible = showTopIdle;
        this._idleExpandedText.visible = expandedIdle && showClock;
        this._idleExpandedIconWrap.visible = expandedIdle && showIcon;
        this._idleStatusBox.visible = expandedIdle && showStatus;
        this._idleBatRow.visible = expandedIdle && showBat;
        this._idleBtRow.visible = expandedIdle && showBt;
        this._idleExpandedEmpty.visible = expandedIdle && !hasPanelContent;

        const multiColumn = showClock && (showIcon || showStatus);
        const textAlign = multiColumn ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
        this._idleExpandedClock.x_align = textAlign;
        this._idleExpandedDate.x_align = textAlign;
    }

    applyCompactSize(width, height) {
        this.compactActor.set_size(width, height);
    }

    syncClock() {
        if (this._idleClockId) {
            GLib.Source.remove(this._idleClockId);
            this._idleClockId = 0;
        }
        if (this._destroyed)
            return;
        const compactClock = this.compactActor.visible && this._idleClock.visible;
        const expandedClock = this.expandedActor.visible && this._idleExpandedText.visible;
        if (!compactClock && !expandedClock)
            return;
        const update = () => {
            if (this._destroyed)
                return;
            const now = GLib.DateTime.new_now_local();
            const hhmm = now.format('%H:%M') ?? '';
            if (compactClock)
                this._idleClock.text = hhmm;
            if (expandedClock) {
                this._idleExpandedClock.text = hhmm;
                this._idleExpandedDate.text = formatLocalizedDate(now);
            }
            // Align ticks to minute boundaries while capping at 15s to recover quickly after suspend/clock jumps
            const delay = Math.max(1, Math.min(15, 60 - now.get_second()));
            this._idleClockId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
                this._idleClockId = 0;
                update();
                return GLib.SOURCE_REMOVE;
            });
        };
        update();
    }

    updateLocale() {
        if (this._destroyed)
            return;
        this.syncClock();
        this._renderSystemStatus();
    }

    _renderSystemStatus() {
        const bat = this._batteryStatus;
        if (bat) {
            this._idleBatIcon.gicon = toGicon(bat.icon);
            this._idleBatIcon.style = bat.charging ? 'color: #30d158;' : null;
            this._idleBatLabel.text = t(bat.charging ? 'idle.battery.charging' : 'idle.battery.level', { percent: bat.percent });
        }

        const bt = this._bluetoothStatus;
        const connected = bt?.connected ?? [];
        if (connected.length > 0) {
            const first = connected[0];
            this._idleBtIcon.gicon = connected.length === 1
                ? Gio.ThemedIcon.new_from_names([first.icon, 'bluetooth-active-symbolic'])
                : toGicon('bluetooth-active-symbolic');
            this._idleBtIcon.style = 'color: #0a84ff;';
            this._idleBtLabel.remove_style_class_name('di-idle-status-dim');
            if (connected.length === 1) {
                this._idleBtLabel.text = first.battery !== null
                    ? t('idle.bluetooth.deviceBattery', { name: first.alias, percent: first.battery })
                    : first.alias;
            } else {
                this._idleBtLabel.text = t('idle.bluetooth.multiple', { name: first.alias, count: connected.length - 1 });
            }
        } else {
            const powered = !!bt?.powered;
            this._idleBtIcon.gicon = toGicon(powered ? 'bluetooth-active-symbolic' : 'bluetooth-disabled-symbolic');
            this._idleBtIcon.style = 'color: rgba(255,255,255,0.45);';
            this._idleBtLabel.add_style_class_name('di-idle-status-dim');
            this._idleBtLabel.text = t(powered ? 'idle.bluetooth.notConnected' : 'idle.bluetooth.off');
        }
    }

    destroy() {
        this._destroyed = true;
        if (this._idleClockId) {
            GLib.Source.remove(this._idleClockId);
            this._idleClockId = 0;
        }
        this._settings = null;
    }
}

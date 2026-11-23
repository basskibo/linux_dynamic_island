import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { t } from '../i18n.js';
import { ART_BORDER, ART_MAX_BYTES, loadIcon, toGicon } from './layout.js';

export class MediaView {
    constructor(settings, callbacks) {
        this._settings = settings;
        this._callbacks = callbacks;
        this._destroyed = false;
        this._player = null;
        this._playing = false;
        this._hasMusic = false;
        this._trackKey = null;
        this._artBackground = '';
        this._artCancellable = new Gio.Cancellable();
        this._lastArtRadius = 0;

        this.artActor = new St.Bin({ style_class: 'di-art', pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }) });

        this.textActor = new St.BoxLayout({ style_class: 'di-text', x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        // Through the layout manager: St.BoxLayout has `vertical` up to GNOME 47 and `orientation` from 48
        this.textActor.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        this.sourceActor = new St.BoxLayout({ style_class: 'di-source', visible: false });
        this._sourceIcon = new St.Icon({ style_class: 'di-source-icon' });
        this._sourceLabel = new St.Label({ style_class: 'di-source-label', y_align: Clutter.ActorAlign.CENTER });
        this.sourceActor.add_child(this._sourceIcon);
        this.sourceActor.add_child(this._sourceLabel);
        this.textActor.add_child(this.sourceActor);
        this._title = new St.Label({ style_class: 'di-title' });
        this.artistActor = new St.Label({ style_class: 'di-artist', visible: false });
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.artistActor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.textActor.add_child(this._title);
        this.textActor.add_child(this.artistActor);

        this.controlsActor = new St.BoxLayout({ visible: false, y_align: Clutter.ActorAlign.CENTER });
        this._prevButton = this._button('previous', () => this._player?.previous());
        this.controlsActor.add_child(this._prevButton);
        this._playButton = this._button('pause', () => this._player?.playPause());
        this._playButton.add_style_class_name('di-play');
        this.controlsActor.add_child(this._playButton);
        this._nextButton = this._button('next', () => this._player?.next());
        this.controlsActor.add_child(this._nextButton);
    }

    get hasMusic() {
        return this._hasMusic;
    }

    get playing() {
        return this._playing;
    }

    get hasSourceName() {
        return !!this._sourceLabel.text;
    }

    _button(name, callback) {
        const button = new St.Button({ style_class: 'di-btn', child: new St.Icon({ gicon: loadIcon(name) }) });
        button.connect('clicked', callback);
        return button;
    }

    updateLabels() {
        if (this._destroyed)
            return;
        this._prevButton.accessible_name = t('island.controls.previous');
        this._playButton.accessible_name = t(this._playing ? 'island.controls.pause' : 'island.controls.play');
        this._nextButton.accessible_name = t('island.controls.next');
    }

    // source is the app playing: {name, icon}
    setPlayer(player, source) {
        if (this._destroyed)
            return;
        this._player = player;
        this._hasMusic = !!player && !!player.trackTitle && player.status !== 'Stopped';
        // Kept here: the timers below would throw reading a player the shell just closed, which stops them
        this._playing = this._hasMusic && player.status === 'Playing';
        if (this._hasMusic) {
            this._playButton.child.gicon = loadIcon(player.status === 'Playing' ? 'pause' : 'play');
            this._playButton.accessible_name = t(this._playing ? 'island.controls.pause' : 'island.controls.play');
            this._sourceIcon.gicon = toGicon(source.icon);
            this._sourceLabel.text = source.name;
            this.sourceActor.visible = this._callbacks.isExpanded() && !!source.name;
            const key = `${player.trackTitle}\n${player.trackArtists.join(', ')}\n${player.trackCoverUrl}`;
            if (key !== this._trackKey) {
                this._trackKey = key;
                this._swapTrack(player);
            }
        }
    }

    raisePlayer() {
        if (this._hasMusic)
            this._player?.raise();
    }

    // Vinyl mode: the cover turns while playing and stops where it is when paused
    syncSpin() {
        if (this._destroyed)
            return;
        const enabled = this._settings.get_boolean('art-spin');
        const spin = enabled && this._playing;
        if (spin === !!this.artActor.get_transition('di-spin'))
            return;
        if (spin) {
            // Plain transition, not ease(): ease() keeps the shell in "busy" mode for as long as it runs
            const angle = this.artActor.rotation_angle_z % 360;
            const transition = new Clutter.PropertyTransition({
                property_name: 'rotation-angle-z',
                duration: 8000,
                repeat_count: -1,
                progress_mode: Clutter.AnimationMode.LINEAR,
            });
            transition.set_from(angle);
            transition.set_to(angle + 360);
            this.artActor.add_transition('di-spin', transition);
        } else {
            this.artActor.remove_transition('di-spin');
            if (!enabled)
                this.artActor.rotation_angle_z = 0;
        }
    }

    applyGeometry(geometry) {
        if (this._destroyed)
            return;
        this.textActor.style = `max-width: ${this._settings.get_int('text-width')}px;`;
        const artSize = Math.round(geometry.artSize);
        this.artActor.set_size(artSize, artSize);
        this._lastArtRadius = geometry.artRadius;
        this.applyArtStyle();
    }

    applyArtStyle() {
        if (this._destroyed)
            return;
        const radiusPx = `${Math.max(0, Math.round(this._lastArtRadius))}px`;
        const border = ART_BORDER[this._settings.get_string('art-border')]?.(this._settings);
        this.artActor.style = `${this._artBackground} border-radius: ${radiusPx};` + (border ? ` border: ${border};` : '');
    }

    _swapTrack(player) {
        const apply = () => {
            if (this._destroyed)
                return;
            this._callbacks.onMorph(() => {
                this._title.text = player.trackTitle;
                this.artistActor.text = player.trackArtists.join(', ');
                this._setArt(player.trackCoverUrl);
            });
        };
        if (!this._callbacks.isShown() || !this.textActor.visible) {
            apply();
            return;
        }

        // Old track slides up and fades, new one slides in from below
        this.textActor.ease({
            opacity: 0,
            translation_y: -8,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._destroyed)
                    return;
                apply();
                this.textActor.translation_y = 8;
                this.textActor.ease({ opacity: 255, translation_y: 0, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            },
        });
        this.artActor.ease({
            scale_x: 0.6,
            scale_y: 0.6,
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (this._destroyed)
                    return;
                this.artActor.ease({ opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                this.artActor.ease({ scale_x: 1, scale_y: 1, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            },
        });
    }

    _setArt(url) {
        // Whatever is still running for the previous track must not overwrite this one's cover
        this._artCancellable.cancel();
        const cancellable = this._artCancellable = new Gio.Cancellable();
        if (url.startsWith('file://')) {
            this._setArtFile(Gio.File.new_for_uri(url), cancellable);
            return;
        }
        if (!url.startsWith('http')) {
            this._setArtBackground(null);
            return;
        }
        // St can't load remote images, so https covers (Spotify) are downloaded to a cache first
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-island']);
        GLib.mkdir_with_parents(dir, 0o755);
        const dest = Gio.File.new_for_path(`${dir}/${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1)}`);
        if (dest.query_exists(null)) {
            this._setArtFile(dest, cancellable);
            return;
        }
        // Through a temp name so an interrupted download never passes for a cached cover
        const part = Gio.File.new_for_path(`${dest.get_path()}.part`);
        // shortcut: size is only checked after the download, cancel from a progress callback if huge covers show up
        Gio.File.new_for_uri(url).copy_async(part, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT,
            cancellable, null, (file, res) => {
                try {
                    file.copy_finish(res);
                    part.move(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`dynamic-island: cover download failed: ${e.message}`);
                    return;
                }
                if (!cancellable.is_cancelled() && !this._destroyed)
                    this._setArtFile(dest, cancellable);
            });
    }

    // St loads background images synchronously in the compositor and the path comes from another app:
    // /dev/zero, a FIFO or a huge file would freeze the whole session, so only small regular files get through.
    // get_uri() also percent-encodes the quotes that could break out of the url("...") in the style.
    _setArtFile(file, cancellable) {
        file.query_info_async('standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT,
            cancellable, (f, res) => {
                let uri = null;
                try {
                    const info = f.query_info_finish(res);
                    if (info.get_file_type() === Gio.FileType.REGULAR && info.get_size() <= ART_MAX_BYTES)
                        uri = f.get_uri();
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                }
                if (!cancellable.is_cancelled() && !this._destroyed)
                    this._setArtBackground(uri);
            });
    }

    _setArtBackground(uri) {
        if (this._destroyed)
            return;
        this._artBackground = uri ? `background-image: url("${uri}");` : '';
        this.applyArtStyle();
    }

    destroy() {
        this._destroyed = true;
        this._artCancellable.cancel();
        this.artActor.remove_transition('di-spin');
        this._player = null;
        this._settings = null;
        this._callbacks = null;
    }
}

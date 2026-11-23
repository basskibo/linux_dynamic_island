import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { lerp } from './layout.js';

// Visualizer size per shape; levels animate toward random targets while playing
const EQ_WIDTH = { bars: 21, spectrum: 30, segments: 23, solid: 30, wave: 30, ribbon: 30 };
const EQ_HEIGHT = 18;
const EQ_LEVELS = 8;

// Gradient for the accent: the top is shifted toward yellow and lighter, so #ff6a00 gives the original #ffc24a → #ff6a00
function accentGradient(hex) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const h = !d ? 0 : max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const hue = (h * 60 + 15 + 360) % 360, light = Math.min(l + 0.14, 0.9);
    const a = s * Math.min(light, 1 - light);
    const k = n => (n + hue / 30) % 12;
    return [[0, 8, 4].map(n => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))), rgb];
}

function roundedRect(cr, x, y, w, h) {
    const r = Math.min(w, h) / 2;
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

export class Visualizer {
    constructor(settings) {
        this._settings = settings;
        this._destroyed = false;
        this._playing = false;
        this._levels = new Array(EQ_LEVELS).fill(0);
        this._targets = new Array(EQ_LEVELS).fill(0);
        this._phase = 0;
        this._accent = accentGradient(settings.get_string('accent-color'));

        this.actor = new St.DrawingArea({ height: EQ_HEIGHT, y_align: Clutter.ActorAlign.CENTER });
        this.actor.connect('repaint', area => this._draw(area));
        this.actor.width = this._eqWidth();

        this._timeline = new Clutter.Timeline({ actor: this.actor, duration: 1000, repeat_count: -1 });
        this._timeline.connect('new-frame', () => this._step(this._timeline.get_delta() / 1000));
        // Only runs while on screen, a running timeline keeps the frame clock ticking
        this.actor.connect('notify::mapped', () => {
            if (this._destroyed || !this._timeline)
                return;
            if (this.actor.mapped)
                this._timeline.start();
            else
                this._timeline.stop();
        });

        this._eqId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => this.tick());
    }

    setPlaying(playing) {
        this._playing = !!playing;
        this.tick();
    }

    syncStyle() {
        if (this._destroyed)
            return;
        this.actor.width = this._eqWidth();
    }

    syncAccent() {
        if (this._destroyed)
            return;
        this._accent = accentGradient(this._settings.get_string('accent-color'));
        this.actor.queue_repaint();
    }

    tick() {
        if (this._destroyed)
            return GLib.SOURCE_REMOVE;
        this._targets = this._targets.map(() => this._playing ? 0.15 + Math.random() * 0.85 : 0);
        return GLib.SOURCE_CONTINUE;
    }

    destroy() {
        this._destroyed = true;
        if (this._eqId) {
            GLib.source_remove(this._eqId);
            this._eqId = 0;
        }
        this._timeline?.stop();
        this._timeline = null;
        this._settings = null;
    }

    _eqWidth() {
        return EQ_WIDTH[this._settings.get_string('eq-style')] ?? EQ_WIDTH.bars;
    }

    // Eases levels toward their targets each frame; skips repaints once a paused visualizer has settled
    _step(dt) {
        if (this._destroyed || !this.actor.visible)
            return;
        const playing = this._playing;
        const ease = 1 - Math.exp(-dt * 10);
        let moving = playing;
        this._levels = this._levels.map((level, i) => {
            const next = level + (this._targets[i] - level) * ease;
            moving ||= Math.abs(next - level) > 0.001;
            return next;
        });
        if (playing)
            this._phase += dt * 5;
        if (moving)
            this.actor.queue_repaint();
    }

    // Level at x (0..1) between the sample points, cosine-smoothed
    _levelAt(x) {
        const t = x * (EQ_LEVELS - 1), i = Math.min(Math.floor(t), EQ_LEVELS - 2);
        const f = (1 - Math.cos((t - i) * Math.PI)) / 2;
        return lerp(this._levels[i], this._levels[i + 1], f);
    }

    _draw(area) {
        if (this._destroyed)
            return;
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const [top, bottom] = this._accent;
        const gradient = new Cairo.LinearGradient(0, 0, 0, h);
        gradient.addColorStopRGB(0, ...top);
        gradient.addColorStopRGB(1, ...bottom);
        cr.setSource(gradient);
        const levels = this._levels;
        const taper = x => Math.sin(Math.PI * x);

        switch (this._settings.get_string('eq-style')) {
            case 'spectrum':
                // Thin bars from the bottom, bass side a bit taller
                levels.forEach((level, i) => {
                    const bh = 2 + level * (h - 2) * (1 - i * 0.06);
                    roundedRect(cr, i * 4, h - bh, 2, bh);
                });
                cr.fill();
                break;
            case 'segments':
                // LED meter: 4 columns of up to 5 blocks
                for (let i = 0; i < 4; i++) {
                    const lit = Math.max(1, Math.ceil(levels[i * 2] * 5));
                    for (let j = 0; j < lit; j++)
                        roundedRect(cr, i * 6.33, h - j * 3.6 - 2.8, 4, 2.8);
                }
                cr.fill();
                break;
            case 'solid':
                cr.moveTo(0, h);
                for (let x = 0; x <= w; x++)
                    cr.lineTo(x, h - 1 - this._levelAt(x / w) * (h - 1) * Math.sqrt(taper(x / w)));
                cr.lineTo(w, h);
                cr.fill();
                break;
            case 'wave': {
                const amp = levels.reduce((a, b) => a + b) / EQ_LEVELS * (h / 2 - 1.5);
                cr.setLineWidth(2);
                cr.setLineCap(Cairo.LineCap.ROUND);
                for (let x = 1; x < w; x++)
                    cr.lineTo(x, h / 2 + amp * Math.sin(x / w * 3 * Math.PI + this._phase) * taper(x / w));
                cr.stroke();
                break;
            }
            case 'ribbon': {
                // Band mirrored around the middle, rippling as it plays
                const half = x => (0.75 + this._levelAt(x) * (h / 2 - 1)) * taper(x) *
                    (0.75 + 0.25 * Math.sin(x * 2 * Math.PI + this._phase));
                for (let x = 0; x <= w; x++)
                    cr.lineTo(x, h / 2 - half(x / w));
                for (let x = w; x >= 0; x--)
                    cr.lineTo(x, h / 2 + half(x / w));
                cr.fill();
                break;
            }
            default:
                for (let i = 0; i < 4; i++) {
                    const bh = 3 + levels[i * 2] * (h - 3);
                    roundedRect(cr, i * 6, (h - bh) / 2, 3, bh);
                }
                cr.fill();
        }
        cr.$dispose();
    }
}

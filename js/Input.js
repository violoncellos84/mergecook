/**
 * Input.js — Mouse & touch event handling (no game logic).
 * Depends on: nothing
 */
window.MC = window.MC || {};

class Input {
    /**
     * @param {object} handlers  { onStart(idx), onMove(idx), onEnd() }
     * @param {function} getConfig  returns current level config { rows, cols }
     */
    constructor(handlers, getConfig) {
        this._handlers  = handlers;
        this._getConfig = getConfig;
        this._dragging  = false;
    }

    attachTo(boardEl) {
        boardEl.addEventListener('mousedown', e => this._start(e));
        window.addEventListener('mousemove',  e => this._move(e));
        window.addEventListener('mouseup',    ()  => this._end());

        boardEl.addEventListener('touchstart',
            e => { e.preventDefault(); this._start(e); },
            { passive: false }
        );
        window.addEventListener('touchmove',
            e => { e.preventDefault(); this._move(e); },
            { passive: false }
        );
        window.addEventListener('touchend', () => this._end());
    }

    _start(e) {
        if (document.getElementById('game-overlay').style.display === 'flex') return;
        const idx = this._pointerIndex(e);
        if (idx === -1) return;
        this._dragging = true;
        this._handlers.onStart(idx);
    }

    _move(e) {
        if (!this._dragging) return;
        const idx = this._pointerIndex(e);
        if (idx !== -1) this._handlers.onMove(idx);
    }

    _end() {
        if (!this._dragging) return;
        this._dragging = false;
        this._handlers.onEnd();
    }

    _pointerIndex(e) {
        const touch   = e.touches ? e.touches[0] : e;
        const config  = this._getConfig();
        const boardEl = document.getElementById('board');
        const rect    = boardEl.getBoundingClientRect();

        if (touch.clientX < rect.left || touch.clientX > rect.right ||
            touch.clientY < rect.top  || touch.clientY > rect.bottom) return -1;

        const col = Math.floor(((touch.clientX - rect.left) / rect.width)  * config.cols);
        const row = Math.floor(((touch.clientY - rect.top)  / rect.height) * config.rows);

        return (col >= 0 && col < config.cols && row >= 0 && row < config.rows)
            ? row * config.cols + col : -1;
    }
}

MC.Input = Input;

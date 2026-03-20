/**
 * Board.js — Pure game-state class (no DOM).
 * Depends on: nothing
 */
window.MC = window.MC || {};

class Board {
    constructor(config) {
        this.config    = config;
        this.data      = Array(config.rows * config.cols).fill(null);
        this.tileTypes = Array(config.rows * config.cols).fill('normal');
    }

    get size() { return this.config.rows * this.config.cols; }

    indexToRC(idx) {
        return { r: Math.floor(idx / this.config.cols), c: idx % this.config.cols };
    }

    rcToIndex(r, c) { return r * this.config.cols + c; }

    /** Chebyshev adjacency — includes diagonals for comfortable mobile drag. */
    isAdjacent(idxA, idxB) {
        const a = this.indexToRC(idxA);
        const b = this.indexToRC(idxB);
        return Math.abs(a.r - b.r) <= 1 && Math.abs(a.c - b.c) <= 1;
    }

    getBlock(idx)    { return this.data[idx]; }
    getTileType(idx) { return this.tileTypes[idx]; }

    spawnBlock(idx) {
        const { types } = this.config;
        const type = types[Math.floor(Math.random() * types.length)];
        this.data[idx] = {
            type,
            level: 1,
            id: 'b-' + Math.random().toString(36).substr(2, 9),
        };
    }

    _isStaticTile(idx) {
        const t = this.tileTypes[idx];
        return t === 'box' || t === 'mixer' || t === 'mixer-bot';
    }

    applyGravity() {
        const { rows, cols } = this.config;
        for (let c = 0; c < cols; c++) {
            // Phase 1: fall
            for (let r = rows - 1; r >= 0; r--) {
                const idx = this.rcToIndex(r, c);
                if (this._isStaticTile(idx)) continue;
                if (this.data[idx] !== null) continue;
                for (let kr = r - 1; kr >= 0; kr--) {
                    const kIdx = this.rcToIndex(kr, c);
                    if (this._isStaticTile(kIdx)) continue;
                    if (this.data[kIdx] !== null) {
                        this.data[idx]  = this.data[kIdx];
                        this.data[kIdx] = null;
                        break;
                    }
                }
            }
            // Phase 2: refill empty normal tiles
            for (let r = 0; r < rows; r++) {
                const idx = this.rcToIndex(r, c);
                if (this._isStaticTile(idx)) continue;
                if (this.data[idx] === null) this.spawnBlock(idx);
            }
        }
    }

    /** Shift conveyor row right one step; uses config.conveyorRow (no hardcoding). */
    applyConveyor() {
        const row = this.config.conveyorRow ?? 4;
        if (row >= this.config.rows) return;

        const rowData = [];
        for (let c = 0; c < this.config.cols; c++) rowData.push(this.data[this.rcToIndex(row, c)]);
        rowData.unshift(rowData.pop()); // rightmost → leftmost (shift right)
        for (let c = 0; c < this.config.cols; c++) this.data[this.rcToIndex(row, c)] = rowData[c];
    }

    destroyBox(idx) {
        if (this.tileTypes[idx] !== 'box') return false;
        this.tileTypes[idx] = 'normal';
        return true;
    }
}

MC.Board = Board;

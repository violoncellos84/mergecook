/**
 * Game.js — Orchestrator: owns Board, Renderer, Input; drives game flow.
 * Depends on: MC.LEVELS, MC.MAX_LEVEL, MC.MAX_PATH_LEN, MC.Board, MC.Renderer, MC.Input
 *
 * Bug fixes vs original:
 *   1. _executeMixerInput() validates mixerTypes defensively (not only in drag handler).
 *   2. _extendPath() blocks extension when path tail is a gimmick tile.
 *   3. _checkMission() calls _checkGameStatus() after the delayed collect timer.
 *   4. Conveyor column comes from config (Board.applyConveyor already uses it).
 */
window.MC = window.MC || {};

class Game {
    constructor() {
        this._level             = 1;
        this._moves             = 0;
        this._targetCounts      = {};
        this._path              = [];
        this._pendingAnimations = 0;   // fly-to-mission animations still in flight
        this._animating         = false; // true during merge animation

        this._board    = null;
        this._renderer = null;
        this._input    = null;

        // Expose overlay handler to global scope for HTML onclick
        window.handleOverlayBtn = () => this.handleOverlayBtn();
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        this._input = new MC.Input(
            {
                onStart: idx => this._startPath(idx),
                onMove:  idx => this._extendPath(idx),
                onEnd:   ()  => this._commitPath(),
            },
            () => this._board ? this._board.config : {}
        );

        window.addEventListener('resize', () => {
            if (this._renderer) this._renderer.adjustSize();
        });

        this._input.attachTo(document.getElementById('board'));

        // Title screen: tap/click anywhere to enter the game.
        const titleEl = document.getElementById('title-screen');
        const onTitleTap = () => {
            titleEl.removeEventListener('pointerdown', onTitleTap);
            titleEl.classList.add('fading');
            titleEl.addEventListener('transitionend', () => titleEl.remove(), { once: true });
            this._initLevel(1);
        };
        titleEl.addEventListener('pointerdown', onTitleTap);
    }

    /**
     * @param {number}  lv               - Level number to load.
     * @param {boolean} [showStartOverlay=true] - When true (default) shows the
     *   "레벨 N 시작하기" overlay (used for level-to-level transitions).
     *   Pass false when entering from the title screen to start immediately.
     */
    _initLevel(lv, showStartOverlay = true) {
        this._level             = lv;
        this._path              = [];
        this._targetCounts      = {};
        this._pendingAnimations = 0;
        this._animating         = false;

        // Remove stale overlays if still in DOM
        var clearEl = document.getElementById('clear-overlay');
        if (clearEl) clearEl.remove();
        var levelEl = document.getElementById('level-overlay');
        if (levelEl) levelEl.remove();

        const config = Object.assign({}, MC.LEVELS[lv], { level: lv });
        this._moves  = config.moves;

        config.targets.forEach(t => {
            const key = t.gimmick ? t.gimmick : `${t.type}-${t.level}`;
            this._targetCounts[key] = t.count;
        });

        this._board = new MC.Board(config);
        this._setupTileTypes();

        this._renderer = new MC.Renderer(this._board, config, lv);
        this._renderer.buildTiles();
        this._renderer.updateGuide(config.guide);
        this._renderer.updateUI(this._moves, this._targetCounts);
        this._renderer.adjustSize();

        if (showStartOverlay) {
            this._renderer.showLevelPopup(lv, config);
        }
    }

    _setupTileTypes() {
        const { rows, cols, hasBoxGimmick, hasMixerGimmick, hasConveyor, conveyorRow } = this._board.config;
        const cvRow = conveyorRow !== undefined ? conveyorRow : 4;

        for (let i = 0; i < rows * cols; i++) {
            const { r, c } = this._board.indexToRC(i);

            if (hasBoxGimmick && r >= 4) {
                this._board.tileTypes[i] = 'box';
            } else if (hasMixerGimmick && r === 2 && (c === 2 || c === 3)) {
                // Mixer top tile (1×2 unit, col 2 and col 3)
                this._board.tileTypes[i] = 'mixer';
            } else if (hasMixerGimmick && r === 3 && (c === 2 || c === 3)) {
                // Mixer bottom placeholder (transparent, same game logic as mixer)
                this._board.tileTypes[i] = 'mixer-bot';
            } else {
                if (hasConveyor && r === cvRow) {
                    // Horizontal conveyor rail across all columns
                    if (c === 0) {
                        this._board.tileTypes[i] = 'conveyor-a';
                    } else if (c === cols - 1) {
                        this._board.tileTypes[i] = 'conveyor-a-flip';
                    } else {
                        this._board.tileTypes[i] = 'conveyor-b';
                    }
                }
                this._board.spawnBlock(i);
            }
        }
    }

    // ── Path management ───────────────────────────────────────────────────────

    _startPath(idx) {
        if (this._animating) return;
        if (!this._board.getBlock(idx)) return;
        this._path = [idx];
        this._sync();
    }

    _extendPath(idx) {
        const path = this._path;
        if (!path.length) return;

        const last = path[path.length - 1];
        if (idx === last) return;
        if (!this._board.isAdjacent(last, idx)) return;

        const tileType   = this._board.getTileType(idx);
        const firstBlock = this._board.getBlock(path[0]);

        // ── Gimmick target ──
        if (tileType === 'box' || tileType === 'mixer' || tileType === 'mixer-bot') {
            if (path.length !== 1) return;
            if (!firstBlock || firstBlock.level < 2) return;

            if (tileType === 'mixer') {
                const { mixerTypes } = this._board.config;
                if (mixerTypes && mixerTypes.indexOf(firstBlock.type) === -1) return;
            }

            this._path = [path[0], idx];
            this._sync();
            return;
        }

        // ── Normal tile: tail must not be a gimmick ──
        const lastTileType = this._board.getTileType(last);
        if (lastTileType === 'box' || lastTileType === 'mixer' || lastTileType === 'mixer-bot') return;

        const target = this._board.getBlock(idx);
        if (!target) return;
        if (target.type !== firstBlock.type || target.level !== firstBlock.level) return;

        if (path.indexOf(idx) !== -1) {
            // Backtrack
            if (idx === path[path.length - 2]) this._path.pop();
        } else if (path.length < MC.MAX_PATH_LEN) {
            this._path.push(idx);
        }

        this._sync();
    }

    _commitPath() {
        const path = this._path;
        if (!path.length) return;

        const lastIdx  = path[path.length - 1];
        const lastType = this._board.getTileType(lastIdx);

        // Clear the renderer's selection BEFORE executing so that the
        // renderBlocks() call inside _afterAction() renders without a selection
        // highlight — avoiding the extra _sync() / second renderBlocks() that
        // used to overwrite the fall-in animation setup for newly spawned blocks.
        // NOTE: this._path must remain intact here; execute functions read it for
        // block indices (_path[0], _path[this._path.length - 1], etc.).
        this._renderer.setSelectedPath([]);

        if (path.length === 2 && lastType === 'box') {
            this._executeBoxDestroy();
        } else if (path.length === 2 && (lastType === 'mixer' || lastType === 'mixer-bot')) {
            this._executeMixerInput();
        } else if (path.length === MC.MAX_PATH_LEN) {
            this._executeMerge();
        } else {
            // Path too short / no valid action — just clear visuals
            this._renderer.renderBlocks();
        }

        // Clear path and SVG lines after all execute logic has finished.
        this._path = [];
        this._renderer.renderLines();
    }

    // ── Game actions ──────────────────────────────────────────────────────────

    _executeBoxDestroy() {
        var self = this;
        var blockIdx = this._path[0];
        var boxIdx   = this._path[1];
        var blockId  = this._board.data[blockIdx].id;

        this._moves--;
        this._animating = true;
        this._board.data[blockIdx] = null;

        this._renderer.playBoxAnimation(blockId, boxIdx, function () {
            self._animating = false;
            self._board.destroyBox(boxIdx);
            self._renderer.refreshDestroyedBox(boxIdx);
            self._checkMission('box');
            self._afterAction();
        });
    }

    _executeMixerInput() {
        const blockIdx = this._path[0];
        const block    = this._board.getBlock(blockIdx);

        // Defensive: re-validate mixer type constraint
        const { mixerTypes } = this._board.config;
        if (mixerTypes && mixerTypes.indexOf(block.type) === -1) {
            this._path = [];
            this._sync();
            return;
        }

        this._moves--;
        this._board.data[blockIdx] = null;
        this._checkMission('mixer');
        this._afterAction();
    }

    _executeMerge() {
        var self = this;
        var path = this._path.slice();
        var targetIdx = path[path.length - 1];
        var block = this._board.getBlock(targetIdx);
        var type = block.type;
        var level = block.level;

        this._moves--;
        this._animating = true;

        this._renderer.playMergeAnimation(path, type, level, function () {
            self._animating = false;

            path.forEach(function (idx) { self._board.data[idx] = null; });

            if (level < 3) {
                var nextLevel = level + 1;
                var newId = 'm-' + Math.random().toString(36).substr(2, 9);
                self._board.data[targetIdx] = {
                    type: type,
                    level: nextLevel,
                    id: newId,
                };

                // Spawn merged block at merge row (not from top)
                var rc = self._board.indexToRC(targetIdx);
                self._renderer.setMergeSpawnRow(newId, rc.r);

                var key = type + '-' + nextLevel;
                if (self._targetCounts[key] !== undefined) {
                    self._checkMission(key, targetIdx);
                }
            }

            if (self._board.config.hasConveyor) self._board.applyConveyor();
            self._afterAction();
        });
    }

    /**
     * Decrement mission counter. For level-3 blocks: animate the block flying
     * to the mission icon (with particle effects), then settle the board.
     */
    _checkMission(key, boardIdx) {
        if (this._targetCounts[key] <= 0) return;
        this._targetCounts[key]--;

        if (boardIdx !== undefined && key.indexOf('-') !== -1) {
            var self = this;
            self._pendingAnimations++;
            // Defer until _afterAction() has rendered the level-3 block into the DOM
            requestAnimationFrame(function () {
                self._renderer.animateBlockToMission(boardIdx, key, function () {
                    self._pendingAnimations--;
                    self._board.data[boardIdx] = null;
                    self._board.applyGravity();
                    self._renderer.renderBlocks();
                    self._renderer.updateUI(self._moves, self._targetCounts);
                    self._checkGameStatus();
                });
            });
        }
    }

    _afterAction() {
        this._board.applyGravity();
        this._renderer.renderBlocks();
        this._renderer.updateUI(this._moves, this._targetCounts);
        this._checkGameStatus();
    }

    _checkGameStatus() {
        // Wait until all fly-to-mission animations have finished before
        // checking win/lose — this lets the player see the last block fly
        // to the mission icon before the clear presentation appears.
        if (this._pendingAnimations > 0) return;

        const counts  = Object.values(this._targetCounts);
        const cleared = counts.every(function (v) { return v <= 0; });

        if (cleared) {
            var self = this;
            this._renderer.showClearPresentation(function () {
                if (self._level < MC.MAX_LEVEL) {
                    self._initLevel(self._level + 1);
                } else {
                    self._initLevel(1);
                }
            });
        } else if (this._moves <= 0) {
            this._renderer.showOverlay('GAMEOVER', '이동 횟수를 모두 소모했습니다.', '다시 도전');
        }
    }

    // ── Overlay button ────────────────────────────────────────────────────────

    handleOverlayBtn() {
        const title = document.getElementById('overlay-title').innerText;
        this._renderer.hideOverlay();

        if (title === 'SUCCESS') {
            if (this._level < MC.MAX_LEVEL) {
                this._initLevel(this._level + 1);
            } else {
                this._initLevel(1);
            }
        } else if (title === 'GAMEOVER') {
            this._initLevel(this._level);
        }
        // '레벨 N' (initial start overlay) → just hide, game is ready
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _sync() {
        this._renderer.setSelectedPath(this._path);
        this._renderer.updateVisuals();
    }
}

MC.Game = Game;

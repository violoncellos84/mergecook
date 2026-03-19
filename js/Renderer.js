/**
 * Renderer.js — All DOM / SVG rendering (no game logic).
 * Depends on: MC.ITEM_DATA, MC.GIMMICK_DATA
 *
 * Image-polishing: createItemElement() tries <img> from assets/;
 * falls back to emoji <span> via an error listener — no inline onerror.
 *
 * SVG fix: <svg> lives INSIDE #board (position:relative), so its origin
 * always matches the board's top-left. Original placed SVG as a flex
 * sibling, causing an x-offset when the board didn't fill the wrapper.
 */
window.MC = window.MC || {};

/* ── Merge FX Configuration ───────────────────────────────────────────────
 * Each entry defines one particle layer. Adjust values here to tune.
 *   type     : 'burst' (radial scatter) | 'expand' (single ring/glow)
 *   src      : particle image path
 *   count    : number of particles (1 for expand)
 *   spread   : [min, max] distance from center (px) — burst only
 *   scale    : [min, max] random scale per particle — burst only
 *   expandScale : [start, end] — expand only
 *   duration : [min, max] animation time (ms)
 *   delay    : start delay (ms) after merge
 *   filter   : CSS filter string (glow etc.)
 *   blend    : CSS mix-blend-mode
 *   opacity  : [min, max] initial opacity per particle
 */
var MERGE_FX_CONFIG = [
    {
        name:     'par01',
        type:     'burst',
        src:      'assets/fx/Par_01.png',
        count:    22,
        spread:   [40, 120],
        scale:    [0.3, 1.0],
        duration: [400, 700],
        delay:    0,
        filter:   'drop-shadow(0 0 8px rgba(255,180,60,0.6))',
        blend:    'normal',
        opacity:  [0.8, 1.0],
    },
    {
        name:     'par02',
        type:     'burst',
        src:      'assets/fx/Par_02.png',
        count:    22,
        spread:   [30, 100],
        scale:    [0.3, 1.0],
        duration: [400, 700],
        delay:    30,
        filter:   'drop-shadow(0 0 6px rgba(255,200,100,0.5))',
        blend:    'overlay',
        opacity:  [0.8, 1.0],
    },
    {
        name:     'par05',
        type:     'expand',
        src:      'assets/fx/Par_05.png',
        count:    1,
        expandScale: [0.2, 2.5],
        duration: [500, 500],
        delay:    50,
        filter:   'drop-shadow(0 0 12px rgba(255,140,0,0.7))',
        blend:    'normal',
        opacity:  [1.0, 1.0],
    },
    {
        name:     'par04',
        type:     'burst',
        src:      'assets/fx/Par_04.png',
        count:    12,
        spread:   [20, 90],
        scale:    [0.4, 1.0],
        duration: [500, 900],
        delay:    80,
        filter:   'none',
        blend:    'normal',
        opacity:  [0.3, 0.7],
    },
];

class Renderer {
    constructor(board, config, levelNum) {
        this.board = board;
        this.config = config;
        this.levelNum = levelNum;

        this.boardEl = document.getElementById('board');
        this.svgEl = document.getElementById('svg-lines');
        this.missionEl = document.getElementById('mission-targets');

        this._selectedPath = [];
        this._flyingIds    = new Set();   // block IDs currently in fly animation
        this._mergeSpawn   = null;        // { id, row } — merged block spawn position

        // Performance: cache block DOM elements by block ID to avoid querySelector in loop
        this._blockEls = new Map();
        // Performance: cache tile layout measurements; invalidated on resize
        this._tileLayoutCache = null;
    }

    setSelectedPath(path) { this._selectedPath = path; }

    /** Tell renderBlocks the merged block should spawn at its merge row, not from top. */
    setMergeSpawnRow(id, row) { this._mergeSpawn = { id: id, row: row }; }

    // ── Icon helpers ────────────────────────────────────────────────────────

    createItemElement(type, level) {
        const item = MC.ITEM_DATA[type];
        return this._iconEl(item.image[level - 1], item.emoji[level - 1]);
    }

    createGimmickElement(key) {
        const g = MC.GIMMICK_DATA[key];
        if (!g) return document.createTextNode('');
        return this._iconEl(g.image, g.emoji);
    }

    /** <img> with emoji <span> fallback on load error. */
    _iconEl(imgSrc, emoji) {
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = emoji;
        img.className = 'item-img';
        img.addEventListener('error', () => {
            const span = document.createElement('span');
            span.textContent = emoji;
            span.className = 'item-emoji';
            img.replaceWith(span);
        }, { once: true });
        return img;
    }

    // ── Board construction ──────────────────────────────────────────────────

    buildTiles() {
        const { rows, cols } = this.config;

        // Remove old tiles and blocks; SVG element is preserved
        this.boardEl.querySelectorAll('.tile, .block-item').forEach(el => el.remove());
        this._blockEls.clear();
        this._tileLayoutCache = null;

        this.boardEl.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        this.boardEl.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        for (let i = 0; i < rows * cols; i++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.index = i;

            const { r, c } = this.board.indexToRC(i);
            const tileType = this.board.getTileType(i);

            if (tileType === 'box') {
                tile.classList.add('box-gimmick');
                tile.appendChild(this.createGimmickElement('box'));
            } else if (tileType === 'mixer') {
                // Mixer top: Gimmick_02 overflows 200% downward to span 2 rows
                tile.classList.add('mixer-gimmick');
                const mixerImg = this.createGimmickElement('mixer');
                mixerImg.style.position = 'absolute';
                mixerImg.style.top = '0';
                mixerImg.style.left = '0';
                mixerImg.style.width = '100%';
                mixerImg.style.height = '200%';
                tile.appendChild(mixerImg);
            } else if (tileType === 'mixer-bot') {
                // Mixer bottom placeholder — transparent; mixer top's image overflows here
                tile.classList.add('mixer-bot-gimmick');
            } else {
                // Chess pattern: alternate land01 / land02 by (row + col) parity
                var landImg = (r + c) % 2 === 0
                    ? 'assets/tiles/land01.png'
                    : 'assets/tiles/land02.png';
                tile.style.backgroundImage = "url('" + landImg + "')";

                // Conveyor rail image overlay
                // Each image extends ±1 px horizontally to cover the 2 px grid gap
                // between adjacent tiles, creating a seamless rail strip.
                if (tileType === 'conveyor-a' || tileType === 'conveyor-a-flip' || tileType === 'conveyor-b') {
                    tile.style.overflow = 'visible';   // allow 1 px bleed over grid gap
                    const gimmickKey = tileType === 'conveyor-b' ? 'conveyor-b' : 'conveyor-a';
                    const railImg = this.createGimmickElement(gimmickKey);
                    railImg.style.position = 'absolute';
                    railImg.style.top = '0';
                    railImg.style.height = '100%';
                    railImg.style.left = '-1px';
                    railImg.style.width = 'calc(100% + 2px)';  // bleed 1 px each side
                    railImg.style.objectFit = 'fill';           // no letterboxing in extended area
                    if (tileType === 'conveyor-a-flip') railImg.style.transform = 'scaleX(-1)';
                    tile.appendChild(railImg);
                }
            }

            this.boardEl.appendChild(tile);
        }
    }

    adjustSize() {
        // ── Reference design: 1080 × 1920 px (9:16) ──────────────────────────
        // Scale is the smaller of the two axis-based factors so all UI panels
        // stay inside the container regardless of the actual aspect ratio.

        const gameContainer = document.querySelector('.game-container');
        const contW = gameContainer.clientWidth;
        const contH = gameContainer.clientHeight;
        const scale = Math.min(contW / 1080, contH / 1920);

        // Invalidate cached tile layout whenever the container is resized.
        this._tileLayoutCache = null;

        // Helper: set a CSS custom property to a pixel value.
        const css = (name, px) =>
            document.documentElement.style.setProperty(name, `${px}px`);

        // ── Position & size UI panels (image natural size × scale) ────────────
        //
        //   Ingame_top.png    1060 × 317  at ref position (10,   40)
        //   Ingame_bottom.png  980 × 338  at ref position (50, 1560)
        //   Block item images  128 × 128  (natural source size)

        css('--header-left', 10 * scale);
        css('--header-top', 40 * scale);
        css('--header-w', 1060 * scale);
        css('--header-h', 317 * scale);
        css('--header-num-size', 100 * scale);   // level / moves number font size

        css('--guide-left', 50 * scale);
        css('--guide-top', 1560 * scale);
        css('--guide-w', 980 * scale);
        css('--guide-h', 338 * scale);
        css('--guide-font-size', 40 * scale);   // guide text font size

        // Board viewport: between header bottom (40+317=357) and guide top (1560)
        const boardAreaTop = (40 + 317) * scale;   // 357 × scale
        const boardAreaH = (1560 - 357) * scale; // 1203 × scale
        css('--board-top', boardAreaTop);
        css('--board-h', boardAreaH);

        // ── Board/frame pixel sizing ──────────────────────────────────────────
        //   land01/02 source : 138 × 138 px
        //   Board.png corner : 105 px (matches border-image-slice in CSS)
        //   K_FRAME = 105/138 ≈ 0.7609
        //
        //   FRAME OVERLAP RULE (seam & margin fix):
        //     #board-frame element is sized (boardW - 2×overlap) so its CSS border
        //     (frameBorder wide) extends INTO the tile area by `overlap` px on every side.
        //     overlap = round(frameBorder × OVERLAP_FACTOR) where OVERLAP_FACTOR > 0.5.
        //     Because #board-frame has z-index:3 (above tiles at z:2), the decorative
        //     corners/edges sit visually over the outermost tile row/column, which:
        //       • eliminates the empty whitespace margin between frame and tile grid
        //       • removes the visible seam line at the frame-tile boundary
        //     All dimensions are Math.floor/round integers → no fractional-pixel seams
        //     inside the grid either.
        //
        //   cell = min(fitCell, refCell×1.1) — consistent tile size across levels.
        //   boardW/H includes the CSS grid gap so each tile is exactly `cell` px.
        const LAND_SRC = 138;
        const CORNER_SRC = 105;
        const K_FRAME = CORNER_SRC / LAND_SRC;   // ≈ 0.7609
        const GRID_GAP = 2;                       // must match CSS gap: 2px
        const OVERLAP_FACTOR = 0.6;               // frame border overlaps tile area by 60 %

        const maxCols = MC.MAX_COLS || 8;
        const maxRows = MC.MAX_ROWS || 9;

        const fitCell = Math.min(
            (contW - GRID_GAP * (this.config.cols - 1)) / (this.config.cols + 2 * K_FRAME),
            (boardAreaH - GRID_GAP * (this.config.rows - 1)) / (this.config.rows + 2 * K_FRAME)
        );
        const refCell = Math.min(
            (contW - GRID_GAP * (maxCols - 1)) / (maxCols + 2 * K_FRAME),
            (boardAreaH - GRID_GAP * (maxRows - 1)) / (maxRows + 2 * K_FRAME)
        ) * 1.1;
        const cell = Math.floor(Math.min(fitCell, refCell));

        // Mission icons match the board block size exactly
        css('--mission-icon-px', cell);

        const frameBorder = Math.round(cell * K_FRAME);
        css('--board-border', frameBorder);

        // Spawn offset: new blocks start at the frame's outer top edge (negative =
        // above board-grid top).  This keeps the fall-in animation within the board
        // frame's visual boundary rather than starting from completely off-screen.
        const frameOverlap = Math.round(frameBorder * OVERLAP_FACTOR);
        this._spawnTopOffset = -(frameBorder - frameOverlap);   // e.g. ≈ -17 px

        // Board pixel size = integer cells + gaps → each grid track is exactly `cell` px
        const boardW = cell * this.config.cols + GRID_GAP * (this.config.cols - 1);
        const boardH = cell * this.config.rows + GRID_GAP * (this.config.rows - 1);

        this.boardEl.style.width = `${boardW}px`;
        this.boardEl.style.height = `${boardH}px`;

        const frame = document.getElementById('board-frame');
        if (frame) {
            // Frame element is inset by frameOverlap on each side so its CSS border
            // (frameBorder wide, box-sizing:content-box) extends INTO the tile area.
            // This places the decorative corners/edges over the outermost tiles,
            // removing the visible gap and seam between the frame and the tile grid.
            const frameOverlap = Math.round(frameBorder * OVERLAP_FACTOR);
            frame.style.width = `${boardW - 2 * frameOverlap}px`;
            frame.style.height = `${boardH - 2 * frameOverlap}px`;
        }

        requestAnimationFrame(() => this.renderBlocks());
    }

    /**
     * Measures the position and size of tiles from the DOM.
     * Returns { tileW, tileH, ox, oy } where ox/oy are the pixel offset
     * of the first tile's top-left corner relative to #board's top-left.
     * This accounts for padding and gap without relying on style parsing.
     */
    _getTileLayout() {
        if (this._tileLayoutCache) return this._tileLayoutCache;

        const boardRect = this.boardEl.getBoundingClientRect();
        const tile0 = this.boardEl.querySelector('.tile[data-index="0"]');
        const tile1 = this.boardEl.querySelector(`.tile[data-index="1"]`);
        const tileRow1 = this.boardEl.querySelector(`.tile[data-index="${this.config.cols}"]`);

        if (!tile0) return null;

        const t0 = tile0.getBoundingClientRect();
        const tileW = tile0.offsetWidth;
        const tileH = tile0.offsetHeight;

        // Gap between tiles (from DOM measurement, not CSS parsing)
        const gapX = tile1 ? tile1.getBoundingClientRect().left - t0.right : 0;
        const gapY = tileRow1 ? tileRow1.getBoundingClientRect().top - t0.bottom : 0;

        // Offset of tile[0] top-left relative to board element top-left
        const ox = t0.left - boardRect.left;
        const oy = t0.top - boardRect.top;

        this._tileLayoutCache = { tileW, tileH, gapX, gapY, ox, oy };
        return this._tileLayoutCache;
    }

    // ── Per-frame rendering ──────────────────────────────────────────────────

    renderBlocks() {
        const layout = this._getTileLayout();
        if (!layout) return;

        const { tileW, tileH, gapX, gapY, ox, oy } = layout;
        const stepX = tileW + gapX;
        const stepY = tileH + gapY;

        const activeIds = new Set(this.board.data.filter(Boolean).map(d => d.id));

        // Remove stale block elements via cached Map (no querySelectorAll needed)
        for (const [id, el] of this._blockEls) {
            if (!activeIds.has(id)) {
                el.remove();
                this._blockEls.delete(id);
            }
        }

        const newBlocks = [];   // newly created elements to animate in

        this.board.data.forEach((data, i) => {
            if (!data) return;

            let el = this._blockEls.get(data.id);
            const isNew = !el;

            if (isNew) {
                el = document.createElement('div');
                el.className = 'block-item';
                el.dataset.id = data.id;
                this.boardEl.appendChild(el);
                this._blockEls.set(data.id, el);
            }

            // Refresh icon only when type/level changed
            if (el.dataset.type !== String(data.type) || el.dataset.level !== String(data.level)) {
                el.dataset.type = data.type;
                el.dataset.level = data.level;
                el.innerHTML = '';
                el.appendChild(this.createItemElement(data.type, data.level));
            }

            const { r, c } = this.board.indexToRC(i);
            el.style.width = `${tileW}px`;
            el.style.height = `${tileH}px`;
            el.style.left = `${ox + c * stepX}px`;

            const targetTop = oy + r * stepY;

            if (isNew && this._mergeSpawn && this._mergeSpawn.id === data.id) {
                // Merged block: spawn at the merge row, not from top
                const mergeTop = oy + this._mergeSpawn.row * stepY;
                this._mergeSpawn = null;
                el.style.transition = 'none';
                el.style.top = `${mergeTop}px`;
                newBlocks.push({ el, targetTop });
            } else if (isNew) {
                // Normal new block: fall from top of board frame
                const spawnTop = oy + (this._spawnTopOffset != null ? this._spawnTopOffset : -tileH);
                el.style.transition = 'none';
                el.style.top = `${spawnTop}px`;
                newBlocks.push({ el, targetTop });
            } else {
                el.style.top = `${targetTop}px`;
            }

            // Keep flying blocks invisible while fly animation runs
            el.style.opacity = this._flyingIds.has(data.id) ? '0' : '';

            el.classList.toggle('selected', this._selectedPath.includes(i));
        });

        // Animate newly spawned blocks falling into place
        if (newBlocks.length > 0) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    newBlocks.forEach(({ el, targetTop }) => {
                        el.style.transition = '';   // restore CSS transition
                        el.style.top = `${targetTop}px`;
                    });
                });
            });
        }
    }

    renderLines() {
        this.svgEl.innerHTML = '';
        if (this._selectedPath.length < 2) return;

        const layout = this._getTileLayout();
        if (!layout) return;

        const { tileW, tileH, gapX, gapY, ox, oy } = layout;
        const stepX = tileW + gapX;
        const stepY = tileH + gapY;

        // SVG is inside #board → ox/oy shift aligns center of each tile
        const points = this._selectedPath.map(idx => {
            const { r, c } = this.board.indexToRC(idx);
            return `${ox + c * stepX + tileW * 0.5},${oy + r * stepY + tileH * 0.5}`;
        }).join(' ');

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        poly.setAttribute('points', points);
        this.svgEl.appendChild(poly);
    }

    updateVisuals() {
        this.renderBlocks();
        this.renderLines();
    }

    // ── HUD ──────────────────────────────────────────────────────────────────

    updateUI(moves, targetCounts) {
        document.getElementById('level-title').innerText = this.levelNum;
        document.getElementById('moves-count').innerText = moves;

        this.missionEl.innerHTML = '';
        this.config.targets.forEach(t => {
            const key = t.gimmick ?? `${t.type}-${t.level}`;
            const remaining = targetCounts[key] ?? 0;

            const badge = document.createElement('div');
            badge.className = `mission-panel ${remaining === 0 ? 'opacity-30' : ''}`;
            badge.dataset.targetKey = key;   // used by animateBlockToMission

            const iconWrap = document.createElement('span');
            iconWrap.className = 'mission-icon-wrap';
            if (t.gimmick) {
                var gData = MC.GIMMICK_DATA[t.gimmick];
                var mSrc = (gData && gData.missionImage) ? gData.missionImage : (gData ? gData.image : '');
                iconWrap.appendChild(this._iconEl(mSrc, gData ? gData.emoji : ''));
            } else {
                iconWrap.appendChild(this.createItemElement(t.type, t.level));
            }

            const count = document.createElement('span');
            count.className = 'mission-count';
            count.textContent = remaining;

            badge.appendChild(iconWrap);
            badge.appendChild(count);
            this.missionEl.appendChild(badge);
        });
    }

    updateGuide(text) {
        document.getElementById('guide-text').innerText = text;
    }

    // ── Overlay ───────────────────────────────────────────────────────────────

    showOverlay(title, msg, btnText) {
        document.getElementById('overlay-title').innerText = title;
        document.getElementById('overlay-msg').innerText = msg;
        document.getElementById('overlay-btn').innerText = btnText;
        document.getElementById('game-overlay').style.display = 'flex';
    }

    hideOverlay() {
        document.getElementById('game-overlay').style.display = 'none';
    }

    // ── Gimmick sync ─────────────────────────────────────────────────────────

    refreshDestroyedBox(idx) {
        const tile = this.boardEl.querySelector(`.tile[data-index="${idx}"]`);
        if (!tile) return;
        tile.classList.remove('box-gimmick');
        tile.innerHTML = '';
    }

    // ── Block fly animation ───────────────────────────────────────────────────

    /**
     * Animates the block at boardIdx flying to the mission badge for targetKey.
     * Spawns particle effects at launch and landing.
     * Calls onComplete when the animation finishes.
     */
    animateBlockToMission(blockIdx, targetKey, onComplete) {
        const gameContainer = document.querySelector('.game-container');
        const containerRect = gameContainer.getBoundingClientRect();

        const data = this.board.data[blockIdx];
        if (!data) { if (onComplete) onComplete(); return; }

        const blockEl = this._blockEls.get(data.id);
        if (!blockEl) { if (onComplete) onComplete(); return; }

        // Hide original; mark as flying so renderBlocks keeps it hidden
        this._flyingIds.add(data.id);
        blockEl.style.opacity = '0';

        // Block's screen-space position → container-local position
        const bRect = blockEl.getBoundingClientRect();
        const size = bRect.width;
        const startX = bRect.left - containerRect.left;
        const startY = bRect.top - containerRect.top;

        // Mission badge target — fall back to header centre if not found
        const badge = this.missionEl.querySelector(`[data-target-key="${targetKey}"]`);
        let endX = (containerRect.width - size) / 2;
        let endY = 20;
        if (badge) {
            const bBadge = badge.getBoundingClientRect();
            endX = bBadge.left - containerRect.left + (bBadge.width - size) / 2;
            endY = bBadge.top - containerRect.top + (bBadge.height - size) / 2;
        }

        // Particles at launch point
        this._spawnParticles(gameContainer, startX + size / 2, startY + size / 2, 8);

        // Create fly element (clone of block)
        const fly = document.createElement('div');
        fly.className = 'block-fly';
        fly.style.left = `${startX}px`;
        fly.style.top = `${startY}px`;
        fly.style.width = `${size}px`;
        fly.style.height = `${size}px`;
        fly.appendChild(this.createItemElement(data.type, data.level));
        gameContainer.appendChild(fly);

        // Cleanup function (guarded against double-call)
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            if (fly.parentNode) fly.remove();
            this._flyingIds.delete(data.id);
            this._spawnParticles(gameContainer, endX + size / 2, endY + size / 2, 12);
            if (onComplete) onComplete();
        };

        // Safety timeout in case transitionend never fires
        const safetyTimer = setTimeout(cleanup, 900);

        fly.addEventListener('transitionend', (e) => {
            if (e.propertyName !== 'left') return;
            clearTimeout(safetyTimer);
            cleanup();
        });

        // Animate after two frames (ensure browser has painted initial position)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                fly.style.left = `${endX}px`;
                fly.style.top = `${endY}px`;
                fly.style.transform = 'scale(0.4)';
                fly.style.opacity = '0';
            });
        });
    }

    /**
     * Spawns particle images at (cx, cy) in game-container coordinate space.
     * Uses Par_01 and Par_02 images from assets/fx/.
     */
    _spawnParticles(container, cx, cy, count) {
        for (let i = 0; i < count; i++) {
            const par = document.createElement('img');
            par.src = (i % 2 === 0) ? 'assets/fx/Par_01.png' : 'assets/fx/Par_02.png';
            par.className = 'particle-fx';

            const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.8;
            const dist = 35 + Math.random() * 55;
            const dx = Math.cos(angle) * dist;
            const dy = Math.sin(angle) * dist;
            const rot = (Math.random() - 0.5) * 480;
            const delay = Math.random() * 80;

            par.style.left = `${cx - 12}px`;
            par.style.top = `${cy - 12}px`;
            par.style.setProperty('--pdx', `${dx}px`);
            par.style.setProperty('--pdy', `${dy}px`);
            par.style.setProperty('--prot', `${rot}deg`);
            par.style.animationDelay = `${delay}ms`;

            container.appendChild(par);
            par.addEventListener('animationend', () => par.remove(), { once: true });
        }
    }
    // ── Box Gimmick Animation ─────────────────────────────────────────────

    /**
     * Animate a box gimmick being activated:
     *   1. Hide the dragged block
     *   2. Swap box image to Gimmick_01_b + scale animation (1→1.5→1)
     *   3. Fly the Gimmick_01_b to mission icon
     *   4. Burst particles at destination
     *   5. Call onComplete
     */
    playBoxAnimation(blockId, boxIdx, onComplete) {
        var self = this;
        var gc = document.querySelector('.game-container');
        var gcRect = gc.getBoundingClientRect();

        // Hide the dragged block element
        var blockEl = this._blockEls.get(blockId);
        if (blockEl) blockEl.style.display = 'none';

        // Find the box tile and its image
        var tile = this.boardEl.querySelector('.tile[data-index="' + boxIdx + '"]');
        if (!tile) { if (onComplete) onComplete(); return; }

        var boxImg = tile.querySelector('.item-img');
        if (!boxImg) { if (onComplete) onComplete(); return; }

        // Phase 1: Swap image to Gimmick_01_b + scale animation
        boxImg.src = 'assets/block/Gimmick_01_b.png';
        tile.classList.add('box-transforming');

        tile.addEventListener('animationend', function onTransformEnd(e) {
            if (e.target !== tile) return;
            tile.removeEventListener('animationend', onTransformEnd);
            tile.classList.remove('box-transforming');

            // Phase 2: Create fly element from box position
            var tileRect = tile.getBoundingClientRect();
            var size = tileRect.width;
            var startX = tileRect.left - gcRect.left;
            var startY = tileRect.top - gcRect.top;

            // Hide box tile content
            tile.style.visibility = 'hidden';

            // Mission badge target
            var badge = self.missionEl.querySelector('[data-target-key="box"]');
            var endX = (gcRect.width - size) / 2;
            var endY = 20;
            if (badge) {
                var bBadge = badge.getBoundingClientRect();
                endX = bBadge.left - gcRect.left + (bBadge.width - size) / 2;
                endY = bBadge.top - gcRect.top + (bBadge.height - size) / 2;
            }

            // Fly element
            var fly = document.createElement('div');
            fly.className = 'block-fly';
            fly.style.left = startX + 'px';
            fly.style.top = startY + 'px';
            fly.style.width = size + 'px';
            fly.style.height = size + 'px';
            var flyImg = document.createElement('img');
            flyImg.src = 'assets/block/Gimmick_01_b.png';
            flyImg.className = 'item-img';
            flyImg.style.width = '100%';
            flyImg.style.height = '100%';
            fly.appendChild(flyImg);
            gc.appendChild(fly);

            var cleaned = false;
            var cleanup = function () {
                if (cleaned) return;
                cleaned = true;
                if (fly.parentNode) fly.remove();
                // Burst at destination
                self._spawnParticles(gc, endX + size / 2, endY + size / 2, 14);
                tile.style.visibility = '';
                if (onComplete) onComplete();
            };

            var safetyTimer = setTimeout(cleanup, 900);
            fly.addEventListener('transitionend', function (e) {
                if (e.propertyName !== 'left') return;
                clearTimeout(safetyTimer);
                cleanup();
            });

            // Animate fly after two frames
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    fly.style.left = endX + 'px';
                    fly.style.top = endY + 'px';
                    fly.style.transform = 'scale(0.4)';
                    fly.style.opacity = '0';
                });
            });
        }, { once: false });
    }

    // ── Merge Animation ──────────────────────────────────────────────────

    /**
     * Animate a 3-block merge:
     *   1. Slide non-target blocks to target (150 ms)
     *   2. Pop new block at target (350 ms) + particle burst
     *   3. Callback fires → game updates data & settles board
     */
    playMergeAnimation(pathIndices, type, level, onComplete) {
        var self = this;
        var boardEl = this.boardEl;
        var gc = document.querySelector('.game-container');
        var board = this.board;
        var targetIdx = pathIndices[pathIndices.length - 1];

        // Find block elements by their data-id (blocks are direct children of #board)
        var blockEls = [];
        var targetEl = null;
        for (var i = 0; i < pathIndices.length; i++) {
            var idx = pathIndices[i];
            var data = board.data[idx];
            if (!data) continue;
            var el = this._blockEls.get(data.id);
            if (!el) continue;
            blockEls.push({ idx: idx, el: el });
            if (idx === targetIdx) targetEl = el;
        }

        if (!targetEl) { onComplete(); return; }

        var gcRect = gc.getBoundingClientRect();
        var targetRect = targetEl.getBoundingClientRect();
        var cx = targetRect.left - gcRect.left + targetRect.width / 2;
        var cy = targetRect.top - gcRect.top + targetRect.height / 2;
        var tileW = targetRect.width;
        var tileH = targetRect.height;

        // Phase 1: Slide non-target blocks toward target (150ms)
        for (var i = 0; i < blockEls.length; i++) {
            var entry = blockEls[i];
            if (entry.idx === targetIdx) continue;

            var rect = entry.el.getBoundingClientRect();
            var dx = targetRect.left - rect.left;
            var dy = targetRect.top - rect.top;

            entry.el.style.transition = 'transform 0.15s ease-in, opacity 0.15s ease-in';
            entry.el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
            entry.el.style.zIndex = '10';
            entry.el.style.opacity = '0.5';
        }

        // Phase 2: After slide → hide old blocks, pop new block, particles
        setTimeout(function () {
            // Hide all path blocks
            for (var i = 0; i < blockEls.length; i++) {
                blockEls[i].el.style.display = 'none';
            }

            // Particle FX at merge center
            self._spawnMergeFX(cx, cy, gc);

            // Pop-in visual for next-level block
            var popEl = null;
            if (level < 3) {
                popEl = document.createElement('div');
                popEl.className = 'merge-pop-block';
                popEl.style.left = (cx - tileW / 2) + 'px';
                popEl.style.top = (cy - tileH / 2) + 'px';
                popEl.style.width = tileW + 'px';
                popEl.style.height = tileH + 'px';

                var icon = self.createItemElement(type, level + 1);
                icon.style.width = '100%';
                icon.style.height = '100%';
                popEl.appendChild(icon);
                gc.appendChild(popEl);
            }

            // Phase 3: After pop → clean up & callback
            setTimeout(function () {
                if (popEl && popEl.parentNode) popEl.remove();
                onComplete();
            }, 350);
        }, 150);
    }

    /** Spawn all merge particle layers defined in MERGE_FX_CONFIG. */
    _spawnMergeFX(cx, cy, container) {
        for (var i = 0; i < MERGE_FX_CONFIG.length; i++) {
            var cfg = MERGE_FX_CONFIG[i];
            if (cfg.type === 'expand') {
                this._spawnMergeExpand(cx, cy, container, cfg);
            } else {
                this._spawnMergeBurst(cx, cy, container, cfg);
            }
        }
    }

    /** Radial burst of particles from center. */
    _spawnMergeBurst(cx, cy, container, cfg) {
        for (var i = 0; i < cfg.count; i++) {
            var p = document.createElement('img');
            p.src = cfg.src;
            p.className = 'merge-particle';

            var angle = (i / cfg.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            var dist = cfg.spread[0] + Math.random() * (cfg.spread[1] - cfg.spread[0]);
            var dx = Math.cos(angle) * dist;
            var dy = Math.sin(angle) * dist;
            var s = cfg.scale[0] + Math.random() * (cfg.scale[1] - cfg.scale[0]);
            var dur = cfg.duration[0] + Math.random() * (cfg.duration[1] - cfg.duration[0]);
            var rot = (Math.random() - 0.5) * 720;
            var a = cfg.opacity[0] + Math.random() * (cfg.opacity[1] - cfg.opacity[0]);

            p.style.left = cx + 'px';
            p.style.top = cy + 'px';
            p.style.setProperty('--dx', dx + 'px');
            p.style.setProperty('--dy', dy + 'px');
            p.style.setProperty('--s0', s.toFixed(2));
            p.style.setProperty('--rot', rot + 'deg');
            p.style.setProperty('--a0', a.toFixed(2));
            p.style.setProperty('--dur', Math.round(dur) + 'ms');
            p.style.setProperty('--delay', cfg.delay + 'ms');
            if (cfg.filter && cfg.filter !== 'none') p.style.filter = cfg.filter;
            if (cfg.blend && cfg.blend !== 'normal') p.style.mixBlendMode = cfg.blend;

            container.appendChild(p);
            p.addEventListener('animationend', function () { this.remove(); }, { once: true });
        }
    }

    /** Single expanding ring/glow from center. */
    _spawnMergeExpand(cx, cy, container, cfg) {
        var p = document.createElement('img');
        p.src = cfg.src;
        p.className = 'merge-expand';

        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--s0', cfg.expandScale[0]);
        p.style.setProperty('--s1', cfg.expandScale[1]);
        p.style.setProperty('--dur', cfg.duration[0] + 'ms');
        p.style.setProperty('--delay', cfg.delay + 'ms');
        if (cfg.filter && cfg.filter !== 'none') p.style.filter = cfg.filter;
        if (cfg.blend && cfg.blend !== 'normal') p.style.mixBlendMode = cfg.blend;

        container.appendChild(p);
        p.addEventListener('animationend', function () { this.remove(); }, { once: true });
    }

    // ── Level Start Popup ─────────────────────────────────────────────────

    showLevelPopup(levelNum, config) {
        var self = this;
        var gc = document.querySelector('.game-container');
        var scale = gc.clientWidth / 1080;

        var existing = document.getElementById('level-overlay');
        if (existing) existing.remove();

        // Overlay (dim background)
        var overlay = document.createElement('div');
        overlay.className = 'level-overlay';
        overlay.id = 'level-overlay';

        // Container — holds popup + button, carries drop-in animation
        var container = document.createElement('div');
        container.className = 'level-popup-container';

        // Popup wrap — full width, image stretches to fill
        var wrap = document.createElement('div');
        wrap.className = 'level-popup-wrap';

        var popupImg = document.createElement('img');
        popupImg.src = 'assets/items/level_popup.png';
        popupImg.className = 'level-popup-img';
        wrap.appendChild(popupImg);

        // Title: "Level N" — white fill + orange outline via text-shadow (16 dirs)
        var titleEl = document.createElement('div');
        titleEl.className = 'level-popup-title';
        titleEl.style.fontSize = Math.round(100 * scale) + 'px';
        var strokePx = Math.round(6 * scale);
        var shadows = [];
        for (var a = 0; a < 16; a++) {
            var rad = a * Math.PI / 8;
            var sx = Math.round(Math.cos(rad) * strokePx);
            var sy = Math.round(Math.sin(rad) * strokePx);
            shadows.push(sx + 'px ' + sy + 'px 0 #e76d18');
        }
        titleEl.style.textShadow = shadows.join(', ');
        titleEl.textContent = 'Level ' + levelNum;
        wrap.appendChild(titleEl);

        // Level info image (level_info_01 ~ level_info_05)
        var infoImg = document.createElement('img');
        infoImg.src = 'assets/items/level_info_0' + levelNum + '.png';
        infoImg.className = 'level-info-img';
        wrap.appendChild(infoImg);

        // Description text
        var descEl = document.createElement('div');
        descEl.className = 'level-popup-desc';
        descEl.textContent = config.title || '';
        descEl.style.fontSize = Math.round(45 * scale) + 'px';
        wrap.appendChild(descEl);

        container.appendChild(wrap);

        // Start button (Btn_Green) — pop-overshoot, appears near end of drop
        var btn = document.createElement('img');
        btn.src = 'assets/items/Btn_Green.png';
        btn.className = 'level-btn';
        btn.addEventListener('click', function () {
            self.hideLevelPopup();
        });
        container.appendChild(btn);

        overlay.appendChild(container);
        gc.appendChild(overlay);
    }

    hideLevelPopup(callback) {
        var overlay = document.getElementById('level-overlay');
        if (!overlay) { if (callback) callback(); return; }

        var container = overlay.querySelector('.level-popup-container');

        // Dim fades + popup drops out
        overlay.classList.add('level-dismissing');
        if (container) container.classList.add('level-dropping-out');

        // Remove after the longer animation completes
        overlay.addEventListener('animationend', function handler(e) {
            if (e.target !== overlay) return;
            overlay.removeEventListener('animationend', handler);
            overlay.remove();
            if (callback) callback();
        });
    }

    // ── Stage-clear presentation ─────────────────────────────────────────

    /**
     * Full-screen clear effect:
     *   T+0.0 s  result_ray scale-in + continuous rotation
     *   T+0.2 s  result_text pop (0→1.5→1) + confetti burst
     *   T+0.5 s  Btn_Green   pop (0→1.5→1)
     *   T+1.5 s  falling confetti from top
     *
     * @param {Function} onBtnClick  called when Btn_Green is tapped
     */
    showClearPresentation(onBtnClick) {
        var self = this;
        var gc = document.querySelector('.game-container');

        var existing = document.getElementById('clear-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.className = 'clear-overlay';
        overlay.id = 'clear-overlay';

        // 1. result_ray — wrapper rotates, screen blend + bloom glow
        var rayWrap = document.createElement('div');
        rayWrap.className = 'clear-ray-wrap';
        var rayGlow = document.createElement('img');
        rayGlow.src = 'assets/fx/result_ray.png';
        rayGlow.className = 'clear-ray-glow';
        rayWrap.appendChild(rayGlow);
        var rayImg = document.createElement('img');
        rayImg.src = 'assets/fx/result_ray.png';
        rayWrap.appendChild(rayImg);
        overlay.appendChild(rayWrap);

        // 2. result_text — pop overshoot at T+0.2 s (CSS animation-delay)
        var textImg = document.createElement('img');
        textImg.src = 'assets/items/result_text.png';
        textImg.className = 'clear-text';
        overlay.appendChild(textImg);

        // 3. Btn_Green — pop overshoot at T+0.5 s (CSS animation-delay)
        var btn = document.createElement('img');
        btn.src = 'assets/items/Btn_Green.png';
        btn.className = 'clear-btn';
        btn.addEventListener('click', function () {
            self.hideClearPresentation();
            if (onBtnClick) onBtnClick();
        });
        overlay.appendChild(btn);

        gc.appendChild(overlay);

        // Confetti burst at T+0.2 s (when result_text appears)
        setTimeout(function () {
            self._spawnClearBurst(overlay);
        }, 200);

        // Falling confetti — continuous from T+1.5 s until presentation ends
        this._clearFallTimer = setTimeout(function () {
            self._spawnClearFall(overlay);
            self._clearFallInterval = setInterval(function () {
                var o = document.getElementById('clear-overlay');
                if (o) self._spawnClearFall(o);
            }, 1200);
        }, 1500);
    }

    hideClearPresentation() {
        clearTimeout(this._clearFallTimer);
        clearInterval(this._clearFallInterval);
        this._clearFallTimer = null;
        this._clearFallInterval = null;
        var el = document.getElementById('clear-overlay');
        if (el) el.remove();
    }

    /** Circular burst of tinted Par_03 confetti at the centre of `container`. */
    _spawnClearBurst(container) {
        var cx = container.clientWidth / 2;
        var cy = container.clientHeight / 2;
        var TINTS = [
            'sepia(1) saturate(5) hue-rotate(330deg) brightness(1.1)',   // red
            'sepia(1) saturate(5) hue-rotate(40deg)  brightness(1.3)',   // yellow
            'sepia(1) saturate(5) hue-rotate(190deg) brightness(1.1)',   // blue
        ];
        var COUNT = 24;

        for (var i = 0; i < COUNT; i++) {
            var p = document.createElement('img');
            p.src = 'assets/fx/Par_03.png';
            p.className = 'confetti-burst';

            var angle = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            var dist = 105 + Math.random() * 165;
            var dx = Math.cos(angle) * dist;
            var dy = Math.sin(angle) * dist;
            var rot = (Math.random() - 0.5) * 720;

            p.style.left = cx + 'px';
            p.style.top = cy + 'px';
            p.style.setProperty('--dx', dx + 'px');
            p.style.setProperty('--dy', dy + 'px');
            p.style.setProperty('--rot', rot + 'deg');
            p.style.setProperty('--delay', (Math.random() * 80) + 'ms');
            p.style.filter = TINTS[i % TINTS.length];

            container.appendChild(p);
            p.addEventListener('animationend', function () { this.remove(); }, { once: true });
        }
    }

    /** Falling confetti (Par_03, multi-colour) from top of the screen. */
    _spawnClearFall(container) {
        var w = container.clientWidth;
        var TINTS = [
            'sepia(1) saturate(5) hue-rotate(330deg) brightness(1.1)',   // red
            'sepia(1) saturate(5) hue-rotate(40deg)  brightness(1.3)',   // yellow
            'sepia(1) saturate(5) hue-rotate(120deg) brightness(1.2)',   // green
            'sepia(1) saturate(5) hue-rotate(190deg) brightness(1.1)',   // blue
            'sepia(1) saturate(5) hue-rotate(280deg) brightness(1.2)',   // purple
        ];
        var COUNT = 35;

        for (var i = 0; i < COUNT; i++) {
            var p = document.createElement('img');
            p.src = 'assets/fx/Par_03.png';
            p.className = 'confetti-fall';

            p.style.left = (-0.05 * w + Math.random() * 1.1 * w) + 'px';
            p.style.top = '-80px';
            p.style.setProperty('--dur', (2.5 + Math.random() * 2) + 's');
            p.style.setProperty('--delay', (Math.random() * 800) + 'ms');
            p.style.setProperty('--rot', ((Math.random() - 0.5) * 720) + 'deg');
            p.style.setProperty('--sway', ((Math.random() - 0.5) * 80) + 'px');
            p.style.setProperty('--scale', (0.5 + Math.random() * 0.5).toFixed(2));
            p.style.filter = TINTS[i % TINTS.length];

            container.appendChild(p);
            p.addEventListener('animationend', function () { this.remove(); }, { once: true });
        }
    }
}

MC.Renderer = Renderer;

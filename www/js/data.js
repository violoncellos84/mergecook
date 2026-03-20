/**
 * data.js — Static game data
 * No imports needed. Exposed via window.MC namespace.
 */
window.MC = window.MC || {};

MC.ITEM_DATA = {
    /** 쿠키류: 쿠키(L1) → 도넛(L2) → 케이크(L3) */
    1: {
        name: '쿠키',
        emoji: ['🍪', '🍩', '🎂'],
        image: [
            'assets/block/Block_1_1.png',
            'assets/block/Block_1_2.png',
            'assets/block/Block_1_3.png',
        ],
    },
    /** 빵류: 빵(L1) → 토스트(L2) → 햄버거(L3) */
    2: {
        name: '빵',
        emoji: ['🍞', '🍞', '🍔'],
        image: [
            'assets/block/Block_2_1.png',
            'assets/block/Block_2_2.png',
            'assets/block/Block_2_3.png',
        ],
    },
    /** 우유류: 우유컵(L1) → 우유병(L2) → 치즈(L3) */
    3: {
        name: '우유',
        emoji: ['🥛', '🍼', '🧀'],
        image: [
            'assets/block/Block_3_1.png',
            'assets/block/Block_3_2.png',
            'assets/block/Block_3_3.png',
        ],
    },
    /** Reserved for future levels */
    4: {
        name: '포도',
        emoji: ['🍇', '🍷', '🍮'],
        image: [
            'assets/block/Block_4_1.png',
            'assets/block/Block_4_2.png',
            'assets/block/Block_4_3.png',
        ],
    },
};

MC.GIMMICK_DATA = {
    box: { emoji: '📦', image: 'assets/block/Gimmick_01.png', missionImage: 'assets/block/Gimmick_01_b.png' },
    mixer: { emoji: '🌪️', image: 'assets/block/Gimmick_02.png' },
    'conveyor-a': { emoji: '→', image: 'assets/block/Gimmick_03_a.png' },
    'conveyor-b': { emoji: '—', image: 'assets/block/Gimmick_03_b.png' },
};

/**
 * conveyorCol  : 0-indexed column for the conveyor belt (level 5)
 * mixerTypes   : item type IDs accepted by the mixer (level 4)
 * guide        : hint text shown at the bottom
 */
MC.LEVELS = {
    1: {
        title: '사과 케이크를 1개만 만들어봐요!',
        rows: 5, cols: 5,
        types: [1, 2],
        moves: 25,
        targets: [{ type: 1, level: 2, count: 5 }],
        guide: '별쿠키를 3개씩 이어볼까요?\n어떤 방향이든 OK!',
    },
    2: {
        title: '치즈와 블루베리 요거트를 만들어 볼까요?',
        rows: 5, cols: 5,
        types: [3, 2],
        moves: 30,
        targets: [
            { type: 3, level: 2, count: 3 },
            { type: 2, level: 3, count: 1 },
        ],
        guide: '우유는 치즈로, 블루베리는 블루베리 요거트로 머지된답니다!',
    },
    3: {
        title: '2등급 재료를 상자에 연결해 보아요!',
        rows: 6, cols: 5,
        types: [1, 2],
        moves: 35,
        targets: [{ gimmick: 'box', count: 10 }],
        hasBoxGimmick: true,
        guide: '도너츠와 블루베리컵을 상자에 넣어보세요!\n별쿠키와 블루베리1개는 포장할 수 없어요',
    },
    4: {
        title: '2등급 우유를 믹서기에 넣어주세요!',
        rows: 6, cols: 6,
        types: [1, 3],
        moves: 40,
        targets: [{ gimmick: 'mixer', count: 5 }],
        hasMixerGimmick: true,
        mixerTypes: [3],
        guide: '2등급 우유병을 인접한 믹서기에 드래그하세요!\n우유잔을 머지하면 우유병이 된답니다',
    },
    5: {
        title: '케이크, 블루베리요거트, 치즈를 각 1개씩 만드세요!',
        rows: 8, cols: 8,
        types: [1, 2, 3],
        moves: 50,
        targets: [
            { type: 1, level: 3, count: 1 },
            { type: 2, level: 3, count: 1 },
            { type: 3, level: 3, count: 1 },
        ],
        hasConveyor: true,
        conveyorRow: 3,   // 0-based row 3 = 1-based row 4
        guide: '3등급 요리를 완성하면 자동으로 수집된답니다!',
    },
};

MC.MAX_LEVEL = Object.keys(MC.LEVELS).length;
MC.MAX_PATH_LEN = 3;

/** Maximum grid dimensions across all levels (used for fixed cell size). */
MC.MAX_COLS = 8;
MC.MAX_ROWS = 9;

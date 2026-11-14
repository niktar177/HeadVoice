'use strict';
const DEG = Math.PI / 180;
const MAX_RES = 256;
const FACE_NAMES = ['top','bottom','right','front','left','back'];
const FACE_UV = {
    base: { top:[8,0], bottom:[16,0], right:[0,8], front:[8,8], left:[16,8], back:[24,8] },
    hat:  { top:[40,0], bottom:[48,0], right:[32,8], front:[40,8], left:[48,8], back:[56,8] }
};
const CUBE_BASE = 4.0;
const CUBE_HAT = 4.35;
const MAX_UNDO = 15;

const DEFAULT_SETTINGS = {
    sensitivity: 1.5,
    thresholds: [15, 30, 45, 60, 75],
    blinkInterval: 5.0,
    rageKey: 'j',
    shakeForce: 8,
    blinkDuration: 300
};

const state = {
    activeTab: 'mouth',
    eyeMaskMode: false,
    blinkOnlyEyes: false,

    originalSkinFaces: null,
    skinFaces: null,
    mouthStages: [],
    blinkStages: [],
    rageStage: null,
    eyeMask: null,

    mouthCount: 6,
    blinkCount: 6,
    hasRage: true,
    hasBody: false,

    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    gridRes: 16,
    tool: 'brush',
    mode: 'view',
    rot: {x: 20 * DEG, y: 15 * DEG, z: 10 * DEG},
    showHat: true,
    showBase: true,
    syncDrawing: false, // <--- Отключено по умолчанию

    hsv: {h:0, s:1, v:1},
    activeStageIdx: 0,
    zoom: 1,
    undoStack: [],
    redoStack: []
};

let mainCanvas, mainCtx, mainImgData;
let painting = null;
let pendingRender = false;
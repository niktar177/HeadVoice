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

// === PNG-модель ===
// Изображение вписывается в холст 256×256 с сохранением пропорций (letterbox).
// pngScale — масштаб внутри холста: 1.0 — вписано по большей стороне,
// 0.25 — четверть размера, 2.0 — увеличено вдвое (края обрезаются холстом).
const PNG_MIN_SCALE    = 0.25;
const PNG_MAX_SCALE    = 2.0;
const PNG_SCALE_STEP   = 0.05;
const PNG_DEFAULT_SCALE= 1.0;

const DEFAULT_SETTINGS = {
    sensitivity: 1.5,
    thresholds: [15, 30, 45, 60, 75],
    blinkInterval: 5.0,
    rageKey: 'j',
    shakeForce: 8,
    blinkDuration: 300
};

const state = {
    // Тип модели:
    //   'minecraft_skin' — стандартный скин 64×64, 3D-куб, 2 слоя (base + hat)
    //   'png'            — произвольное изображение, плоский 2D, 1 слой (base)
    // Определяется автоматически при загрузке RAW.json.
    modelType: 'minecraft_skin',

    // Навигация
    activeTab: 'mouth',
    eyeMaskMode: false,
    blinkOnlyEyes: false,

    // Грани скина (только для modelType === 'minecraft_skin')
    originalSkinFaces: null,
    skinFaces: null,

    // Кадры анимации (используются в обоих режимах)
    mouthStages: [],
    blinkStages: [],
    rageStage: null,
    eyeMask: null,

    // PNG-специфика (только для modelType === 'png')
    pngSourceDims: null,          // { width, height } оригинала — для пропорций
    pngScale: PNG_DEFAULT_SCALE,  // масштаб изображения внутри 256×256 холста

    // Счётчики
    mouthCount: 6,
    blinkCount: 6,
    hasRage: true,
    hasBody: false,

    // Настройки (сохраняются в config.json)
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    gridRes: 16,
    tool: 'brush',
    mode: 'view',
    rot: {x: 20 * DEG, y: 15 * DEG, z: 10 * DEG},
    showHat: true,
    showBase: true,
    syncDrawing: false,

    // Цвет и история
    hsv: {h:0, s:1, v:1},
    activeStageIdx: 0,
    zoom: 1,
    undoStack: [],
    redoStack: []
};

let mainCanvas, mainCtx, mainImgData;
let painting = null;
let pendingRender = false;
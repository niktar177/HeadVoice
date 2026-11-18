'use strict';

let pendingLoadType = null;
let setupPreviewRafId = null;
let setupPreviewRot = { x: 15 * DEG, y: 0, z: 0 };

function loadImageAsync(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

function chooseType(type) {
    pendingLoadType = type;
    stop3DPreview();

    if (type === 'my') {
        document.getElementById('fileInputProject').click();
        return;
    }

    if (type === 'png' || type === 'mc') {
        showPage('page-setup');
        document.querySelector('.setup-actions').style.display = 'none';

        const loadBtn = document.getElementById('btnLoadSkin');
        const modelBox = document.getElementById('model3dBox');
        modelBox.style.opacity = '0.5';
        modelBox.style.padding = '';

        if (type === 'png') {
            loadBtn.querySelector('.title').textContent = 'Загрузить картинку';
            loadBtn.querySelector('.desc').textContent = 'PNG или JPG';
            modelBox.innerHTML = '<div class="icon">🖼️</div><div class="title">Превью</div><div class="desc">(Загрузите картинку)</div>';
        } else {
            loadBtn.querySelector('.title').textContent = 'Загрузить PNG';
            loadBtn.querySelector('.desc').textContent = 'Скин 64x64';
            modelBox.innerHTML = '<div class="icon">🧊</div><div class="title">Готовая 3D</div><div class="desc">(Загрузите скин)</div>';
        }
    }
}

// === Minecraft-скин ===
function loadSkinFromImg(img) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;

    state.modelType = 'minecraft_skin';
    state.skinFaces = makeFacesFromSkin(data);
    state.originalSkinFaces = cloneFaces(state.skinFaces);
    state._pendingPngStage = null;
    state.originalPngStage = null;
    state.pngSourceDims = null;
    state.pngScale = 1.0;

    document.querySelector('.setup-actions').style.display = 'flex';

    const modelBox = document.getElementById('model3dBox');
    modelBox.style.opacity = '1';
    modelBox.style.padding = '10px';
    modelBox.innerHTML = '<canvas id="setupPreviewCanvas" width="140" height="140" style="image-rendering:pixelated; pointer-events:none;"></canvas>';

    start3DPreview();
}

// === PNG-изображение ===
function loadPngFromImg(img) {
    const rect = fitRect(img.width, img.height, MAX_RES, MAX_RES, 1);
    const cv = document.createElement('canvas');
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
    const data = ctx.getImageData(0, 0, MAX_RES, MAX_RES).data;

    const canonical = {
        base: new Uint8ClampedArray(data),
        hat:  new Uint8ClampedArray(MAX_RES * MAX_RES * 4)
    };

    state.modelType = 'png';
    state._pendingPngStage = canonical;
    state.originalPngStage = cloneStage(canonical);
    state.pngSourceDims = { width: img.width, height: img.height };
    state.pngScale = PNG_DEFAULT_SCALE;
    state.skinFaces = null;
    state.originalSkinFaces = null;

    document.querySelector('.setup-actions').style.display = 'flex';

    const modelBox = document.getElementById('model3dBox');
    modelBox.style.opacity = '1';
    modelBox.style.padding = '10px';
    modelBox.innerHTML = '<canvas id="setupPreviewCanvas" width="140" height="140" style="image-rendering:pixelated; pointer-events:none;"></canvas>';

    startPngPreview();
}

function startPngPreview() {
    stop3DPreview();
    const canvas = document.getElementById('setupPreviewCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const stage = state._pendingPngStage;
    if (!stage) return;

    const off = document.createElement('canvas');
    off.width = MAX_RES; off.height = MAX_RES;
    const octx = off.getContext('2d');
    const id = octx.createImageData(MAX_RES, MAX_RES);
    id.data.set(stage.base);
    octx.putImageData(id, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const padding = 10;
    const size = canvas.width - padding * 2;
    ctx.drawImage(off, padding, padding, size, size);
}

function start3DPreview() {
    stop3DPreview();

    const canvas = document.getElementById('setupPreviewCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const offCanvas = document.createElement('canvas');
    offCanvas.width = MAX_RES;
    offCanvas.height = MAX_RES;
    const offCtx = offCanvas.getContext('2d');
    offCtx.imageSmoothingEnabled = false;
    const img = offCtx.createImageData(MAX_RES, MAX_RES);

    const dummyStage = { base: state.skinFaces.front.base, hat: state.skinFaces.front.hat };

    const tick = () => {
        setupPreviewRot.y += 0.02;

        renderHead(img, setupPreviewRot, getFacesForStage(dummyStage));
        offCtx.putImageData(img, 0, 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const padding = 10;
        const size = canvas.width - padding * 2;
        ctx.drawImage(offCanvas, padding, padding, size, size);

        setupPreviewRafId = requestAnimationFrame(tick);
    };
    tick();
}

function stop3DPreview() {
    if (setupPreviewRafId) {
        cancelAnimationFrame(setupPreviewRafId);
        setupPreviewRafId = null;
    }
}

document.getElementById('fileInputSkin').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        if (pendingLoadType === 'png') loadPngFromImg(img);
        else loadSkinFromImg(img);
        URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    e.target.value = '';
});

// === Создание нового проекта ===
function startEditorCreation() {
    stop3DPreview();

    state.mouthCount = parseInt(document.getElementById('mouthCount').value, 10) || 6;
    state.blinkCount = parseInt(document.getElementById('blinkCount').value, 10) || 6;
    state.hasRage = document.getElementById('hasRage').checked;

    const isPng = state.modelType === 'png';
    const pngSource = isPng ? state._pendingPngStage : null;

    state.mouthStages = [];
    for (let i = 0; i < state.mouthCount; i++) {
        const s = makeStage();
        if (isPng) {
            s.base.set(pngSource.base);
        } else {
            s.base.set(state.skinFaces.front.base);
            s.hat.set(state.skinFaces.front.hat);
        }
        state.mouthStages.push(s);
    }

    state.blinkStages = [];
    for (let i = 0; i < state.blinkCount; i++) {
        const s = makeStage();
        if (isPng) {
            s.base.set(pngSource.base);
        } else {
            s.base.set(state.skinFaces.front.base);
            s.hat.set(state.skinFaces.front.hat);
        }
        state.blinkStages.push(s);
    }

    state.rageStage = state.hasRage ? makeStage() : null;
    if (state.rageStage) {
        if (isPng) {
            state.rageStage.base.set(pngSource.base);
        } else {
            state.rageStage.base.set(state.skinFaces.front.base);
            state.rageStage.hat.set(state.skinFaces.front.hat);
        }
    }

    state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
    state.eyeMask.fill(1);

    state.settings.thresholds = [];
    const numThresh = state.mouthCount - 1;
    if (numThresh > 0) {
        const step = 100 / (numThresh + 1);
        for (let i = 1; i <= numThresh; i++) {
            state.settings.thresholds.push(Math.round(i * step));
        }
    }

    state.activeStageIdx = 0;
    state.activeTab = 'mouth';
    state.zoom = 1;

    document.getElementById('settingsHasRage').checked = state.hasRage;
    document.getElementById('tabRageBtn').style.display = state.hasRage ? 'block' : 'none';
    document.getElementById('modelNameInput').value = 'my_model';

    // Скрыть кнопку «Добавить тело» для PNG
    const bodyRow = document.getElementById('settingsHasBody')?.closest('.field-row');
    if (bodyRow) bodyRow.style.display = isPng ? 'none' : '';

    initMainCanvas();
    switchTab('mouth');
    showPage('page-editor');
    updateCanvasZoom();
}

// === Загрузка существующего проекта ===
document.getElementById('fileInputProject').addEventListener('change', async e => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    const rawFile = files.find(f => f.name === 'RAW.json');
    if (!rawFile) {
        alert('Выбрана неверная папка.\nПожалуйста, выберите папку с названием вашей модели (внутри папки models), где лежат RAW и skin.png.');
        e.target.value = '';
        return;
    }

    try {
        const rawText = await rawFile.text();
        const raw = JSON.parse(rawText);
        const modelType = raw.model_type || 'minecraft_skin';

        if (modelType === 'png') {
            await loadPngProject(files, raw);
        } else {
            await loadSkinProject(files, raw);
        }

        e.target.value = '';
        alert('Проект успешно загружен!');
    } catch (err) {
        console.error(err);
        alert('Ошибка при загрузке проекта: ' + err.message);
        e.target.value = '';
    }
});

async function loadStageFromFile(baseFile, hatFile) {
    const loadLayer = async (file) => {
        if (!file) return new Uint8ClampedArray(MAX_RES * MAX_RES * 4);
        const url = URL.createObjectURL(file);
        try {
            const img = await loadImageAsync(url);
            const cv = document.createElement('canvas');
            cv.width = MAX_RES; cv.height = MAX_RES;
            const cctx = cv.getContext('2d');
            cctx.imageSmoothingEnabled = false;
            cctx.drawImage(img, 0, 0);
            return new Uint8ClampedArray(cctx.getImageData(0, 0, MAX_RES, MAX_RES).data);
        } finally {
            URL.revokeObjectURL(url);
        }
    };
    const base = await loadLayer(baseFile);
    const hat = await loadLayer(hatFile);
    return { base, hat };
}

async function loadPngProject(files, raw) {
    state.modelType = 'png';
    state.skinFaces = null;
    state.originalSkinFaces = null;

    // source.png — оригинал для restore. Опционально.
    const sourceFile = files.find(f => f.name === 'source.png');
    if (sourceFile) {
        const url = URL.createObjectURL(sourceFile);
        try {
            const srcImg = await loadImageAsync(url);
            const rect = fitRect(srcImg.width, srcImg.height, MAX_RES, MAX_RES, 1);
            const cv = document.createElement('canvas');
            cv.width = MAX_RES; cv.height = MAX_RES;
            const ctx = cv.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(srcImg, rect.x, rect.y, rect.w, rect.h);
            const data = ctx.getImageData(0, 0, MAX_RES, MAX_RES).data;
            state.originalPngStage = {
                base: new Uint8ClampedArray(data),
                hat:  new Uint8ClampedArray(MAX_RES * MAX_RES * 4)
            };
            if (!raw.png_source_dims) {
                raw.png_source_dims = { width: srcImg.width, height: srcImg.height };
            }
        } finally {
            URL.revokeObjectURL(url);
        }
    } else {
        state.originalPngStage = null;
    }

    state.pngSourceDims = raw.png_source_dims || null;
    state.pngScale = (typeof raw.png_scale === 'number' && raw.png_scale > 0) ? raw.png_scale : PNG_DEFAULT_SCALE;

    // Стадии
    const mouthFiles = files
        .filter(f => /^\d+\.png$/.test(f.name) && f.webkitRelativePath.includes('/mouth/'))
        .sort((a, b) => parseInt(a.name) - parseInt(b.name));
    const eyeFiles = files
        .filter(f => /^\d+\.png$/.test(f.name) && f.webkitRelativePath.includes('/eyes/'))
        .sort((a, b) => parseInt(a.name) - parseInt(b.name));
    const rageFile = files.find(f => f.name === 'rage.png');

    state.mouthStages = await Promise.all(mouthFiles.map(f => loadStageFromFile(f, null)));
    state.blinkStages = await Promise.all(eyeFiles.map(f => loadStageFromFile(f, null)));
    state.rageStage = rageFile ? await loadStageFromFile(rageFile, null) : null;

    if (state.mouthStages.length === 0) {
        alert('В выбранной папке не найдены кадры рта (RAW/mouth).');
        return;
    }

    // Настройки
    state.hasRage = (raw.has_rage ?? true) && !!state.rageStage;
    state.hasBody = false;
    state.settings = raw.settings || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    const cfgFile = files.find(f => f.name === 'config.json');
    if (cfgFile) {
        const cfg = JSON.parse(await cfgFile.text());
        state.settings.sensitivity   = cfg.sensitivity   ?? state.settings.sensitivity;
        state.settings.thresholds    = cfg.thresholds    ?? state.settings.thresholds;
        state.settings.blinkInterval = cfg.blink_interval ?? state.settings.blinkInterval;
        state.settings.rageKey       = cfg.rage_key      ?? state.settings.rageKey;
        state.settings.shakeForce    = cfg.shake_force   ?? state.settings.shakeForce;
        state.settings.blinkDuration = cfg.blink_duration ?? state.settings.blinkDuration;
        state.blinkOnlyEyes          = cfg.blink_only_eyes ?? false;
        if (typeof cfg.png_scale === 'number' && cfg.png_scale > 0) {
            state.pngScale = cfg.png_scale;
        }
    }

    // Маска
    const maskFile = files.find(f => f.name === 'mask.png');
    if (maskFile) {
        const url = URL.createObjectURL(maskFile);
        try {
            const maskImg = await loadImageAsync(url);
            const mc = document.createElement('canvas');
            mc.width = MAX_RES; mc.height = MAX_RES;
            const mctx = mc.getContext('2d');
            mctx.drawImage(maskImg, 0, 0);
            const mdata = mctx.getImageData(0, 0, MAX_RES, MAX_RES).data;
            state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
            for (let i = 0; i < MAX_RES * MAX_RES; i++) {
                state.eyeMask[i] = mdata[i * 4 + 3] > 0 ? 1 : 0;
            }
        } finally {
            URL.revokeObjectURL(url);
        }
    } else {
        state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
        state.eyeMask.fill(1);
    }

    state.activeStageIdx = 0;
    state.activeTab = 'mouth';
    state.zoom = 1;

    const pathParts = files[0].webkitRelativePath.split('/');
    const modelName = pathParts.length > 1 ? pathParts[0] : 'my_model';
    document.getElementById('modelNameInput').value = modelName;

    document.getElementById('settingsHasRage').checked = state.hasRage;
    document.getElementById('tabRageBtn').style.display = state.hasRage ? 'block' : 'none';

    document.getElementById('testSens').value = Math.round(state.settings.sensitivity * 100);
    document.getElementById('vSens').textContent = state.settings.sensitivity.toFixed(1);
    document.getElementById('testBlinkFreq').value = Math.round(state.settings.blinkInterval * 10);
    document.getElementById('vBlinkFreq').textContent = state.settings.blinkInterval.toFixed(1);
    document.getElementById('testBlinkDur').value = state.settings.blinkDuration;
    document.getElementById('vBlinkDur').textContent = state.settings.blinkDuration;
    document.getElementById('testShake').value = state.settings.shakeForce;
    document.getElementById('vShake').textContent = state.settings.shakeForce;
    document.getElementById('testRageKey').value = state.settings.rageKey;

    const bodyRow = document.getElementById('settingsHasBody')?.closest('.field-row');
    if (bodyRow) bodyRow.style.display = 'none';

    initMainCanvas();
    switchTab('mouth');
    showPage('page-editor');
    updateCanvasZoom();
}

async function loadSkinProject(files, raw) {
    const skinFile = files.find(f => f.name === 'skin.png');
    if (!skinFile) {
        alert('В проекте нет skin.png — это обязательный файл.');
        return;
    }

    state.modelType = 'minecraft_skin';
    state._pendingPngStage = null;
    state.originalPngStage = null;
    state.pngSourceDims = null;
    state.pngScale = 1.0;

    const url = URL.createObjectURL(skinFile);
    try {
        const skinImg = await loadImageAsync(url);
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(skinImg, 0, 0);
        const skinData = ctx.getImageData(0, 0, 64, 64).data;
        state.skinFaces = makeFacesFromSkin(skinData);
        state.originalSkinFaces = cloneFaces(state.skinFaces);
    } finally {
        URL.revokeObjectURL(url);
    }

    state.rot = raw.rotations || state.rot;
    state.hasRage = raw.has_rage ?? true;
    state.hasBody = raw.has_body ?? false;
    state.settings = raw.settings || JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

    const cfgFile = files.find(f => f.name === 'config.json');
    if (cfgFile) {
        const cfg = JSON.parse(await cfgFile.text());
        state.settings.sensitivity   = cfg.sensitivity   ?? state.settings.sensitivity;
        state.settings.thresholds    = cfg.thresholds    ?? state.settings.thresholds;
        state.settings.blinkInterval = cfg.blink_interval ?? state.settings.blinkInterval;
        state.settings.rageKey       = cfg.rage_key      ?? state.settings.rageKey;
        state.settings.shakeForce    = cfg.shake_force   ?? state.settings.shakeForce;
        state.settings.blinkDuration = cfg.blink_duration ?? state.settings.blinkDuration;
        state.blinkOnlyEyes          = cfg.blink_only_eyes ?? false;
    }

    const maskFile = files.find(f => f.name === 'mask.png');
    if (maskFile) {
        const murl = URL.createObjectURL(maskFile);
        try {
            const maskImg = await loadImageAsync(murl);
            const mc = document.createElement('canvas');
            mc.width = MAX_RES; mc.height = MAX_RES;
            const mctx = mc.getContext('2d');
            mctx.drawImage(maskImg, 0, 0);
            const mdata = mctx.getImageData(0, 0, MAX_RES, MAX_RES).data;
            state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
            for (let i = 0; i < MAX_RES * MAX_RES; i++) {
                state.eyeMask[i] = mdata[i * 4 + 3] > 0 ? 1 : 0;
            }
        } finally {
            URL.revokeObjectURL(murl);
        }
    } else {
        state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
        state.eyeMask.fill(1);
    }

    const findHatFile = (baseFile, folder) => {
        const hatName = baseFile.name.replace('.png', '_hat.png');
        return files.find(f => f.name === hatName && f.webkitRelativePath.includes('/' + folder + '/'));
    };

    const mouthFiles = files
        .filter(f => /^\d+\.png$/.test(f.name) && !f.name.includes('_hat') && f.webkitRelativePath.includes('/mouth/'))
        .sort((a, b) => parseInt(a.name) - parseInt(b.name));
    const eyeFiles = files
        .filter(f => /^\d+\.png$/.test(f.name) && !f.name.includes('_hat') && f.webkitRelativePath.includes('/eyes/'))
        .sort((a, b) => parseInt(a.name) - parseInt(b.name));
    const rageFile = files.find(f => f.name === 'rage.png');
    const rageHatFile = files.find(f => f.name === 'rage_hat.png');

    state.mouthStages = await Promise.all(mouthFiles.map(f => loadStageFromFile(f, findHatFile(f, 'mouth'))));
    state.blinkStages = await Promise.all(eyeFiles.map(f => loadStageFromFile(f, findHatFile(f, 'eyes'))));
    state.rageStage = rageFile ? await loadStageFromFile(rageFile, rageHatFile) : null;

    if (state.mouthStages.length === 0) {
        alert('В выбранной папке не найдены кадры рта (RAW/mouth).');
        return;
    }

    state.activeStageIdx = 0;
    state.activeTab = 'mouth';
    state.zoom = 1;

    const pathParts = files[0].webkitRelativePath.split('/');
    const modelName = pathParts.length > 1 ? pathParts[0] : 'my_model';
    document.getElementById('modelNameInput').value = modelName;

    document.getElementById('settingsHasRage').checked = state.hasRage;
    document.getElementById('tabRageBtn').style.display = state.hasRage ? 'block' : 'none';

    document.getElementById('testSens').value = Math.round(state.settings.sensitivity * 100);
    document.getElementById('vSens').textContent = state.settings.sensitivity.toFixed(1);
    document.getElementById('testBlinkFreq').value = Math.round(state.settings.blinkInterval * 10);
    document.getElementById('vBlinkFreq').textContent = state.settings.blinkInterval.toFixed(1);
    document.getElementById('testBlinkDur').value = state.settings.blinkDuration;
    document.getElementById('vBlinkDur').textContent = state.settings.blinkDuration;
    document.getElementById('testShake').value = state.settings.shakeForce;
    document.getElementById('vShake').textContent = state.settings.shakeForce;
    document.getElementById('testRageKey').value = state.settings.rageKey;

    const bodyRow = document.getElementById('settingsHasBody')?.closest('.field-row');
    if (bodyRow) bodyRow.style.display = '';

    initMainCanvas();
    switchTab('mouth');
    showPage('page-editor');
    updateCanvasZoom();
}
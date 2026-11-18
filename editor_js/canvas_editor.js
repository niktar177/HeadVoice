'use strict';

function initMainCanvas() {
    mainCanvas = document.getElementById('mainCanvas');
    mainCtx = mainCanvas.getContext('2d');
    mainCtx.imageSmoothingEnabled = false;
    mainImgData = mainCtx.createImageData(MAX_RES, MAX_RES);

    mainCanvas.addEventListener('pointerdown', e => {
        if (state.mode !== 'edit') return;
        if (state.activeTab === 'settings') return;
        if (state.activeTab === 'rage' && !state.hasRage) return;

        const isMask = (state.activeTab === 'eyes' && state.eyeMaskMode);

        if (state.tool === 'picker' && !isMask) {
            pickColor(e);
            return;
        }

        e.preventDefault();
        mainCanvas.setPointerCapture(e.pointerId);
        pushUndo();

        painting = { last: null, isMask };
        paintFromEvent(e);
    });

    mainCanvas.addEventListener('pointermove', e => {
        if (!painting) return;
        e.preventDefault();
        paintFromEvent(e);
    });

    mainCanvas.addEventListener('pointerup', () => painting = null);
    mainCanvas.addEventListener('pointercancel', () => painting = null);

    mainCanvas.addEventListener('wheel', e => {
        if (e.ctrlKey) {
            e.preventDefault();
            if (e.deltaY < 0) state.zoom = Math.min(5, state.zoom + 0.1);
            else state.zoom = Math.max(0.5, state.zoom - 0.1);
            updateCanvasZoom();
        } else {
            const stages = currentStages();
            if (stages.length <= 1 || state.activeTab === 'settings') return;
            e.preventDefault();
            if (e.deltaY > 0) {
                state.activeStageIdx = Math.min(stages.length - 1, state.activeStageIdx + 1);
            } else {
                state.activeStageIdx = Math.max(0, state.activeStageIdx - 1);
            }
            buildRightPanel();
            renderAll();
        }
    }, { passive: false });
}

function updateCanvasZoom() {
    mainCanvas.style.transform = `scale(${state.zoom})`;
}

// Пересчёт визуальной координаты (0..MAX_RES) в каноническую с учётом pngScale.
// Для Minecraft — тождественно. Для PNG при scale=1 — тоже тождественно.
function _visToCanon(v) {
    if (state.modelType !== 'png' || state.pngScale === 1) return v;
    const mid = MAX_RES / 2;
    const inv = 1 / state.pngScale;
    return (v - mid) * inv + mid;
}

// Размер блока в каноническом пространстве при визуальном размере vBlock.
function _visBlockToCanon(vBlock) {
    if (state.modelType !== 'png' || state.pngScale === 1) return vBlock;
    return vBlock / state.pngScale;
}

function renderEyesView(imgData, baseStage, blinkStage, useMask, rot) {
    let finalBase = baseStage;

    // Minecraft: притеняем области вне маски, чтобы подсветить редактируемую зону.
    // PNG: маска накладывается на overlay ниже.
    if (useMask && state.modelType !== 'png') {
        finalBase = cloneStage(baseStage);
        for (let i = 0; i < MAX_RES * MAX_RES; i++) {
            if (!state.eyeMask[i]) {
                const o = i * 4;
                if (finalBase.base[o+3] > 0) {
                    finalBase.base[o]   = Math.floor(finalBase.base[o] * 0.3);
                    finalBase.base[o+1] = Math.floor(finalBase.base[o+1] * 0.3);
                    finalBase.base[o+2] = Math.floor(finalBase.base[o+2] * 0.3);
                }
                if (finalBase.hat[o+3] > 0) {
                    finalBase.hat[o]   = Math.floor(finalBase.hat[o] * 0.3);
                    finalBase.hat[o+1] = Math.floor(finalBase.hat[o+1] * 0.3);
                    finalBase.hat[o+2] = Math.floor(finalBase.hat[o+2] * 0.3);
                }
            }
        }
    }

    if (rot) {
        // Minecraft 3D-рендер
        renderHead(imgData, rot, getFacesForStage(finalBase));
        if (blinkStage) {
            const overlayImg = new ImageData(new Uint8ClampedArray(MAX_RES * MAX_RES * 4), MAX_RES, MAX_RES);
            renderHead(overlayImg, rot, makeEyeOverlayFaces(blinkStage, useMask));
            for (let i = 0; i < imgData.data.length; i += 4) {
                if (overlayImg.data[i+3] > 0) {
                    imgData.data[i]   = overlayImg.data[i];
                    imgData.data[i+1] = overlayImg.data[i+1];
                    imgData.data[i+2] = overlayImg.data[i+2];
                    imgData.data[i+3] = overlayImg.data[i+3];
                }
            }
        }
    } else {
        // Плоский: Minecraft в режиме edit, PNG всегда
        renderFlatFace(imgData, finalBase, 'mouth');
        if (blinkStage) {
            const overlayImg = new ImageData(new Uint8ClampedArray(MAX_RES * MAX_RES * 4), MAX_RES, MAX_RES);
            renderFlatFace(overlayImg, blinkStage, 'mouth');
            for (let i = 0; i < imgData.data.length; i += 4) {
                if (useMask && !state.eyeMask[i >> 2]) continue; // i — байт, маска — пиксель
                if (overlayImg.data[i+3] > 0) {
                    imgData.data[i]   = overlayImg.data[i];
                    imgData.data[i+1] = overlayImg.data[i+1];
                    imgData.data[i+2] = overlayImg.data[i+2];
                    imgData.data[i+3] = overlayImg.data[i+3];
                }
            }
        }
    }
}

function renderAll() {
    if (!mainCtx) return;

    if (state.activeTab === 'settings') {
        renderProgramPreview();
        return;
    }

    // PNG-маска: временно scale=1, чтобы маска (в каноническом пространстве)
    // точно ложилась на изображение. После рендера восстанавливаем.
    const savedScale = state.pngScale;
    const maskScaleOverride = (state.modelType === 'png' && state.eyeMaskMode && state.activeTab === 'eyes');
    if (maskScaleOverride) state.pngScale = 1;

    try {
        if (state.activeTab === 'eyes' && state.eyeMaskMode) {
            const stage = currentStages()[state.activeStageIdx] || state.mouthStages[0];
            renderFlatFace(mainImgData, stage, 'mouth');
            for (let i = 0; i < MAX_RES * MAX_RES; i++) {
                const o = i * 4;
                if (state.eyeMask[i]) {
                    mainImgData.data[o]   = (mainImgData.data[o] + 255) / 2;
                    mainImgData.data[o+1] = mainImgData.data[o+1] / 2;
                    mainImgData.data[o+2] = (mainImgData.data[o+2] + 128) / 2;
                }
            }
            mainCtx.putImageData(mainImgData, 0, 0);
            if (state.mode === 'edit') {
                drawGridOverlay(mainCtx, state.gridRes);
            }
            return;
        }

        const stages = currentStages();
        const stage = stages[state.activeStageIdx];
        if (!stage) return;

        if (state.activeTab === 'eyes') {
            const baseStage = state.mouthStages[0];
            const rot = (state.modelType === 'png') ? null : (state.mode === 'view' ? state.rot : null);
            renderEyesView(mainImgData, baseStage, stage, state.blinkOnlyEyes ? state.eyeMask : null, rot);
        } else if (state.mode === 'edit' || state.modelType === 'png') {
            renderFlatFace(mainImgData, stage, state.activeTab);
        } else {
            renderHead(mainImgData, state.rot, getFacesForStage(stage));
        }

        mainCtx.putImageData(mainImgData, 0, 0);

        if (state.mode === 'edit' || state.modelType === 'png') {
            drawGridOverlay(mainCtx, state.gridRes);
        }
    } finally {
        if (maskScaleOverride) state.pngScale = savedScale;
    }
}

function renderProgramPreview() {
    const baseStage = state.mouthStages[0];
    if (!baseStage) return;

    renderHead(mainImgData, state.rot, getFacesForStage(baseStage));

    if (state.blinkStages.length > 0) {
        const overlayImg = mainCtx.createImageData(MAX_RES, MAX_RES);
        renderHead(overlayImg, state.rot, makeEyeOverlayFaces(state.blinkStages[0], state.blinkOnlyEyes ? state.eyeMask : null));
        for (let i = 0; i < mainImgData.data.length; i += 4) {
            if (overlayImg.data[i+3] > 0) {
                mainImgData.data[i]   = overlayImg.data[i];
                mainImgData.data[i+1] = overlayImg.data[i+1];
                mainImgData.data[i+2] = overlayImg.data[i+2];
                mainImgData.data[i+3] = overlayImg.data[i+3];
            }
        }
    }
    mainCtx.putImageData(mainImgData, 0, 0);
}

function paintFromEvent(e) {
    if (!painting) return;
    const rect = mainCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;

    if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) {
        painting.last = null;
        return;
    }

    // Визуальные координаты (0..MAX_RES), затем в каноническое пространство слоя
    const vx = nx * MAX_RES;
    const vy = ny * MAX_RES;
    const cx = _visToCanon(vx);
    const cy = _visToCanon(vy);
    const vBlock = MAX_RES / state.gridRes;
    const cBlock = _visBlockToCanon(vBlock);

    if (painting.isMask) {
        applyMaskBrush(cx, cy, cBlock);
        painting.last = null;
    } else {
        const layer = activeLayer();
        if (!layer) return;

        const hit = { cx, cy, cBlock, layer };
        if (painting.last && painting.last.layer === hit.layer) {
            paintLine(painting.last, hit);
        } else {
            applyBrush(hit.layer, hit.cx, hit.cy, hit.cBlock);
        }
        painting.last = hit;
    }
    requestRender();
}

function applyMaskBrush(cx, cy, block) {
    const x0 = Math.max(0, Math.floor(cx - block / 2));
    const y0 = Math.max(0, Math.floor(cy - block / 2));
    const x1 = Math.min(MAX_RES, Math.ceil(cx + block / 2));
    const y1 = Math.min(MAX_RES, Math.ceil(cy + block / 2));
    const val = (state.tool === 'erase') ? 0 : 1;
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
            state.eyeMask[y * MAX_RES + x] = val;
        }
    }
}

function applyBrush(layer, cx, cy, block) {
    const stages = currentStages();
    const idx = state.activeStageIdx;

    if (state.syncDrawing && state.activeTab !== 'rage') {
        for (let i = 0; i < stages.length; i++) _applyBrush(i, layer, cx, cy, block);
    } else {
        _applyBrush(idx, layer, cx, cy, block);
    }
}

function _applyBrush(viewIdx, layer, cx, cy, block) {
    if (state.tool === 'restore') restoreBlock(viewIdx, layer, cx, cy, block);
    else if (state.tool === 'erase') eraseBlock(viewIdx, layer, cx, cy, block);
    else paintBlock(viewIdx, layer, cx, cy, block);
}

function paintBlock(viewIdx, layer, cx, cy, block) {
    const stage = currentStages()[viewIdx];
    if (!stage) return;
    const rgb = hsvToRgb(state.hsv.h, state.hsv.s, state.hsv.v);
    const tex = stage[layer];
    const x0 = Math.max(0, Math.floor(cx - block / 2));
    const y0 = Math.max(0, Math.floor(cy - block / 2));
    const x1 = Math.min(MAX_RES, Math.ceil(cx + block / 2));
    const y1 = Math.min(MAX_RES, Math.ceil(cy + block / 2));
    for (let y = y0; y < y1; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x1; x++) {
            tex[o] = rgb[0]; tex[o+1] = rgb[1]; tex[o+2] = rgb[2]; tex[o+3] = 255;
            o += 4;
        }
    }
}

function eraseBlock(viewIdx, layer, cx, cy, block) {
    const stage = currentStages()[viewIdx];
    if (!stage) return;
    const tex = stage[layer];
    const x0 = Math.max(0, Math.floor(cx - block / 2));
    const y0 = Math.max(0, Math.floor(cy - block / 2));
    const x1 = Math.min(MAX_RES, Math.ceil(cx + block / 2));
    const y1 = Math.min(MAX_RES, Math.ceil(cy + block / 2));
    for (let y = y0; y < y1; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x1; x++) {
            tex[o] = 0; tex[o+1] = 0; tex[o+2] = 0; tex[o+3] = 0;
            o += 4;
        }
    }
}

function restoreBlock(viewIdx, layer, cx, cy, block) {
    const stage = currentStages()[viewIdx];
    if (!stage) return;

    // PNG: восстанавливаем из оригинала (см. file_loader.js)
    if (state.modelType === 'png') {
        if (!state.originalPngStage) return;
        const src = state.originalPngStage.base;
        const dst = stage.base;
        const x0 = Math.max(0, Math.floor(cx - block / 2));
        const y0 = Math.max(0, Math.floor(cy - block / 2));
        const x1 = Math.min(MAX_RES, Math.ceil(cx + block / 2));
        const y1 = Math.min(MAX_RES, Math.ceil(cy + block / 2));
        for (let y = y0; y < y1; y++) {
            let o = (y * MAX_RES + x0) * 4;
            for (let x = x0; x < x1; x++) {
                dst[o] = src[o]; dst[o+1] = src[o+1]; dst[o+2] = src[o+2]; dst[o+3] = src[o+3];
                o += 4;
            }
        }
        return;
    }

    // Minecraft: восстанавливаем из оригинального скина
    if (!state.originalSkinFaces) return;
    const tex = stage[layer];
    const otex = state.originalSkinFaces.front[layer];
    const x0 = Math.max(0, Math.floor(cx - block / 2));
    const y0 = Math.max(0, Math.floor(cy - block / 2));
    const x1 = Math.min(MAX_RES, Math.ceil(cx + block / 2));
    const y1 = Math.min(MAX_RES, Math.ceil(cy + block / 2));
    for (let y = y0; y < y1; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x1; x++) {
            tex[o] = otex[o]; tex[o+1] = otex[o+1]; tex[o+2] = otex[o+2]; tex[o+3] = otex[o+3];
            o += 4;
        }
    }
}

function paintLine(a, b) {
    let x0 = Math.round(a.cx), y0 = Math.round(a.cy);
    const x1 = Math.round(b.cx), y1 = Math.round(b.cy);
    const block = b.cBlock;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        applyBrush(a.layer, x0, y0, block);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
    }
}

function requestRender() {
    if (pendingRender) return;
    pendingRender = true;
    requestAnimationFrame(() => {
        pendingRender = false;
        renderAll();
    });
}

function pickColor(e) {
    const rect = mainCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return;

    const vx = nx * MAX_RES;
    const vy = ny * MAX_RES;
    const cx = _visToCanon(vx);
    const cy = _visToCanon(vy);
    const px = Math.min(MAX_RES - 1, Math.max(0, Math.floor(cx)));
    const py = Math.min(MAX_RES - 1, Math.max(0, Math.floor(cy)));

    const stage = currentStages()[state.activeStageIdx];
    const layer = activeLayer();
    if (!stage || !layer) return;

    const tex = stage[layer];
    const o = (py * MAX_RES + px) * 4;

    if (tex[o+3] > 0) {
        state.hsv = rgbToHsv(tex[o], tex[o+1], tex[o+2]);
        updateColorUI();
    }
}
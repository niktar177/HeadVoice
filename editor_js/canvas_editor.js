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

function renderEyesView(imgData, baseStage, blinkStage, useMask, rot) {
    let finalBase = baseStage;

    if (useMask) {
        finalBase = cloneStage(baseStage);
        for (let i = 0; i < MAX_RES * MAX_RES; i++) {
            if (!state.eyeMask[i]) {
                const o = i * 4;
                if (finalBase.base[o+3] > 0) {
                    finalBase.base[o] = Math.floor(finalBase.base[o] * 0.3);
                    finalBase.base[o+1] = Math.floor(finalBase.base[o+1] * 0.3);
                    finalBase.base[o+2] = Math.floor(finalBase.base[o+2] * 0.3);
                }
                if (finalBase.hat[o+3] > 0) {
                    finalBase.hat[o] = Math.floor(finalBase.hat[o] * 0.3);
                    finalBase.hat[o+1] = Math.floor(finalBase.hat[o+1] * 0.3);
                    finalBase.hat[o+2] = Math.floor(finalBase.hat[o+2] * 0.3);
                }
            }
        }
    }

    if (rot) {
        renderHead(imgData, rot, getFacesForStage(finalBase));
        if (blinkStage) {
            const overlayImg = new ImageData(new Uint8ClampedArray(MAX_RES * MAX_RES * 4), MAX_RES, MAX_RES);
            renderHead(overlayImg, rot, makeEyeOverlayFaces(blinkStage, useMask));
            for (let i = 0; i < imgData.data.length; i += 4) {
                if (overlayImg.data[i+3] > 0) {
                    imgData.data[i] = overlayImg.data[i];
                    imgData.data[i+1] = overlayImg.data[i+1];
                    imgData.data[i+2] = overlayImg.data[i+2];
                    imgData.data[i+3] = overlayImg.data[i+3];
                }
            }
        }
    } else {
        renderFlatFace(imgData, finalBase, 'mouth');
        if (blinkStage) {
            const overlayImg = new ImageData(new Uint8ClampedArray(MAX_RES * MAX_RES * 4), MAX_RES, MAX_RES);
            renderFlatFace(overlayImg, blinkStage, 'mouth');
            for (let i = 0; i < imgData.data.length; i += 4) {
                if (useMask && !state.eyeMask[i]) continue;
                if (overlayImg.data[i+3] > 0) {
                    imgData.data[i] = overlayImg.data[i];
                    imgData.data[i+1] = overlayImg.data[i+1];
                    imgData.data[i+2] = overlayImg.data[i+2];
                    imgData.data[i+3] = overlayImg.data[i+3];
                }
            }
        }
    }
}

function renderAll() {
    if (!state.skinFaces || !mainCtx) return;

    if (state.activeTab === 'settings') {
        renderProgramPreview();
        return;
    }

    // Рендер маски
    if (state.activeTab === 'eyes' && state.eyeMaskMode) {
        renderFlatFace(mainImgData, state.skinFaces.front, 'mouth');
        for (let i = 0; i < MAX_RES * MAX_RES; i++) {
            const o = i * 4;
            if (state.eyeMask[i]) {
                mainImgData.data[o] = (mainImgData.data[o] + 255) / 2;
                mainImgData.data[o+1] = mainImgData.data[o+1] / 2;
                mainImgData.data[o+2] = (mainImgData.data[o+2] + 128) / 2;
            }
        }
        mainCtx.putImageData(mainImgData, 0, 0);

        // Возвращаем сетку в режим маски!
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
        const rot = state.mode === 'view' ? state.rot : null;
        renderEyesView(mainImgData, baseStage, stage, state.blinkOnlyEyes ? state.eyeMask : null, rot);
    } else if (state.mode === 'edit') {
        renderFlatFace(mainImgData, stage, state.activeTab);
    } else {
        renderHead(mainImgData, state.rot, getFacesForStage(stage));
    }

    mainCtx.putImageData(mainImgData, 0, 0);

    if (state.mode === 'edit') {
        drawGridOverlay(mainCtx, state.gridRes);
    }
}

function renderProgramPreview() {
    const baseStage = state.mouthStages[0];
    if (!baseStage) return;

    renderHead(mainImgData, state.rot, getFacesForStage(baseStage));

    if (state.blinkStages.length > 0) {
        const overlayImg = mainCtx.createImageData(MAX_RES, MAX_RES);
        renderHead(overlayImg, state.rot, makeEyeOverlayFaces(state.blinkStages[0], state.blinkOnlyEyes ? state.eyeMask : null));
        for(let i=0;i<mainImgData.data.length;i+=4){
            if(overlayImg.data[i+3] > 0){
                mainImgData.data[i]=overlayImg.data[i];
                mainImgData.data[i+1]=overlayImg.data[i+1];
                mainImgData.data[i+2]=overlayImg.data[i+2];
                mainImgData.data[i+3]=overlayImg.data[i+3];
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

    const N = state.gridRes;
    const gx = Math.min(N - 1, Math.max(0, Math.floor(nx * N)));
    const gy = Math.min(N - 1, Math.max(0, Math.floor(ny * N)));

    if (painting.isMask) {
        applyMaskBrush(gx, gy);
        painting.last = null;
    } else {
        const layer = activeLayer();
        if (!layer) return;

        const hit = { gx, gy, layer };
        if (painting.last && painting.last.layer === hit.layer) {
            paintLine(painting.last, hit);
        } else {
            applyBrush(hit.layer, hit.gx, hit.gy);
        }
        painting.last = hit;
    }
    requestRender();
}

function applyMaskBrush(gx, gy) {
    const block = MAX_RES / state.gridRes;
    // Если выбрана кисть - закрашиваем (1), если ластик - очищаем (0)
    const val = (state.tool === 'erase') ? 0 : 1;
    const x0 = gx * block, y0 = gy * block;
    for (let y = y0; y < y0 + block; y++) {
        for (let x = x0; x < x0 + block; x++) {
            state.eyeMask[y * MAX_RES + x] = val;
        }
    }
    renderAll();
}

function applyBrush(layer, gx, gy) {
    const stages = currentStages();
    const idx = state.activeStageIdx;

    if (state.syncDrawing && state.activeTab !== 'rage') {
        for (let i = 0; i < stages.length; i++) _applyBrush(i, layer, gx, gy);
    } else {
        _applyBrush(idx, layer, gx, gy);
    }
}

function _applyBrush(viewIdx, layer, gx, gy) {
    if (state.tool === 'restore') restoreBlock(viewIdx, layer, gx, gy);
    else if (state.tool === 'erase') eraseBlock(viewIdx, layer, gx, gy);
    else paintBlock(viewIdx, layer, gx, gy);
}

function paintBlock(viewIdx, layer, gx, gy) {
    const stage = currentStages()[viewIdx];
    if (!stage) return;
    const block = MAX_RES / state.gridRes;
    const rgb = hsvToRgb(state.hsv.h, state.hsv.s, state.hsv.v);
    const tex = stage[layer];
    const x0 = gx * block, y0 = gy * block;
    for (let y = y0; y < y0 + block; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x0 + block; x++) {
            tex[o] = rgb[0]; tex[o+1] = rgb[1]; tex[o+2] = rgb[2]; tex[o+3] = 255;
            o += 4;
        }
    }
}

function eraseBlock(viewIdx, layer, gx, gy) {
    const stage = currentStages()[viewIdx];
    if (!stage) return;
    const block = MAX_RES / state.gridRes;
    const tex = stage[layer];
    const x0 = gx * block, y0 = gy * block;
    for (let y = y0; y < y0 + block; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x0 + block; x++) {
            tex[o] = 0; tex[o+1] = 0; tex[o+2] = 0; tex[o+3] = 0;
            o += 4;
        }
    }
}

function restoreBlock(viewIdx, layer, gx, gy) {
    const stage = currentStages()[viewIdx];
    if (!stage || !state.originalSkinFaces) return;
    const block = MAX_RES / state.gridRes;
    const tex = stage[layer];
    const otex = state.originalSkinFaces.front[layer];
    const x0 = gx * block, y0 = gy * block;
    for (let y = y0; y < y0 + block; y++) {
        let o = (y * MAX_RES + x0) * 4;
        for (let x = x0; x < x0 + block; x++) {
            tex[o] = otex[o]; tex[o+1] = otex[o+1]; tex[o+2] = otex[o+2]; tex[o+3] = otex[o+3];
            o += 4;
        }
    }
}

function paintLine(a, b) {
    let x0 = a.gx, y0 = a.gy;
    const x1 = b.gx, y1 = b.gy;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
        applyBrush(a.layer, x0, y0);
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
    const N = state.gridRes;
    const gx = Math.min(N - 1, Math.max(0, Math.floor(nx * N)));
    const gy = Math.min(N - 1, Math.max(0, Math.floor(ny * N)));

    const stage = currentStages()[state.activeStageIdx];
    const layer = activeLayer();
    if(!stage || !layer) return;

    const block = MAX_RES / state.gridRes;
    const tex = stage[layer];
    const o = ((gy * block) * MAX_RES + (gx * block)) * 4;

    if (tex[o+3] > 0) {
        const r = tex[o]/255, g = tex[o+1]/255, b = tex[o+2]/255;
        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        state.hsv = {h, s: max === 0 ? 0 : d/max, v: max};
        updateColorUI();
    }
}
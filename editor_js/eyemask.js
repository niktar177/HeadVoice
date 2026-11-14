'use strict';

const eyeCanvas = document.getElementById('eyeSelectCanvas');
const eyeCtx = eyeCanvas.getContext('2d');
eyeCtx.imageSmoothingEnabled = false;
let maskPainting = false;

function initEyeCanvas(){
    if(!state.eyeMask){
        state.eyeMask = new Uint8Array(MAX_RES * MAX_RES);
        state.eyeMask.fill(1);
    }
    renderEyeCanvas();
}

function renderEyeCanvas(){
    if(!state.skinFaces) return;
    const temp = document.createElement('canvas');
    temp.width = MAX_RES; temp.height = MAX_RES;
    const tCtx = temp.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    const img = tCtx.createImageData(MAX_RES, MAX_RES);
    renderFlatFace(img, state.skinFaces.front);
    tCtx.putImageData(img, 0, 0);

    const overlay = tCtx.createImageData(MAX_RES, MAX_RES);
    for(let i=0;i<MAX_RES*MAX_RES;i++){
        if(state.eyeMask[i]){
            const o = i*4;
            overlay.data[o] = 255;
            overlay.data[o+1] = 80;
            overlay.data[o+2] = 130;
            overlay.data[o+3] = 90;
        }
    }
    const tmp = document.createElement('canvas');
    tmp.width = MAX_RES; tmp.height = MAX_RES;
    tmp.getContext('2d').putImageData(overlay, 0, 0);
    tCtx.drawImage(tmp, 0, 0);

    eyeCtx.clearRect(0, 0, MAX_RES, MAX_RES);
    eyeCtx.drawImage(temp, 0, 0);
}

function eyePaint(e){
    const rect = eyeCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if(nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return;

    const N = state.gridRes;
    const gx = Math.min(N-1, Math.max(0, Math.floor(nx * N)));
    const gy = Math.min(N-1, Math.max(0, Math.floor(ny * N)));
    const block = MAX_RES / N;

    const val = state.eyeMaskMode === 'paint' ? 1 : 0;
    const x0 = gx * block;
    const y0 = gy * block;

    for(let y=y0; y<y0+block; y++){
        for(let x=x0; x<x0+block; x++){
            state.eyeMask[y*MAX_RES + x] = val;
        }
    }
    renderEyeCanvas();
}

eyeCanvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    eyeCanvas.setPointerCapture(e.pointerId);
    maskPainting = true;
    eyePaint(e);
});
eyeCanvas.addEventListener('pointermove', e => {
    if(!maskPainting) return;
    e.preventDefault();
    eyePaint(e);
});
eyeCanvas.addEventListener('pointerup', () => maskPainting = false);
eyeCanvas.addEventListener('pointercancel', () => maskPainting = false);

document.getElementById('maskBrush').addEventListener('click', () => {
    state.eyeMaskMode = 'paint';
    document.getElementById('maskBrush').classList.add('primary');
    document.getElementById('maskErase').classList.remove('primary');
});
document.getElementById('maskErase').addEventListener('click', () => {
    state.eyeMaskMode = 'erase';
    document.getElementById('maskErase').classList.add('primary');
    document.getElementById('maskBrush').classList.remove('primary');
});
document.getElementById('maskClear').addEventListener('click', () => {
    state.eyeMask.fill(0);
    renderEyeCanvas();
});
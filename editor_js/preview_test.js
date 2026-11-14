'use strict';

const previewCanvas = document.getElementById('previewCanvas');
const previewCtx = previewCanvas.getContext('2d');
previewCtx.imageSmoothingEnabled = false;

function renderPreview(){
    if(!['mouth','blink'].includes(state.page)) return;
    if(!state.skinFaces) return;

    let baseStage;
    if(state.page === 'mouth'){
        const vol = smoothVolume * state.settings.sensitivity;
        lastLevel = computeLevel(vol);
        baseStage = state.mouthStages[lastLevel-1] || state.mouthStages[0];
    } else {
        baseStage = state.mouthStages[0] || {base: state.skinFaces.front.base, hat: state.skinFaces.front.hat};
    }
    if(!baseStage) return;

    const temp = document.createElement('canvas');
    temp.width = MAX_RES; temp.height = MAX_RES;
    const tCtx = temp.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    const img = tCtx.createImageData(MAX_RES, MAX_RES);

    renderHead(img, state.rot, getFacesForStage(baseStage));

    if(state.hasBlinking && state.blinkStages.length > 0){
        let blinkStage;
        if(state.page === 'blink' && previewIsBlinking){
            blinkStage = state.blinkStages[Math.min(previewBlinkIdx, state.blinkStages.length-1)];
        } else {
            blinkStage = state.blinkStages[0];
        }
        const useMask = state.blinkOnlyEyes ? state.eyeMask : null;
        const overlayImg = tCtx.createImageData(MAX_RES, MAX_RES);
        renderHead(overlayImg, state.rot, makeEyeOverlayFaces(blinkStage, useMask));
        for(let i=0;i<img.data.length;i+=4){
            if(overlayImg.data[i+3] > 0){
                img.data[i]=overlayImg.data[i];
                img.data[i+1]=overlayImg.data[i+1];
                img.data[i+2]=overlayImg.data[i+2];
                img.data[i+3]=overlayImg.data[i+3];
            }
        }
    }

    tCtx.putImageData(img, 0, 0);
    previewCtx.clearRect(0, 0, 160, 160);
    previewCtx.drawImage(temp, 0, 0, 160, 160);
}

function startPreview(){
    stopPreview();
    initAudio();
    previewLastBlink = performance.now();
    previewLastRender = 0;

    const tick = (now) => {
        if(!['mouth','blink'].includes(state.page)){ previewRafId = null; return; }
        const vol = readMicRMS();
        smoothVolume = 0.7 * smoothVolume + 0.3 * vol;

        if(state.page === 'blink' && state.blinkStages.length){
            if(!previewIsBlinking && now - previewLastBlink > state.blinkFrequency * 1000){
                previewIsBlinking = true;
                previewBlinkIdx = 1;
                previewLastBlink = now;
                animateBlink();
            }
        }

        if(now - previewLastRender > 100){
            renderPreview();
            previewLastRender = now;
        }
        previewRafId = requestAnimationFrame(tick);
    };
    previewRafId = requestAnimationFrame(tick);
}

function animateBlink(){
    const totalDur = state.settings.blinkDuration || 300;
    const stepDur = Math.max(20, Math.floor(totalDur / state.blinkStages.length));
    const step = () => {
        if(!previewIsBlinking) return;
        previewBlinkIdx++;
        if(previewBlinkIdx >= state.blinkStages.length){ previewIsBlinking = false; return; }
        setTimeout(step, stepDur);
    };
    setTimeout(step, stepDur);
}

function stopPreview(){
    if(previewRafId){ cancelAnimationFrame(previewRafId); previewRafId = null; }
    previewIsBlinking = false;
}

const testCanvas = document.getElementById('testCanvas');
const testCtx = testCanvas.getContext('2d');
testCtx.imageSmoothingEnabled = false;

function startTest(){
    stopTest();
    initAudio();
    setupTestUI();

    const scheduleBlink = () => {
        testBlinkTimer = setTimeout(() => {
            if(state.page !== 'test') return;
            if(!testIsRage && state.blinkStages.length){
                testIsBlinking = true;
                testBlinkIdx = 1;
                animateTestBlink();
            }
            scheduleBlink();
        }, Math.max(1000, state.blinkFrequency * 1000));
    };
    scheduleBlink();

    testLastRender = 0;
    const tick = (now) => {
        if(state.page !== 'test'){ testRafId = null; return; }
        const vol = readMicRMS();
        testSmooth = 0.7 * testSmooth + 0.3 * vol;
        const v = testSmooth * state.settings.sensitivity;
        testLevel = computeLevel(v);

        if(now - testLastRender > 33){
            renderTest();
            testLastRender = now;
        }
        testRafId = requestAnimationFrame(tick);
    };
    testRafId = requestAnimationFrame(tick);
}

function animateTestBlink(){
    const totalDur = state.settings.blinkDuration || 300;
    const stepDur = Math.max(20, Math.floor(totalDur / state.blinkStages.length));
    const step = () => {
        if(!testIsBlinking) return;
        testBlinkIdx++;
        if(testBlinkIdx >= state.blinkStages.length){ testIsBlinking = false; return; }
        setTimeout(step, stepDur);
    };
    setTimeout(step, stepDur);
}

function stopTest(){
    if(testRafId){ cancelAnimationFrame(testRafId); testRafId = null; }
    if(testBlinkTimer){ clearTimeout(testBlinkTimer); testBlinkTimer = null; }
    testIsBlinking = false;
    testIsRage = false;
}

function renderTest(){
    const size = 288;
    testCtx.clearRect(0, 0, size, size);
    if(!state.mouthStages.length) return;

    let baseStage = state.mouthStages[testLevel-1] || state.mouthStages[0];

    const temp = document.createElement('canvas');
    temp.width = MAX_RES; temp.height = MAX_RES;
    const tCtx = temp.getContext('2d');
    tCtx.imageSmoothingEnabled = false;
    const img = tCtx.createImageData(MAX_RES, MAX_RES);
    renderHead(img, state.rot, getFacesForStage(baseStage));

    if(!testIsRage && state.hasBlinking && state.blinkStages.length > 0){
        let blinkStage;
        if(testIsBlinking){
            blinkStage = state.blinkStages[Math.min(testBlinkIdx, state.blinkStages.length-1)];
        } else {
            blinkStage = state.blinkStages[0];
        }
        const useMask = state.blinkOnlyEyes ? state.eyeMask : null;
        const overlayImg = tCtx.createImageData(MAX_RES, MAX_RES);
        renderHead(overlayImg, state.rot, makeEyeOverlayFaces(blinkStage, useMask));
        for(let i=0;i<img.data.length; i+=4){
            if(overlayImg.data[i+3] > 0){
                img.data[i]=overlayImg.data[i];
                img.data[i+1]=overlayImg.data[i+1];
                img.data[i+2]=overlayImg.data[i+2];
                img.data[i+3]=overlayImg.data[i+3];
            }
        }
    }

    if(testIsRage && state.rageStage){
        const overlayImg = tCtx.createImageData(MAX_RES, MAX_RES);
        renderHead(overlayImg, state.rot, makeEyeOverlayFaces(state.rageStage, null));
        for(let i=0;i<img.data.length;i+=4){
            if(overlayImg.data[i+3] > 0){
                img.data[i]=overlayImg.data[i];
                img.data[i+1]=overlayImg.data[i+1];
                img.data[i+2]=overlayImg.data[i+2];
                img.data[i+3]=overlayImg.data[i+3];
            }
        }
    }

    tCtx.putImageData(img, 0, 0);

    let offX = 0, offY = 0;
    if(testIsRage){
        const f = state.settings.shakeForce;
        offX = Math.round((Math.random()*2-1) * f);
        offY = Math.round((Math.random()*2-1) * f);
    }
    testCtx.drawImage(temp, offX, offY, size, size);
}

function ensureThresholds() {
    const needed = Math.max(1, state.mouthStages.length - 1);
    while(state.settings.thresholds.length < needed){
        const last = state.settings.thresholds[state.settings.thresholds.length-1] || 1;
        state.settings.thresholds.push(Math.min(100, last + 2));
    }
}

function setupTestUI(){
    document.getElementById('testSens').value = Math.round(state.settings.sensitivity * 100);
    document.getElementById('vSens').textContent = state.settings.sensitivity.toFixed(1);
    document.getElementById('testShake').value = state.settings.shakeForce;
    document.getElementById('vShake').textContent = state.settings.shakeForce;
    document.getElementById('testBlinkFreq').value = Math.round(state.blinkFrequency * 10);
    document.getElementById('vBlinkFreq').textContent = state.blinkFrequency.toFixed(1);
    document.getElementById('testBlinkDur').value = state.settings.blinkDuration;
    document.getElementById('vBlinkDur').textContent = state.settings.blinkDuration;
    document.getElementById('testRageKey').value = state.settings.rageKey;

    const row = document.getElementById('threshRow');
    row.innerHTML = '';
    ensureThresholds();

    const btnWrap = document.createElement('div');
    btnWrap.className = 'field';
    const btnAuto = document.createElement('button');
    btnAuto.textContent = "✨ Авто-распределение";
    btnAuto.style.cssText = "font-size:11px;padding:4px 8px;margin-bottom:8px;";
    btnAuto.addEventListener('click', () => {
        const step = 100 / (state.mouthStages.length + 1);
        for(let k=0; k<state.settings.thresholds.length; k++){
            state.settings.thresholds[k] = Math.floor((k+1) * step);
        }
        setupTestUI();
    });
    btnWrap.appendChild(btnAuto);
    row.appendChild(btnWrap);
    const cnt = state.mouthStages.length;

    for(let i=0; i < cnt - 1; i++){
        const wrap = document.createElement('div');
        wrap.className = 'field';
        const lbl = document.createElement('label');
        lbl.innerHTML = `Порог ${i+1}→${i+2}: <span class="v">${state.settings.thresholds[i]}%</span>`;
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = 1; inp.max = 100;
        inp.value = state.settings.thresholds[i];

        inp.addEventListener('input', () => {
            let v = parseInt(inp.value, 10);
            const prev = i > 0 ? state.settings.thresholds[i-1] : 0;
            const next = i < cnt - 2 ? state.settings.thresholds[i+1] : 101;
            v = Math.max(prev + 1, Math.min(v, next - 1));

            state.settings.thresholds[i] = v;
            inp.value = v;
            lbl.querySelector('.v').textContent = v + '%';

            for(let j=0; j<row.children.length; j++){
                const otherInp = row.children[j].querySelector('input');
                otherInp.max = j < row.children.length-1 ? (state.settings.thresholds[j+1] - 1) : 100;
            }
        });

        if (i > 0) inp.min = state.settings.thresholds[i-1] + 1;
        if (i < cnt - 2) inp.max = state.settings.thresholds[i+1] - 1;

        wrap.appendChild(lbl); wrap.appendChild(inp);
        row.appendChild(wrap);
    }
}

// Bind test inputs
document.getElementById('testSens').oninput = (e) => {
    const v = parseInt(e.target.value, 10) / 100;
    state.settings.sensitivity = v;
    document.getElementById('vSens').textContent = v.toFixed(1);
};
document.getElementById('testShake').oninput = (e) => {
    const v = parseInt(e.target.value, 10);
    state.settings.shakeForce = v;
    document.getElementById('vShake').textContent = v;
};
document.getElementById('testBlinkFreq').oninput = (e) => {
    const v = parseInt(e.target.value, 10) / 10;
    state.blinkFrequency = v;
    state.settings.blinkInterval = v;
    document.getElementById('vBlinkFreq').textContent = v.toFixed(1);
    if(state.page === 'test'){
        if(testBlinkTimer){ clearTimeout(testBlinkTimer); testBlinkTimer = null; }
        startTest();
    }
};
document.getElementById('testBlinkDur').oninput = (e) => {
    const v = parseInt(e.target.value, 10);
    state.settings.blinkDuration = v;
    document.getElementById('vBlinkDur').textContent = v;
};
document.getElementById('testRageKey').oninput = (e) => {
    const v = e.target.value.toLowerCase() || 'j';
    state.settings.rageKey = v;
};
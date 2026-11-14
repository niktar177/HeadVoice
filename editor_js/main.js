'use strict';

document.addEventListener('keydown', e => {
    const inInput = document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);
    if (inInput) return;

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    }

    if (e.code === 'KeyT') {
        e.preventDefault();
        state.showHat = !state.showHat;
        const btn = document.getElementById('btnLayerHat');
        if(btn) { btn.textContent = state.showHat ? 'ВКЛ' : 'ВЫКЛ'; btn.classList.toggle('on', state.showHat); }
        requestRender();
        return;
    }
    if (e.code === 'KeyY') {
        e.preventDefault();
        state.showBase = !state.showBase;
        const btn = document.getElementById('btnLayerBase');
        if(btn) { btn.textContent = state.showBase ? 'ВКЛ' : 'ВЫКЛ'; btn.classList.toggle('on', state.showBase); }
        requestRender();
        return;
    }

    if (e.code === 'Digit6') {
        e.preventDefault();
        if (state.activeTab === 'mouth' || state.activeTab === 'eyes') {
            setMode(state.mode === 'view' ? 'edit' : 'view');
            renderAll();
        }
        return;
    }

    if (['Digit1','Digit2','Digit3','Digit4','Digit5'].includes(e.code)) {
        e.preventDefault();
        const resMap = {'Digit1':8, 'Digit2':16, 'Digit3':32, 'Digit4':64, 'Digit5':128};
        const res = resMap[e.code];
        state.gridRes = res;
        document.querySelectorAll('#thicknessIcons button').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.res) === res);
        });
        renderAll();
        return;
    }

    if (state.activeTab !== 'settings' && state.mode === 'edit') {
        if (e.code === 'KeyB') { e.preventDefault(); setTool('brush'); }
        if (e.code === 'KeyX') { e.preventDefault(); setTool('erase'); }
        if (e.code === 'KeyR') { e.preventDefault(); setTool('restore'); }
        if (e.code === 'KeyF') { e.preventDefault(); setTool('picker'); }
        return;
    }

    const step = 5 * DEG;
    let rotated = false;
    switch(e.code) {
        case 'KeyQ': state.rot.y -= step; rotated = true; break;
        case 'KeyE': state.rot.y += step; rotated = true; break;
        case 'KeyW': state.rot.x -= step; rotated = true; break;
        case 'KeyS': state.rot.x += step; rotated = true; break;
        case 'KeyA': state.rot.z -= step; rotated = true; break;
        case 'KeyD': state.rot.z += step; rotated = true; break;
        default: return;
    }

    if (rotated) {
        if (state.mode === 'edit' && state.activeTab !== 'settings') {
            const btn = document.getElementById('btnMode');
            if(btn) {
                btn.classList.remove('blink-red');
                void btn.offsetWidth;
                btn.classList.add('blink-red');
                setTimeout(() => btn.classList.remove('blink-red'), 500);
            }
        }
        e.preventDefault();
        requestRender();
    }
});

document.querySelectorAll('[data-tool]').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
});

document.getElementById('btnMode')?.addEventListener('click', () => {
    if (state.activeTab === 'settings' || state.activeTab === 'rage') return;
    setMode(state.mode === 'view' ? 'edit' : 'view');
    renderAll();
});

document.getElementById('btnLayerBase')?.addEventListener('click', (e) => {
    state.showBase = !state.showBase;
    e.target.textContent = state.showBase ? 'ВКЛ' : 'ВЫКЛ';
    e.target.classList.toggle('on', state.showBase);
    renderAll();
});

document.getElementById('btnLayerHat')?.addEventListener('click', (e) => {
    state.showHat = !state.showHat;
    e.target.textContent = state.showHat ? 'ВКЛ' : 'ВЫКЛ';
    e.target.classList.toggle('on', state.showHat);
    renderAll();
});

document.getElementById('btnSyncDraw')?.addEventListener('click', (e) => {
    state.syncDrawing = !state.syncDrawing;
    e.target.textContent = state.syncDrawing ? 'ВКЛ' : 'ВЫКЛ';
    e.target.classList.toggle('on', state.syncDrawing);
});

document.getElementById('btnOnlyEyes')?.addEventListener('click', () => {
    state.blinkOnlyEyes = !state.blinkOnlyEyes;
    updateOnlyEyesBtn();
    renderAll();
});

document.getElementById('btnEyeModeToggle')?.addEventListener('click', () => {
    state.eyeMaskMode = !state.eyeMaskMode;
    updateEyeModeBtn();
    updateCanvasLabel();
    buildRightPanel();
    renderAll();
});

document.querySelectorAll('#thicknessIcons button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#thicknessIcons button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.gridRes = parseInt(btn.dataset.res, 10);
        renderAll();
    });
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('btnUndo')?.addEventListener('click', undo);
document.getElementById('btnRedo')?.addEventListener('click', redo);

document.getElementById('settingsHasRage')?.addEventListener('change', (e) => {
    state.hasRage = e.target.checked;
    document.getElementById('tabRageBtn').style.display = state.hasRage ? 'block' : 'none';
    if (!state.hasRage && state.activeTab === 'rage') switchTab('settings');
    buildRightPanel();
});

document.getElementById('settingsHasBody')?.addEventListener('change', (e) => {
    state.hasBody = e.target.checked;
});

document.getElementById('testSens')?.addEventListener('input', e => {
    state.settings.sensitivity = parseInt(e.target.value, 10) / 100;
    document.getElementById('vSens').textContent = state.settings.sensitivity.toFixed(1);
});
document.getElementById('testBlinkFreq')?.addEventListener('input', e => {
    state.settings.blinkInterval = parseInt(e.target.value, 10) / 10;
    document.getElementById('vBlinkFreq').textContent = state.settings.blinkInterval.toFixed(1);
});
document.getElementById('testBlinkDur')?.addEventListener('input', e => {
    state.settings.blinkDuration = parseInt(e.target.value, 10);
    document.getElementById('vBlinkDur').textContent = state.settings.blinkDuration;
});
document.getElementById('testShake')?.addEventListener('input', e => {
    state.settings.shakeForce = parseInt(e.target.value, 10);
    document.getElementById('vShake').textContent = state.settings.shakeForce;
});
document.getElementById('testRageKey')?.addEventListener('input', e => {
    state.settings.rageKey = e.target.value.toLowerCase() || 'j';
});
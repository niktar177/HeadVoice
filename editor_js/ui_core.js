'use strict';

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('visible'));
    const target = document.getElementById(pageId);
    if (target) target.classList.add('visible');
    if (pageId === 'page-editor') renderAll();
}

function switchTab(tabName) {
    state.activeTab = tabName;
    state.activeStageIdx = 0;
    state.eyeMaskMode = false;

    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');

    if (tabName === 'settings') {
        setMode('view');
        buildThresholdsUI();
    } else {
        // В RAGE принудительно ставим 2D (edit)
        setMode('edit');
    }

    if (tabName === 'eyes') {
        updateEyeModeBtn();
        updateOnlyEyesBtn();
    }

    updateCanvasLabel();
    buildRightPanel();
    renderAll();
}

function setMode(mode) {
    state.mode = mode;
    const btn = document.getElementById('btnMode');
    if (btn) {
        if (mode === 'edit') {
            btn.textContent = '2D';
            btn.classList.remove('on');
            document.body.classList.add('editing');
        } else {
            btn.textContent = '3D';
            btn.classList.add('on');
            document.body.classList.remove('editing');
        }
    }
}

function updateEyeModeBtn() {
    const btn = document.getElementById('btnEyeModeToggle');
    if (state.eyeMaskMode) {
        btn.textContent = 'ВКЛ (Маска)';
        btn.classList.add('on');
        setTool('erase'); // По умолчанию включаем ластик для маски
    } else {
        btn.textContent = 'ВЫКЛ';
        btn.classList.remove('on');
        setTool('brush');
    }
}

function updateOnlyEyesBtn() {
    const btn = document.getElementById('btnOnlyEyes');
    if (state.blinkOnlyEyes) {
        btn.textContent = 'ВКЛ';
        btn.classList.add('on');
    } else {
        btn.textContent = 'ВЫКЛ';
        btn.classList.remove('on');
    }
}

function updateCanvasLabel() {
    const labels = {
        'mouth': 'РОТ',
        'eyes': state.eyeMaskMode ? 'МАСКА ГЛАЗ' : 'ГЛАЗА',
        'rage': 'RAGE',
        'settings': 'ПРЕДПРОСМОТР'
    };
    document.getElementById('canvasLabel').textContent = labels[state.activeTab] || 'РЕДАКТОР';
}

function currentStages() {
    if (state.activeTab === 'mouth') return state.mouthStages;
    if (state.activeTab === 'eyes') return state.blinkStages;
    if (state.activeTab === 'rage') return state.rageStage ? [state.rageStage] : [];
    return [];
}

function buildRightPanel() {
    ['Mouth', 'Eyes', 'Rage'].forEach(tab => {
        const listEl = document.getElementById(`layerList${tab}`);
        if (!listEl) return;
        listEl.innerHTML = '';

        const tabName = tab.toLowerCase();
        if (tabName !== state.activeTab) return;

        if (tabName === 'eyes' && state.eyeMaskMode) {
            listEl.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;padding:20px;">Рисование маски включено.<br>Выключите переключатель выше, чтобы вернуться к слоям.</div>';
            return;
        }

        const stages = currentStages();
        if (tabName === 'rage' && !state.hasRage) {
            listEl.innerHTML = '<div style="color:var(--dim);font-size:12px;text-align:center;">Режим RAGE отключен в настройках.</div>';
            return;
        }

        stages.forEach((stage, i) => {
            const item = document.createElement('div');
            item.className = 'layer-item' + (i === state.activeStageIdx ? ' active' : '');

            const thumb = document.createElement('canvas');
            thumb.className = 'layer-thumb';
            thumb.width = 50; thumb.height = 50;
            const tCtx = thumb.getContext('2d');
            tCtx.imageSmoothingEnabled = false;

            const temp = document.createElement('canvas');
            temp.width = MAX_RES; temp.height = MAX_RES;
            const tCtxFull = temp.getContext('2d');
            const img = tCtxFull.createImageData(MAX_RES, MAX_RES);
            renderFlatFace(img, stage, tabName);
            tCtxFull.putImageData(img, 0, 0);
            tCtx.drawImage(temp, 0, 0, 50, 50);

            item.appendChild(thumb);

            const info = document.createElement('div');
            info.className = 'layer-info';

            let name = `Кадр ${i + 1}`;
            if (tabName === 'mouth' && i === 0) name = 'ЗАКРЫТЫЙ РОТ';
            if (tabName === 'eyes' && i === 0) name = 'ОТКРЫТЫЕ ГЛАЗА';
            if (tabName === 'rage') name = 'RAGE';

            info.innerHTML = `<span class="layer-name">${name}</span>`;

            const actions = document.createElement('div');
            actions.className = 'layer-actions';

            if (tabName !== 'rage') {
                const addBtn = document.createElement('button');
                addBtn.textContent = '＋';
                addBtn.title = 'Добавить копию';
                addBtn.onclick = (e) => { e.stopPropagation(); addStage(i); };
                actions.appendChild(addBtn);
            }

            if (i > 0) {
                const upBtn = document.createElement('button');
                upBtn.textContent = '↑';
                upBtn.onclick = (e) => { e.stopPropagation(); moveStage(i, -1); };

                const downBtn = document.createElement('button');
                downBtn.textContent = '↓';
                downBtn.onclick = (e) => { e.stopPropagation(); moveStage(i, 1); };

                actions.appendChild(upBtn);
                actions.appendChild(downBtn);
            }

            if (stages.length > 1 && tabName !== 'rage' && i !== 0) {
                const delBtn = document.createElement('button');
                delBtn.className = 'del';
                delBtn.textContent = '✖';
                delBtn.title = 'Удалить';
                delBtn.onclick = (e) => { e.stopPropagation(); deleteStage(i); };
                actions.appendChild(delBtn);
            }

            info.appendChild(actions);
            item.appendChild(info);

            item.onclick = () => {
                state.activeStageIdx = i;
                buildRightPanel();
                renderAll();
            };

            listEl.appendChild(item);
        });
    });
}

function addStage(sourceIdx) {
    const stages = currentStages();
    const base = stages[sourceIdx];
    let newStage = base ? cloneStage(base) : makeStage();
    pushUndo();
    stages.splice(sourceIdx + 1, 0, newStage);
    state.activeStageIdx = sourceIdx + 1;
    buildRightPanel();
    renderAll();
}

function deleteStage(i) {
    const stages = currentStages();
    if (stages.length <= 1 || i === 0) return;
    pushUndo();
    stages.splice(i, 1);
    if (state.activeStageIdx >= stages.length) state.activeStageIdx = stages.length - 1;
    buildRightPanel();
    renderAll();
}

function moveStage(i, dir) {
    const stages = currentStages();
    const target = i + dir;
    if (target <= 0 || target >= stages.length) return;
    pushUndo();
    const temp = stages[i];
    stages[i] = stages[target];
    stages[target] = temp;
    state.activeStageIdx = target;
    buildRightPanel();
    renderAll();
}

// Undo / Redo с поддержкой маски
function pushUndo() {
    if (state.activeTab === 'eyes' && state.eyeMaskMode) {
        state.undoStack.push({type: 'mask', mask: new Uint8Array(state.eyeMask)});
    } else {
        const stages = currentStages().map(cloneStage);
        state.undoStack.push({type: state.activeTab, stages});
    }
    if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    state.redoStack = [];
}

function undo() {
    if (!state.undoStack.length) return;
    const snap = state.undoStack.pop();

    if (snap.type === 'mask') {
        state.redoStack.push({type: 'mask', mask: new Uint8Array(state.eyeMask)});
        state.eyeMask = new Uint8Array(snap.mask);
    } else {
        const stages = currentStages().map(cloneStage);
        state.redoStack.push({type: state.activeTab, stages});
        if (snap.type !== state.activeTab) { state.undoStack.push(snap); return; }
        applyStages(snap.stages);
    }
    buildRightPanel();
    renderAll();
}

function redo() {
    if (!state.redoStack.length) return;
    const snap = state.redoStack.pop();

    if (snap.type === 'mask') {
        state.undoStack.push({type: 'mask', mask: new Uint8Array(state.eyeMask)});
        state.eyeMask = new Uint8Array(snap.mask);
    } else {
        const stages = currentStages().map(cloneStage);
        state.undoStack.push({type: state.activeTab, stages});
        if (snap.type !== state.activeTab) { state.redoStack.push(snap); return; }
        applyStages(snap.stages);
    }
    buildRightPanel();
    renderAll();
}

function applyStages(stages) {
    if (state.activeTab === 'mouth') state.mouthStages = stages;
    else if (state.activeTab === 'eyes') state.blinkStages = stages;
    else if (state.activeTab === 'rage') state.rageStage = stages[0] || null;
}

function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('[data-tool]').forEach(b => {
        b.classList.toggle('active', b.dataset.tool === tool);
    });
}

function buildThresholdsUI() {
    const row = document.getElementById('threshRow');
    row.innerHTML = '';
    const cnt = state.mouthStages.length;

    // Если порогов не хватает, достраиваем
    while(state.settings.thresholds.length < cnt - 1) {
        const last = state.settings.thresholds[state.settings.thresholds.length - 1] || 1;
        state.settings.thresholds.push(Math.min(100, last + 5));
    }

    for (let i = 0; i < cnt - 1; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'field';
        wrap.style.marginBottom = '8px';

        const lbl = document.createElement('label');
        lbl.innerHTML = `Порог ${i+1}→${i+2}: <span class="v">${state.settings.thresholds[i]}%</span>`;

        const inp = document.createElement('input');
        inp.type = 'range';

        // Устанавливаем строгие границы для текущего
        const prevV = i > 0 ? state.settings.thresholds[i-1] : 0;
        const nextV = i < cnt - 2 ? state.settings.thresholds[i+1] : 101;
        inp.min = prevV + 1;
        inp.max = nextV - 1;
        inp.value = state.settings.thresholds[i];

        inp.addEventListener('input', () => {
            let v = parseInt(inp.value, 10);
            const pV = i > 0 ? state.settings.thresholds[i-1] : 0;
            const nV = i < cnt - 2 ? state.settings.thresholds[i+1] : 101;
            v = Math.max(pV + 1, Math.min(v, nV - 1));

            state.settings.thresholds[i] = v;
            inp.value = v;
            lbl.querySelector('.v').textContent = v + '%';

            // Обновляем границы для ВСЕХ инпутов, чтобы избежать пересечений
            const inputs = row.querySelectorAll('input');
            for (let j = 0; j < inputs.length; j++) {
                const p = j > 0 ? state.settings.thresholds[j-1] : 0;
                const n = j < cnt - 2 ? state.settings.thresholds[j+1] : 101;
                inputs[j].min = p + 1;
                inputs[j].max = n - 1;
            }
        });

        wrap.appendChild(lbl);
        wrap.appendChild(inp);
        row.appendChild(wrap);
    }
}
'use strict';

async function renderStageToPNG(stage, deltaFrom = null){
    const cv = document.createElement('canvas');
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(MAX_RES, MAX_RES);
    renderHead(img, state.rot, getFacesForStage(stage));

    if (deltaFrom) {
        const baseImg = ctx.createImageData(MAX_RES, MAX_RES);
        renderHead(baseImg, state.rot, getFacesForStage(deltaFrom));
        for (let i = 0; i < img.data.length; i += 4) {
            if (img.data[i+3] === 0 ||
                (img.data[i]   === baseImg.data[i]   &&
                    img.data[i+1] === baseImg.data[i+1] &&
                    img.data[i+2] === baseImg.data[i+2] &&
                    img.data[i+3] === baseImg.data[i+3])) {
                img.data[i+3] = 0;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

async function renderBlinkToPNG(stage, deltaFrom = null){
    const cv = document.createElement('canvas');
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(MAX_RES, MAX_RES);

    const useMask = state.eyeMask ? state.eyeMask : null;
    renderHead(img, state.rot, makeEyeOverlayFaces(stage, useMask));

    if (deltaFrom) {
        const baseImg = ctx.createImageData(MAX_RES, MAX_RES);
        renderHead(baseImg, state.rot, makeEyeOverlayFaces(deltaFrom, useMask));
        for (let i = 0; i < img.data.length; i += 4) {
            if (img.data[i+3] === 0 ||
                (img.data[i]   === baseImg.data[i]   &&
                    img.data[i+1] === baseImg.data[i+1] &&
                    img.data[i+2] === baseImg.data[i+2] &&
                    img.data[i+3] === baseImg.data[i+3])) {
                img.data[i+3] = 0;
            }
        }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

async function renderRageToPNG(stage){
    const cv = document.createElement('canvas');
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(MAX_RES, MAX_RES);
    renderHead(img, state.rot, makeEyeOverlayFaces(stage, null));

    const baseImg = ctx.createImageData(MAX_RES, MAX_RES);
    renderHead(baseImg, state.rot, makeEyeOverlayFaces(state.mouthStages[0], null));
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i+3] === 0 ||
            (img.data[i]   === baseImg.data[i]   &&
                img.data[i+1] === baseImg.data[i+1] &&
                img.data[i+2] === baseImg.data[i+2] &&
                img.data[i+3] === baseImg.data[i+3])) {
            img.data[i+3] = 0;
        }
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
}

document.getElementById('btnFinish').addEventListener('click', async () => {
    const rawName = (document.getElementById('modelNameInput').value || '').trim();
    const modelName = rawName.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+$/, '') || 'my_model';
    document.getElementById('modelNameInput').value = modelName;

    const files = [];
    const enc = new TextEncoder();
    const block = MAX_RES / 8;

    // 1. Сохраняем 3D-рендеры для программы
    for (let i = 0; i < state.mouthStages.length; i++) {
        const delta = (i > 0) ? state.mouthStages[0] : null;
        files.push({ name: `image_mouth_${i+1}.png`, data: await renderStageToPNG(state.mouthStages[i], delta) });
    }

    for (let i = 0; i < state.blinkStages.length; i++) {
        const delta = state.skinFaces.front;
        files.push({ name: `image_blink_${i+1}.png`, data: await renderBlinkToPNG(state.blinkStages[i], delta) });
    }

    if (state.hasRage && state.rageStage) {
        files.push({ name: `image_rage.png`, data: await renderRageToPNG(state.rageStage) });
    }

    // 2. Сохраняем RAW развертки в разрешении 256x256 без потери качества
    const saveLayerRAW = async (layerArray, filename) => {
        const cv = document.createElement('canvas');
        cv.width = MAX_RES; cv.height = MAX_RES;
        const ctx = cv.getContext('2d');
        const imgData = ctx.createImageData(MAX_RES, MAX_RES);
        if (layerArray) imgData.data.set(layerArray);
        ctx.putImageData(imgData, 0, 0);
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        files.push({ name: filename, data: new Uint8Array(await blob.arrayBuffer()) });
    };

    const saveStageRAW = async (stage, filename) => {
        if (!stage) {
            await saveLayerRAW(new Uint8ClampedArray(MAX_RES*MAX_RES*4), filename);
            await saveLayerRAW(new Uint8ClampedArray(MAX_RES*MAX_RES*4), filename.replace('.png', '_hat.png'));
            return;
        }
        await saveLayerRAW(stage.base, filename);
        await saveLayerRAW(stage.hat, filename.replace('.png', '_hat.png'));
    };

    for (let i = 0; i < state.mouthStages.length; i++) {
        await saveStageRAW(state.mouthStages[i], `RAW/mouth/${i+1}.png`);
    }
    for (let i = 0; i < state.blinkStages.length; i++) {
        await saveStageRAW(state.blinkStages[i], `RAW/eyes/${i+1}.png`);
    }
    await saveStageRAW(state.hasRage ? state.rageStage : null, `RAW/rage.png`);

    // 3. Сохраняем маску
    if (state.eyeMask) {
        const cv = document.createElement('canvas');
        cv.width = MAX_RES; cv.height = MAX_RES;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(MAX_RES, MAX_RES);
        for(let i=0;i<MAX_RES*MAX_RES;i++){
            if(state.eyeMask[i]){
                img.data[i*4] = 255; img.data[i*4+1] = 255; img.data[i*4+2] = 255; img.data[i*4+3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
        files.push({ name: 'RAW/mask.png', data: new Uint8Array(await blob.arrayBuffer()) });
    }

    // 4. Сохраняем оригинальный скин (64x64)
    const skinCv = document.createElement('canvas');
    skinCv.width = 64; skinCv.height = 64;
    const skinCtx = skinCv.getContext('2d');
    const skinImg = skinCtx.createImageData(64, 64);
    for (const f of FACE_NAMES) {
        for (const layer of ['base', 'hat']) {
            const uv = FACE_UV[layer][f];
            const tex = state.skinFaces[f][layer];
            for (let sy = 0; sy < 8; sy++) {
                for (let sx = 0; sx < 8; sx++) {
                    const so = (Math.floor((sy + 0.5) * block) * MAX_RES + Math.floor((sx + 0.5) * block)) * 4;
                    const doff = ((uv[1] + sy) * 64 + (uv[0] + sx)) * 4;
                    skinImg.data[doff] = tex[so];
                    skinImg.data[doff+1] = tex[so+1];
                    skinImg.data[doff+2] = tex[so+2];
                    skinImg.data[doff+3] = tex[so+3];
                }
            }
        }
    }
    skinCtx.putImageData(skinImg, 0, 0);
    const skinBlob = await new Promise(res => skinCv.toBlob(res, 'image/png'));
    files.push({ name: 'skin.png', data: new Uint8Array(await skinBlob.arrayBuffer()) });

    // 5. JSON файлы
    const rawData = {
        version: 4,
        rotations: state.rot,
        mouth_count: state.mouthStages.length,
        blink_count: state.blinkStages.length,
        has_rage: state.hasRage,
        has_body: state.hasBody,
        settings: state.settings
    };
    files.push({ name: 'RAW/RAW.json', data: enc.encode(JSON.stringify(rawData, null, 2)) });

    const cfgData = {
        sensitivity: state.settings.sensitivity,
        thresholds: state.settings.thresholds,
        blink_interval: state.settings.blinkInterval,
        rage_key: state.settings.rageKey,
        shake_force: state.settings.shakeForce,
        blink_duration: state.settings.blinkDuration,
        mouth_count: state.mouthStages.length,
        has_blinking: state.blinkStages.length > 0,
        has_rage: state.hasRage,
        blink_count: state.blinkStages.length,
        blink_only_eyes: state.blinkOnlyEyes,
        has_body: state.hasBody,
        memory_limit_mb: 300
    };
    files.push({ name: 'config.json', data: enc.encode(JSON.stringify(cfgData, null, 2)) });

    // 6. Запись на диск
    if (window.showDirectoryPicker) {
        try {
            const dir = await window.showDirectoryPicker();

            // Умная проверка: если пользователь уже зашел в папку "models", не создаем её снова
            let modelsDir = dir;
            if (dir.name !== 'models') {
                modelsDir = await dir.getDirectoryHandle('models', {create: true});
            }

            const modelDir = await modelsDir.getDirectoryHandle(modelName, {create: true});

            const rawDir = await modelDir.getDirectoryHandle('RAW', {create: true});
            const mouthDir = await rawDir.getDirectoryHandle('mouth', {create: true});
            const eyesDir = await rawDir.getDirectoryHandle('eyes', {create: true});

            for (const f of files) {
                let targetDir = modelDir;
                let fileName = f.name;

                if (f.name.startsWith('RAW/mouth/')) { targetDir = mouthDir; fileName = f.name.replace('RAW/mouth/', ''); }
                else if (f.name.startsWith('RAW/eyes/')) { targetDir = eyesDir; fileName = f.name.replace('RAW/eyes/', ''); }
                else if (f.name.startsWith('RAW/')) { targetDir = rawDir; fileName = f.name.replace('RAW/', ''); }

                const fh = await targetDir.getFileHandle(fileName, {create: true});
                const w = await fh.createWritable();
                await w.write(f.data);
                await w.close();
            }

            // Пытаемся обновить app_config.json, только если выбрана корневая папка
            try {
                if (dir.name !== 'models') {
                    const appCfg = await dir.getFileHandle('app_config.json', {create: true});
                    const w = await appCfg.createWritable();
                    await w.write(new TextEncoder().encode(JSON.stringify({current_model: modelName}, null, 2)));
                    await w.close();
                } else {
                    console.warn("Выбрана папка models. app_config.json не обновлен (он должен лежать в корне программы).");
                }
            } catch(e) { console.log('app_config.json не обновлен', e); }

            alert(`Проект сохранен в models/${modelName}/`);
        } catch(err) {
            console.error(err);
            alert('Ошибка сохранения папки');
        }
    } else {
        alert('Браузер не поддерживает сохранение в папку. Используйте Chrome/Edge.');
    }
});
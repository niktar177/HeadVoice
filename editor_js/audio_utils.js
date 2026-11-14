'use strict';

async function initAudio(){
    if(audioCtx) return true;
    try {
        micStream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        src.connect(analyser);
        audioBuf = new Float32Array(analyser.fftSize);
        return true;
    } catch(e){
        console.warn('mic error', e);
        return false;
    }
}
function readMicRMS(){
    if(!analyser || !audioBuf) return 0;
    analyser.getFloatTimeDomainData(audioBuf);
    let sum = 0;
    for(let i=0;i<audioBuf.length;i++){ const v = audioBuf[i]; sum += v*v; }
    return Math.sqrt(sum / audioBuf.length);
}
function computeLevel(vol){
    const th = state.settings.thresholds;
    const cnt = Math.max(1, state.mouthStages.length);
    let level = 1;
    for(let i=0;i<Math.min(th.length, cnt-1);i++){
        if(vol > th[i] / 100.0) level = i + 2;
    }
    return Math.min(level, cnt);
}
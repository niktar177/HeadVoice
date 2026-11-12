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

const DEFAULT_SETTINGS = {
  sensitivity: 1.5,
  thresholds: [15, 30, 45, 60, 75],
  blinkInterval: 5.0,
  rageKey: 'j',
  shakeForce: 8,
  blinkDuration: 300
};

const state = {
  page: 'upload',
  currentAnim: 'mouth',
  originalSkinFaces: null,
  skinFaces: null,
  mouthStages: [],
  blinkStages: [],
  rageStage: null,
  eyeMask: null,
  mouthCount: 6,
  hasBlinking: true,
  hasRage: true,
  blinkFrequency: 5,
  blinkOnlyEyes: false,
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  gridRes: 16,
  tool: 'brush',
  mode: 'view',
  rot: {x: 20 * DEG, y: 15 * DEG, z: 10 * DEG},
  showHat: true,
  showBase: true,
  hsv: {h:0, s:1, v:1},
  syncDrawing: true,
  activeStageIdx: 0,
  undoStack: [],
  redoStack: [],
  eyeMaskMode: 'paint'
};

let views = [];
let painting = null;
let pendingRender = false;

let audioCtx = null;
let micStream = null;
let analyser = null;
let audioBuf = null;

let previewRafId = null;
let previewIsBlinking = false;
let previewBlinkIdx = 0;
let previewLastBlink = 0;
let previewLastRender = 0;
let lastLevel = 1;
let smoothVolume = 0;

let testRafId = null;
let testBlinkTimer = null;
let testIsRage = false;
let testIsBlinking = false;
let testBlinkIdx = 0;
let testLevel = 1;
let testLastRender = 0;
let testSmooth = 0;

/* ============ Математика ============ */

function eulerMatrix(rx, ry, rz){
  const cx=Math.cos(rx), sx=Math.sin(rx);
  const cy=Math.cos(ry), sy=Math.sin(ry);
  const cz=Math.cos(rz), sz=Math.sin(rz);
  const a00=cz, a01=-sz, a02=0;
  const a10=cx*sz, a11=cx*cz, a12=-sx;
  const a20=sx*sz, a21=sx*cz, a22=cx;
  return [
    cy*a00+sy*a20, cy*a01+sy*a21, cy*a02+sy*a22,
    a10, a11, a12,
    -sy*a00+cy*a20, -sy*a01+cy*a21, -sy*a02+cy*a22
  ];
}
function boxHit(ox,oy,oz, dx,dy,dz, s){
  let tn=-Infinity, tf=Infinity, an=-1, sn=0, af=-1, sf=0;
  const o=[ox,oy,oz], d=[dx,dy,dz];
  for(let a=0;a<3;a++){
    if(Math.abs(d[a])<1e-12){
      if(o[a]<-s || o[a]>s) return null;
    } else {
      let t1=(-s-o[a])/d[a], t2=(s-o[a])/d[a];
      let s1=-1, s2=1;
      if(t1>t2){ const t=t1; t1=t2; t2=t; s1=1; s2=-1; }
      if(t1>tn){ tn=t1; an=a; sn=s1; }
      if(t2<tf){ tf=t2; af=a; sf=s2; }
    }
  }
  if(tn>tf || tf<0) return null;
  return {tn,tf,an,sn,af,sf};
}
function hsvToRgb(h,s,v){
  const i = Math.floor(h*6), f = h*6-i;
  const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  let r,g,b;
  switch(i%6){
    case 0: r=v; g=t; b=p; break;
    case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break;
    case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break;
    default:r=v; g=p; b=q;
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function computeMaxRadius(rot){
  const m = eulerMatrix(rot.x, rot.y, rot.z);
  const s = CUBE_HAT;
  let maxR2 = 0;
  for(let vx=-1;vx<=1;vx+=2) for(let vy=-1;vy<=1;vy+=2) for(let vz=-1;vz<=1;vz+=2){
    const x = vx*s, y = vy*s, z = vz*s;
    const rx = m[0]*x + m[1]*y + m[2]*z;
    const ry = m[3]*x + m[4]*y + m[5]*z;
    const r2 = rx*rx + ry*ry;
    if(r2 > maxR2) maxR2 = r2;
  }
  return Math.sqrt(maxR2);
}
function getViewRadius(rot){ return Math.max(computeMaxRadius(rot) * 1.08, 1); }

/* ============ Утилиты ============ */

function arrayToBase64(arr){
  let binary = '';
  const len = arr.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToArray(b64){
  const binary = atob(b64);
  const len = binary.length;
  const arr = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}
function makeStage(){
  return {base: new Uint8ClampedArray(MAX_RES*MAX_RES*4), hat: new Uint8ClampedArray(MAX_RES*MAX_RES*4)};
}
function cloneStage(s){
  if(!s) return null;
  return {base: new Uint8ClampedArray(s.base), hat: new Uint8ClampedArray(s.hat)};
}

function layerToPNGBase64(layer) {
  const cv = document.createElement('canvas');
  cv.width = MAX_RES; cv.height = MAX_RES;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(MAX_RES, MAX_RES);
  img.data.set(layer);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
function pngBase64ToLayer(b64, callback) {
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, MAX_RES, MAX_RES);
    callback(new Uint8ClampedArray(data.data.buffer));
  };
  img.src = b64;
}

function makeFacesFromSkin(data){
  const faces = {};
  const OUT = MAX_RES;
  const block = OUT / 8;
  for(const f of FACE_NAMES){
    const base = new Uint8ClampedArray(OUT*OUT*4);
    const hat  = new Uint8ClampedArray(OUT*OUT*4);
    for(let y=0;y<OUT;y++){
      const sy = Math.min(7, (y / block) | 0);
      for(let x=0;x<OUT;x++){
        const sx = Math.min(7, (x / block) | 0);
        const d = (y*OUT+x)*4;
        let o = ((FACE_UV.base[f][1]+sy)*64 + (FACE_UV.base[f][0]+sx))*4;
        base[d]=data[o]; base[d+1]=data[o+1]; base[d+2]=data[o+2]; base[d+3]=data[o+3];
        o = ((FACE_UV.hat[f][1]+sy)*64 + (FACE_UV.hat[f][0]+sx))*4;
        hat[d]=data[o]; hat[d+1]=data[o+1]; hat[d+2]=data[o+2]; hat[d+3]=data[o+3];
      }
    }
    faces[f] = {base, hat};
  }
  return faces;
}
function cloneFaces(faces){
  const out = {};
  for(const f of FACE_NAMES){
    out[f] = {base: new Uint8ClampedArray(faces[f].base), hat: new Uint8ClampedArray(faces[f].hat)};
  }
  return out;
}
function getFacesForStage(stage){
  if(!state.skinFaces || !stage) return null;
  return {
    top: state.skinFaces.top,
    bottom: state.skinFaces.bottom,
    right: state.skinFaces.right,
    front: stage,
    left: state.skinFaces.left,
    back: state.skinFaces.back
  };
}
function activeLayer(){
  if(state.showHat) return 'hat';
  if(state.showBase) return 'base';
  return null;
}

/* ============ Рендер ============ */

function renderHead(imgData, rot, faces){
  const size = MAX_RES;
  const d = imgData.data;
  const N = MAX_RES;
  const R_VIEW = getViewRadius(rot);

  for(let p=0;p<size*size;p++){ const o = p*4; d[o]=d[o+1]=d[o+2]=d[o+3]=0; }
  if(!faces) return;

  const m = eulerMatrix(rot.x, rot.y, rot.z);
  const mt = [m[0],m[3],m[6], m[1],m[4],m[7], m[2],m[5],m[8]];

  const cubes = [];
  if(state.showHat)  cubes.push({s:CUBE_HAT,  layer:'hat'});
  if(state.showBase) cubes.push({s:CUBE_BASE, layer:'base'});
  if(!cubes.length) return;

  const ht=[0,0,0,0], ha=[0,0,0,0], hs=[0,0,0,0], hsc=[0,0,0,0], hl=['','','',''];

  for(let j=0;j<size;j++){
    const py = (1-(j+0.5)/size*2)*R_VIEW;
    for(let i=0;i<size;i++){
      const px = ((i+0.5)/size*2-1)*R_VIEW;
      const ox = mt[0]*px + mt[1]*py + mt[2]*100;
      const oy = mt[3]*px + mt[4]*py + mt[5]*100;
      const oz = mt[6]*px + mt[7]*py + mt[8]*100;
      const dx = -mt[2], dy = -mt[5], dz = -mt[8];

      let n = 0;
      for(let c=0;c<cubes.length;c++){
        const cb = cubes[c];
        const h = boxHit(ox,oy,oz,dx,dy,dz,cb.s);
        if(!h) continue;
        if(h.tn>0){ ht[n]=h.tn; ha[n]=h.an; hs[n]=h.sn; hsc[n]=cb.s; hl[n]=cb.layer; n++; }
        if(h.tf>0){ ht[n]=h.tf; ha[n]=h.af; hs[n]=h.sf; hsc[n]=cb.s; hl[n]=cb.layer; n++; }
      }
      for(let a=1;a<n;a++){
        const t=ht[a], ax=ha[a], sg=hs[a], sc=hsc[a], ly=hl[a];
        let b=a-1;
        while(b>=0 && ht[b]>t){
          ht[b+1]=ht[b]; ha[b+1]=ha[b]; hs[b+1]=hs[b]; hsc[b+1]=hsc[b]; hl[b+1]=hl[b]; b--;
        }
        ht[b+1]=t; ha[b+1]=ax; hs[b+1]=sg; hsc[b+1]=sc; hl[b+1]=ly;
      }

      for(let k=0;k<n;k++){
        const t = ht[k], s = hsc[k];
        const X = ox+dx*t, Y = oy+dy*t, Z = oz+dz*t;
        const uu = X/(2*s)+0.5, vv = 0.5-Y/(2*s), ww = Z/(2*s)+0.5;
        let face, u, v;
        const ax = ha[k], sg = hs[k];
        if(ax===0){ v=vv; if(sg>0){ face='left'; u=1-ww; } else { face='right'; u=ww; } }
        else if(ax===1){ u=uu; if(sg>0){ face='top'; v=ww; } else { face='bottom'; v=1-ww; } }
        else { v=vv; if(sg>0){ face='front'; u=uu; } else { face='back'; u=1-uu; } }

        const tex = faces[face][hl[k]];
        const tx = Math.min(N-1, Math.max(0, (u*N)|0));
        const ty = Math.min(N-1, Math.max(0, (v*N)|0));
        const o = (ty*N+tx)*4;
        if(tex[o+3] > 0){
          const p = (j*size+i)*4;
          d[p]=tex[o]; d[p+1]=tex[o+1]; d[p+2]=tex[o+2]; d[p+3]=tex[o+3];
          break;
        }
      }
    }
  }
}

function renderFlatFace(imgData, stage){
  const size = MAX_RES;
  const d = imgData.data;
  for(let p=0;p<size*size;p++){ const o = p*4; d[o]=d[o+1]=d[o+2]=d[o+3]=0; }
  if(!stage) return;
  if(state.showBase) blitLayer(d, size, stage.base);
  if(state.showHat)  blitLayer(d, size, stage.hat);
}
function blitLayer(dst, size, tex){
  for(let i=0;i<size*size;i++){
    const o = i*4;
    const a = tex[o+3];
    if(a === 0) continue;
    if(a === 255){
      dst[o]=tex[o]; dst[o+1]=tex[o+1]; dst[o+2]=tex[o+2]; dst[o+3]=255;
    } else {
      const sa = a/255, da = dst[o+3]/255;
      const oa = sa + da*(1-sa);
      if(oa > 0){
        dst[o]   = (tex[o]*sa   + dst[o]*da*(1-sa)) / oa;
        dst[o+1] = (tex[o+1]*sa + dst[o+1]*da*(1-sa)) / oa;
        dst[o+2] = (tex[o+2]*sa + dst[o+2]*da*(1-sa)) / oa;
        dst[o+3] = oa*255;
      }
    }
  }
}
function makeEyeOverlayFaces(stage, mask){
  const blank = () => new Uint8ClampedArray(MAX_RES*MAX_RES*4);
  const maskedBase = new Uint8ClampedArray(stage.base);
  const maskedHat  = new Uint8ClampedArray(stage.hat);
  if(mask){
    for(let i=0;i<MAX_RES*MAX_RES;i++){
      if(!mask[i]){
        const o = i*4;
        maskedBase[o+3] = 0;
        maskedHat[o+3]  = 0;
      }
    }
  }
  return {
    top:    {base: blank(), hat: blank()},
    bottom: {base: blank(), hat: blank()},
    right:  {base: blank(), hat: blank()},
    left:   {base: blank(), hat: blank()},
    back:   {base: blank(), hat: blank()},
    front:  {base: maskedBase, hat: maskedHat}
  };
}

function drawGridOverlay(ctx, N){
  const size = MAX_RES;
  const step = size / N;
  ctx.strokeStyle = N >= 128 ? 'rgba(255,255,255,0.05)' : (N >= 32 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)');
  ctx.lineWidth = 1;
  for(let i=1;i<N;i++){
    const p = Math.round(i*step) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
}

/* ============ Аудио ============ */

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

/* ============ Страницы ============ */

function showPage(name){
  document.querySelectorAll('.page').forEach(p => p.classList.remove('visible'));
  const target = document.getElementById('page-' + name);
  if(target) target.classList.add('visible');
  state.page = name;
  updateHeaderTools();
  updateFooter();
  updatePreviewPanel();

  if(['mouth','blink','rage'].includes(name)){
    state.currentAnim = name;
    if(name === 'blink' && state.blinkStages.length === 0) initBlinkStages();
    if(name === 'rage' && !state.rageStage) createRageStage();
    buildCarousel();
    if (name === 'blink') {
      document.getElementById('blinkOnlyEyesCheckbox').checked = state.blinkOnlyEyes;
    }
  }
  if(name === 'test') startTest();
  else stopTest();
  if(!['mouth','blink'].includes(name)) stopPreview();

  if(name === 'eyeselect') initEyeCanvas();
}

function updateHeaderTools(){
  const editPages = ['mouth', 'blink', 'rage', 'eyeselect'];
  const t = document.getElementById('global-tools');
  if(editPages.includes(state.page)) t.classList.remove('hidden');
  else t.classList.add('hidden');

  document.getElementById('btnLayerBase').style.background = state.showBase ? '#173229' : '#182031';
  document.getElementById('btnLayerBase').style.borderColor = state.showBase ? 'var(--acc)' : '#2a3242';
  document.getElementById('btnLayerBase').style.color = state.showBase ? 'var(--acc)' : '#dbe3f2';

  document.getElementById('btnLayerHat').style.background = state.showHat ? '#173229' : '#182031';
  document.getElementById('btnLayerHat').style.borderColor = state.showHat ? 'var(--acc)' : '#2a3242';
  document.getElementById('btnLayerHat').style.color = state.showHat ? 'var(--acc)' : '#dbe3f2';
}

function updateFooter(){
  const f = document.getElementById('footer');
  const back = document.getElementById('btnBack');
  const next = document.getElementById('btnNext');
  const confirm = document.getElementById('btnConfirm');
  const thickness = document.getElementById('thicknessGroup');

  back.classList.add('hidden');
  next.classList.add('hidden');
  confirm.classList.add('hidden');

  if(['mouth','blink','rage'].includes(state.page)){
    f.classList.remove('hidden');
    thickness.style.display = '';
    if(state.page !== 'mouth') back.classList.remove('hidden');
    next.classList.remove('hidden');
  } else if(state.page === 'eyeselect'){
    f.classList.remove('hidden');
    thickness.style.display = '';
    back.classList.remove('hidden');
    next.classList.remove('hidden');
  } else if(state.page === 'test'){
    f.classList.remove('hidden');
    thickness.style.display = 'none';
    back.classList.remove('hidden');
    confirm.classList.remove('hidden');
  } else if(state.page === 'download'){
    f.classList.remove('hidden');
    thickness.style.display = 'none';
    back.classList.remove('hidden');
  } else {
    f.classList.add('hidden');
  }
}

function updatePreviewPanel(){
  const p = document.getElementById('preview-panel');
  const blinkFreqWrap = document.getElementById('blinkFreqWrap');
  if(['mouth','blink'].includes(state.page)){
    p.classList.remove('hidden');
    if(state.page === 'blink'){
      blinkFreqWrap.classList.remove('hidden');
      document.getElementById('prevTitle').textContent = 'МОРГАНИЕ';
      document.getElementById('blinkFreqSlider').value = Math.round(state.blinkFrequency * 10);
    } else {
      blinkFreqWrap.classList.add('hidden');
      document.getElementById('prevTitle').textContent = 'ПРЕДПРОСМОТР';
    }
    startPreview();
  } else {
    p.classList.add('hidden');
  }
}

function currentStages(){
  if(state.currentAnim === 'mouth') return state.mouthStages;
  if(state.currentAnim === 'blink') return state.blinkStages;
  if(state.currentAnim === 'rage')  return state.rageStage ? [state.rageStage] : [];
  return [];
}

/* ============ Undo/Redo ============ */

function pushUndo(){
  const stages = currentStages().map(cloneStage);
  state.undoStack.push({type: state.currentAnim, stages});
  if(state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
  updateUndoButtons();
}
function undo(){
  if(!state.undoStack.length) return;
  const stages = currentStages().map(cloneStage);
  state.redoStack.push({type: state.currentAnim, stages});
  const snap = state.undoStack.pop();
  if(snap.type !== state.currentAnim){ state.undoStack.push(snap); return; }
  applyStages(snap.stages);
  updateUndoButtons();
  buildCarousel();
  renderAll();
}
function redo(){
  if(!state.redoStack.length) return;
  const stages = currentStages().map(cloneStage);
  state.undoStack.push({type: state.currentAnim, stages});
  const snap = state.redoStack.pop();
  if(snap.type !== state.currentAnim){ state.redoStack.push(snap); return; }
  applyStages(snap.stages);
  updateUndoButtons();
  buildCarousel();
  renderAll();
}
function applyStages(stages){
  if(state.currentAnim === 'mouth') state.mouthStages = stages;
  else if(state.currentAnim === 'blink') state.blinkStages = stages;
  else if(state.currentAnim === 'rage') state.rageStage = stages[0] || null;
}
function updateUndoButtons(){
  document.getElementById('btnUndo').disabled = state.undoStack.length === 0;
  document.getElementById('btnRedo').disabled = state.redoStack.length === 0;
}

/* ============ Карусель ============ */

function buildTabs(containerId){
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  const entries = [
    {key:'mouth', label:'Рот',    available: state.mouthStages.length > 0},
    {key:'blink', label:'Моргание', available: state.hasBlinking},
    {key:'rage',  label:'Rage',   available: state.hasRage}
  ].filter(e => e.available);

  if(entries.length < 2) return;

  for(const e of entries){
    const b = document.createElement('button');
    b.textContent = e.label;
    if(e.key === state.currentAnim) b.classList.add('active');
    b.addEventListener('click', () => {
      if(e.key === state.currentAnim) return;
      state.activeStageIdx = 0;
      showPage(e.key);
    });
    c.appendChild(b);
  }
}

function buildCarousel(){
  let trackId = 'carouselTrack';
  if (state.currentAnim === 'blink') trackId = 'carouselTrackB';
  else if (state.currentAnim === 'rage') trackId = 'carouselTrackR';

  const track = document.getElementById(trackId);
  if (!track) return;

  track.innerHTML = '';
  views = [];
  const stages = currentStages();

  buildTabs('animTabs');
  buildTabs('animTabsB');
  buildTabs('animTabsR');

  stages.forEach((stage, i) => {
    const card = document.createElement('div');
    card.className = 'stage-card' + (i === state.activeStageIdx ? ' active' : '');
    card.dataset.idx = i;

    const head = document.createElement('div');
    head.className = 'card-head';
    const num = document.createElement('div');
    num.className = 'card-num';
    num.textContent = 'ЭТАП ' + (i+1);
    head.appendChild(num);

    if(stages.length > 1 && state.currentAnim !== 'rage'){
      const del = document.createElement('button');
      del.className = 'btn-del';
      del.textContent = '🗑';
      del.title = 'Удалить';
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteStage(i); });
      head.appendChild(del);
    }
    card.appendChild(head);

    const cv = document.createElement('canvas');
    cv.className = 'stage-canvas';
    cv.width = MAX_RES; cv.height = MAX_RES;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    card.appendChild(cv);

    track.appendChild(card);
    views.push({card, cv, ctx, img: ctx.createImageData(MAX_RES, MAX_RES)});

    cv.addEventListener('pointerdown', e => {
      if(state.mode !== 'edit') return;
      if(!activeLayer()) return;
      if(i !== state.activeStageIdx){ setActiveStage(i); return; }
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      pushUndo();
      painting = {idx: i, last: null};
      paintFromEvent(e, i);
    });
    cv.addEventListener('pointermove', e => {
      if(!painting || painting.idx !== i) return;
      e.preventDefault();
      paintFromEvent(e, i);
    });
    const stop = () => { if(painting && painting.idx === i) painting = null; };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);

    card.addEventListener('click', (e) => {
      if(e.target.tagName === 'CANVAS') return;
      setActiveStage(i, false);
    });
  });

  if(state.currentAnim !== 'rage'){
    const addCard = document.createElement('div');
    addCard.className = 'stage-card add-card';
    addCard.innerHTML = '<div class="plus">＋</div>';
    addCard.title = 'Добавить этап';
    addCard.addEventListener('click', addStage);
    track.appendChild(addCard);
  }

  for(let i=0;i<views.length;i++) renderOne(i);

  const active = track.querySelector('.stage-card.active');
  if(active) active.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});

  updateArrows();
}

function setActiveStage(i, doScroll = true){
  if(i < 0 || i >= currentStages().length) return;
  state.activeStageIdx = i;

  let trackId = 'carouselTrack';
  if (state.currentAnim === 'blink') trackId = 'carouselTrackB';
  else if (state.currentAnim === 'rage') trackId = 'carouselTrackR';

  document.querySelectorAll('.stage-card').forEach(c => c.classList.remove('active'));

  const track = document.getElementById(trackId);
  if(!track) return;

  const card = track.querySelector(`.stage-card[data-idx="${i}"]`);
  if(card){
    card.classList.add('active');
    if(doScroll) card.scrollIntoView({behavior:'smooth', block:'nearest', inline:'center'});
  }
  updateArrows();
}

function updateArrows(){
  const stages = currentStages();
  const isSingle = stages.length <= 1;
  for(const prefix of ['stagePrev','stageNext','stagePrevB','stageNextB','stagePrevR','stageNextR']){
    const el = document.getElementById(prefix);
    if(!el) continue;
    if(isSingle){ el.disabled = true; continue; }
    if(prefix.includes('Prev')) el.disabled = state.activeStageIdx <= 0;
    else el.disabled = state.activeStageIdx >= stages.length - 1;
  }
}

function addStage(){
  const stages = currentStages();
  const base = stages[state.activeStageIdx];
  let newStage = base ? cloneStage(base) : makeStage();
  if(!base && state.skinFaces){
    newStage.base.set(state.skinFaces.front.base);
    newStage.hat.set(state.skinFaces.front.hat);
  }
  pushUndo();
  stages.push(newStage);
  state.activeStageIdx = stages.length - 1;
  buildCarousel();
  renderAll();
}
function deleteStage(i){
  const stages = currentStages();
  if(stages.length <= 1) return;
  pushUndo();
  stages.splice(i, 1);
  if(state.activeStageIdx >= stages.length) state.activeStageIdx = stages.length - 1;
  buildCarousel();
  renderAll();
}

/* ============ Рендер этапов ============ */

function renderOne(idx){
  const v = views[idx];
  const stages = currentStages();
  const stage = stages[idx];
  if(!v || !stage) return;

  if (state.currentAnim === 'blink' && state.blinkOnlyEyes && state.eyeMask) {
    if (state.mode === 'edit') {
      renderBlinkFlatEyeOnly(v.img, stage);
    } else {
      renderHead(v.img, state.rot, makeEyeOverlayFaces(stage, state.eyeMask));
    }
  } else if (state.mode === 'edit') {
    renderFlatFace(v.img, stage);
  } else {
    renderHead(v.img, state.rot, getFacesForStage(stage));
  }

  v.ctx.putImageData(v.img, 0, 0);
  if(state.mode === 'edit') drawGridOverlay(v.ctx, state.gridRes);
}

function renderBlinkFlatEyeOnly(imgData, stage){
  const size = MAX_RES;
  const d = imgData.data;
  for(let p=0;p<size*size;p++){ const o = p*4; d[o]=d[o+1]=d[o+2]=d[o+3]=0; }
  if(!stage) return;

  const baseStage = state.mouthStages[0] || {base: state.skinFaces.front.base, hat: state.skinFaces.front.hat};

  if(state.showBase) blitLayer(d, size, baseStage.base);
  if(state.showHat)  blitLayer(d, size, baseStage.hat);

  for (let i=0; i<size*size; i++) {
    if (!state.eyeMask[i]) {
      const o = i*4;
      if (d[o+3] > 0) {
        d[o] = Math.floor(d[o] * 0.3);
        d[o+1] = Math.floor(d[o+1] * 0.3);
        d[o+2] = Math.floor(d[o+2] * 0.3);
      }
    }
  }

  if(state.showBase) blitMasked(d, size, stage.base, state.eyeMask);
  if(state.showHat)  blitMasked(d, size, stage.hat,  state.eyeMask);
}

function blitMasked(dst, size, tex, mask){
  for(let i=0;i<size*size;i++){
    if(!mask[i]) continue;
    const o = i*4;
    const a = tex[o+3];
    if(a === 0) continue;
    if(a === 255){
      dst[o]=tex[o]; dst[o+1]=tex[o+1]; dst[o+2]=tex[o+2]; dst[o+3]=255;
    } else {
      const sa = a/255, da = dst[o+3]/255;
      const oa = sa + da*(1-sa);
      if(oa > 0){
        dst[o]   = (tex[o]*sa   + dst[o]*da*(1-sa)) / oa;
        dst[o+1] = (tex[o+1]*sa + dst[o+1]*da*(1-sa)) / oa;
        dst[o+2] = (tex[o+2]*sa + dst[o+2]*da*(1-sa)) / oa;
        dst[o+3] = oa*255;
      }
    }
  }
}

function renderAll(){
  if(!state.skinFaces) return;
  for(let i=0;i<views.length;i++) renderOne(i);
  if(state.page === 'mouth' || state.page === 'blink') renderPreview();
}

function requestRender(){
  if(pendingRender) return;
  pendingRender = true;
  requestAnimationFrame(() => {
    pendingRender = false;
    renderAll();
  });
}

/* ============ Рисование ============ */

function paintFromEvent(e, idx){
  if(!painting) return;
  const layer = activeLayer();
  if(!layer) return;
  const v = views[idx];
  if(!v) return;
  const rect = v.cv.getBoundingClientRect();
  const nx = (e.clientX - rect.left) / rect.width;
  const ny = (e.clientY - rect.top) / rect.height;
  if(nx < 0 || nx >= 1 || ny < 0 || ny >= 1){ painting.last = null; return; }

  const N = state.gridRes;
  const gx = Math.min(N-1, Math.max(0, Math.floor(nx * N)));
  const gy = Math.min(N-1, Math.max(0, Math.floor(ny * N)));
  const hit = {gx, gy, layer, srcIdx: idx};

  if(painting.last && painting.last.layer === hit.layer){
    paintLine(painting.last, hit);
  } else {
    applyBrush(idx, hit.layer, hit.gx, hit.gy);
  }
  painting.last = hit;
  requestRender();
}

function applyBrush(viewIdx, layer, gx, gy){
  const stages = currentStages();
  if(state.syncDrawing && state.currentAnim !== 'rage'){
    for(let i=0;i<stages.length;i++) _applyBrush(i, layer, gx, gy);
  } else {
    _applyBrush(viewIdx, layer, gx, gy);
  }
}
function _applyBrush(viewIdx, layer, gx, gy){
  if(state.tool === 'restore') restoreBlock(viewIdx, layer, gx, gy);
  else if(state.tool === 'erase') eraseBlock(viewIdx, layer, gx, gy);
  else paintBlock(viewIdx, layer, gx, gy);
}
function paintBlock(viewIdx, layer, gx, gy){
  const stage = currentStages()[viewIdx];
  if(!stage) return;
  const block = MAX_RES / state.gridRes;
  const rgb = hsvToRgb(state.hsv.h, state.hsv.s, state.hsv.v);
  const tex = stage[layer];
  const x0 = gx * block, y0 = gy * block;
  for(let y=y0; y<y0+block; y++){
    let o = (y*MAX_RES + x0) * 4;
    for(let x=x0; x<x0+block; x++){
      tex[o]=rgb[0]; tex[o+1]=rgb[1]; tex[o+2]=rgb[2]; tex[o+3]=255;
      o += 4;
    }
  }
}
function eraseBlock(viewIdx, layer, gx, gy){
  const stage = currentStages()[viewIdx];
  if(!stage) return;
  const block = MAX_RES / state.gridRes;
  const tex = stage[layer];
  const x0 = gx * block, y0 = gy * block;
  for(let y=y0; y<y0+block; y++){
    let o = (y*MAX_RES + x0) * 4;
    for(let x=x0; x<x0+block; x++){
      tex[o]=0; tex[o+1]=0; tex[o+2]=0; tex[o+3]=0;
      o += 4;
    }
  }
}
function restoreBlock(viewIdx, layer, gx, gy){
  const stage = currentStages()[viewIdx];
  if(!stage || !state.originalSkinFaces) return;
  const block = MAX_RES / state.gridRes;
  const tex = stage[layer];
  const otex = state.originalSkinFaces.front[layer];
  const x0 = gx * block, y0 = gy * block;
  for(let y=y0; y<y0+block; y++){
    let o = (y*MAX_RES + x0) * 4;
    for(let x=x0; x<x0+block; x++){
      tex[o]   = otex[o];
      tex[o+1] = otex[o+1];
      tex[o+2] = otex[o+2];
      tex[o+3] = otex[o+3];
      o += 4;
    }
  }
}
function paintLine(a, b){
  let x0=a.gx, y0=a.gy;
  const x1=b.gx, y1=b.gy;
  const dx = Math.abs(x1-x0), sx = x0<x1?1:-1;
  const dy = -Math.abs(y1-y0), sy = y0<y1?1:-1;
  let err = dx+dy;
  for(;;){
    applyBrush(a.srcIdx, a.layer, x0, y0);
    if(x0===x1 && y0===y1) break;
    const e2 = 2*err;
    if(e2 >= dy){ err += dy; x0 += sx; }
    if(e2 < dx){ err += dx; y0 += sy; }
  }
}

/* ============ Превью ============ */

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

  // Моргание всегда накладывается (базовый кадр 0)
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

/* ============ Маска ============ */

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

/* ============ Тест ============ */

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

  // Добавляем кнопку авто-распределения
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

/* ============ Клавиатура ============ */

document.addEventListener('keydown', e => {
  if(!document.getElementById('tourWrap').classList.contains('hidden')){
    if(e.code === 'ArrowRight'){ e.preventDefault(); tourNext(); return; }
    if(e.code === 'ArrowLeft'){ e.preventDefault(); tourPrev(); return; }
    if(e.code === 'Escape'){ e.preventDefault(); closeTour(); return; }
  }

  const inInput = document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName);

  if((e.ctrlKey || e.metaKey) && !e.altKey){
    if(e.code === 'KeyZ' && !e.shiftKey){ e.preventDefault(); undo(); return; }
    if((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY'){ e.preventDefault(); redo(); return; }
  }
  if(!state.skinFaces) return;

  if(e.code === 'Tab' && !inInput){
    e.preventDefault();
    document.getElementById('picker').classList.toggle('hidden');
    return;
  }
  if(e.code === 'Escape'){ document.getElementById('picker').classList.add('hidden'); return; }

  if(state.page === 'test'){
    if(!inInput && e.key.toLowerCase() === state.settings.rageKey.toLowerCase() && !e.repeat){
      e.preventDefault();
      testIsRage = true;
      testIsBlinking = false;
      return;
    }
  }

  if(inInput) return;

  if(e.code === 'Space'){
    e.preventDefault();
    state.showHat = !state.showHat;
    updateHeaderTools();
    requestRender();
    return;
  }
  if(e.key === 'Alt'){ e.preventDefault(); state.showBase = !state.showBase; updateHeaderTools(); requestRender(); return; }

  if(state.mode === 'edit' && !e.ctrlKey && !e.metaKey && !e.altKey){
    if(e.code === 'KeyB'){ e.preventDefault(); setTool('brush'); return; }
    if(e.code === 'KeyX'){ e.preventDefault(); setTool('erase'); return; }
    if(e.code === 'KeyR'){ e.preventDefault(); setTool('restore'); return; }
  }
  if(state.mode === 'edit') return;

  const step = 5 * DEG;
  switch(e.code){
    case 'KeyQ': state.rot.y -= step; break;
    case 'KeyE': state.rot.y += step; break;
    case 'KeyW': state.rot.x -= step; break;
    case 'KeyS': state.rot.x += step; break;
    case 'KeyA': state.rot.z -= step; break;
    case 'KeyD': state.rot.z += step; break;
    default: return;
  }
  e.preventDefault();
  requestRender();
});
document.addEventListener('keyup', e => {
  if(e.key === 'Alt') e.preventDefault();
  if(state.page === 'test' && e.key.toLowerCase() === state.settings.rageKey.toLowerCase()){
    testIsRage = false;
  }
});

/* ============ Инструменты ============ */

function setTool(tool){
  if(state.mode !== 'edit') return;
  state.tool = tool;
  document.querySelectorAll('[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  document.body.classList.toggle('tool-brush', tool === 'brush');
  document.body.classList.toggle('tool-erase', tool === 'erase');
  document.body.classList.toggle('tool-restore', tool === 'restore');
  document.getElementById('picker').classList.toggle('hidden', tool !== 'brush');
}

document.querySelectorAll('[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);

document.getElementById('btnMode').addEventListener('click', () => {
  if(state.mode === 'view'){
    state.mode = 'edit';
    document.getElementById('btnMode').textContent = '3D';
    document.body.classList.add('editing');
    if(state.tool === 'brush') document.getElementById('picker').classList.remove('hidden');
  } else {
    state.mode = 'view';
    document.getElementById('btnMode').textContent = '2D';
    document.body.classList.remove('editing');
    document.getElementById('picker').classList.add('hidden');
  }
  renderAll();
});

document.getElementById('btnLayerBase').addEventListener('click', () => {
  state.showBase = !state.showBase;
  updateHeaderTools();
  renderAll();
});
document.getElementById('btnLayerHat').addEventListener('click', () => {
  state.showHat = !state.showHat;
  updateHeaderTools();
  renderAll();
});

document.getElementById('syncDrawCheckbox').addEventListener('change', e => {
  state.syncDrawing = e.target.checked;
});

document.getElementById('blinkOnlyEyesCheckbox').addEventListener('change', e => {
  state.blinkOnlyEyes = e.target.checked;
  renderAll();
});

document.querySelectorAll('#thicknessIcons button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#thicknessIcons button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.gridRes = parseInt(btn.dataset.res, 10);
    if(state.page === 'eyeselect') renderEyeCanvas();
    else renderAll();
  });
});

document.getElementById('blinkFreqSlider').addEventListener('input', e => {
  state.blinkFrequency = parseInt(e.target.value, 10) / 10;
  state.settings.blinkInterval = state.blinkFrequency;
});

for(const [prevId, nextId] of [['stagePrev','stageNext'],['stagePrevB','stageNextB'],['stagePrevR','stageNextR']]){
  document.getElementById(prevId).addEventListener('click', () => {
    setActiveStage(Math.max(0, state.activeStageIdx - 1), true);
  });
  document.getElementById(nextId).addEventListener('click', () => {
    setActiveStage(Math.min(currentStages().length - 1, state.activeStageIdx + 1), true);
  });
}
for(const vpId of ['carouselViewport','carouselViewportB','carouselViewportR']){
  document.getElementById(vpId).addEventListener('wheel', e => {
    if(Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    e.preventDefault();
    if(e.deltaY > 0) setActiveStage(Math.min(currentStages().length - 1, state.activeStageIdx + 1), true);
    else setActiveStage(Math.max(0, state.activeStageIdx - 1), true);
  }, {passive: false});
}

document.getElementById('btnGoEyeMask').addEventListener('click', () => {
  showPage('eyeselect');
});

/* ============ Цветовое колесо ============ */

function drawWheel(){
  const c = document.getElementById('wheel');
  const ctx = c.getContext('2d');
  const size = c.width;
  const img = ctx.createImageData(size, size);
  const rad = size/2;
  for(let y=0;y<size;y++){
    for(let x=0;x<size;x++){
      const dx = x-rad+0.5, dy = y-rad+0.5;
      const r = Math.sqrt(dx*dx+dy*dy);
      const p = (y*size+x)*4;
      if(r > rad){ img.data[p+3]=0; continue; }
      let h = Math.atan2(dy,dx)/(Math.PI*2);
      if(h<0) h+=1;
      const s = Math.min(1, r/rad);
      const rgb = hsvToRgb(h, s, 1);
      img.data[p]=rgb[0]; img.data[p+1]=rgb[1]; img.data[p+2]=rgb[2]; img.data[p+3]=255;
    }
  }
  ctx.putImageData(img,0,0);
}
function updateColorUI(){
  const {h,s,v} = state.hsv;
  const rgb = hsvToRgb(h,s,v);
  document.getElementById('curColor').style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  document.getElementById('curHex').textContent =
      '#' + rgb.map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase();
  const rad = 188/2 - 6;
  const mx = 94 + Math.cos(h*Math.PI*2) * s * rad;
  const my = 94 + Math.sin(h*Math.PI*2) * s * rad;
  const mk = document.getElementById('wheelMarker');
  mk.style.left = mx + 'px';
  mk.style.top = my + 'px';
}
function wheelPick(e){
  const c = document.getElementById('wheel');
  const r = c.getBoundingClientRect();
  const x = e.clientX - r.left - r.width/2;
  const y = e.clientY - r.top - r.height/2;
  const rad = r.width/2;
  let h = Math.atan2(y,x)/(Math.PI*2);
  if(h<0) h += 1;
  state.hsv.h = h;
  state.hsv.s = Math.min(1, Math.hypot(x,y)/rad);
  updateColorUI();
}
(function bindWheel(){
  const wheel = document.getElementById('wheel');
  let down = false;
  wheel.addEventListener('pointerdown', e => { e.preventDefault(); down = true; wheel.setPointerCapture(e.pointerId); wheelPick(e); });
  wheel.addEventListener('pointermove', e => { if(down) wheelPick(e); });
  wheel.addEventListener('pointerup', () => down = false);
  wheel.addEventListener('pointercancel', () => down = false);
  document.getElementById('valSlider').addEventListener('input', e => {
    state.hsv.v = parseInt(e.target.value, 10)/100;
    updateColorUI();
  });
})();

/* ============ Загрузка скина ============ */

function loadSkinFromImg(img, onDone){
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0,0,64,64).data;
  state.skinFaces = makeFacesFromSkin(data);
  state.originalSkinFaces = cloneFaces(state.skinFaces);
  state.eyeMask = null;
  document.getElementById('btnCreate').disabled = false;
  if(onDone) onDone();
}

function loadSkinFile(file){
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => { loadSkinFromImg(img); URL.revokeObjectURL(url); };
  img.onerror = () => { URL.revokeObjectURL(url); alert('Не удалось открыть PNG.'); };
  img.src = url;
}

function loadSkinFromDataURL(dataUrl, onDone){
  const img = new Image();
  img.onload = () => loadSkinFromImg(img, onDone);
  img.src = dataUrl;
}

async function loadProjectFromRaw(raw, externalConfig = null){
  if(!raw.skinBase64){ alert('RAW.json повреждён'); return; }

  await new Promise((resolve) => {
    loadSkinFromDataURL(raw.skinBase64, resolve);
  });

  try {
    const loadStage = async (s) => {
      const base = await new Promise(r => pngBase64ToLayer(s.base, r));
      const hat = await new Promise(r => pngBase64ToLayer(s.hat, r));
      return {base, hat};
    };

    state.mouthStages = await Promise.all((raw.mouthStages || []).map(loadStage));
    state.blinkStages = await Promise.all((raw.blinkStages || []).map(loadStage));
    state.rageStage = raw.rageStage ? await loadStage(raw.rageStage) : null;

    if(raw.eyeMask){
      state.eyeMask = new Uint8Array(base64ToArray(raw.eyeMask).buffer);
    }

    // ФИКС 1: Восстанавливаем позу головы (повороты)
    if(raw.rotations){
      state.rot = raw.rotations;
    }

    // ФИКС 2: Приоритет настроек. Если есть config.json (из программы) — берем его,
    // иначе берем из RAW.json, иначе дефолтные.
    if (externalConfig) {
      state.settings.sensitivity = externalConfig.sensitivity ?? DEFAULT_SETTINGS.sensitivity;
      state.settings.thresholds = externalConfig.thresholds ?? DEFAULT_SETTINGS.thresholds;
      state.settings.blinkInterval = externalConfig.blink_interval ?? DEFAULT_SETTINGS.blinkInterval;
      state.settings.rageKey = externalConfig.rage_key ?? DEFAULT_SETTINGS.rageKey;
      state.settings.shakeForce = externalConfig.shake_force ?? DEFAULT_SETTINGS.shakeForce;
      state.settings.blinkDuration = externalConfig.blink_duration ?? DEFAULT_SETTINGS.blinkDuration;
      state.blinkFrequency = state.settings.blinkInterval;
      state.blinkOnlyEyes = externalConfig.blink_only_eyes ?? false;
    } else if (raw.settings) {
      state.settings = {...DEFAULT_SETTINGS, ...raw.settings};
      state.blinkFrequency = state.settings.blinkInterval || 5;
      state.blinkOnlyEyes = raw.blinkOnlyEyes ?? false;
    } else {
      state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      state.blinkFrequency = state.settings.blinkInterval;
      state.blinkOnlyEyes = false;
    }

    state.mouthCount = state.mouthStages.length || 6;
    state.hasBlinking = state.blinkStages.length > 0;
    state.hasRage = !!state.rageStage;

    document.getElementById('mouthCount').value = state.mouthCount;
    document.getElementById('hasBlinking').checked = state.hasBlinking;
    document.getElementById('hasRage').checked = state.hasRage;

    ensureThresholds();
    enterProject();
  } catch(e) {
    console.error(e);
    alert('Ошибка чтения RAW.json. Возможно, файл устарел или повреждён.');
  }
}

const fileInput = document.getElementById('fileInput');
const dz = document.getElementById('dropzone');
dz.addEventListener('click', e => { if(e.target !== fileInput) fileInput.click(); });
fileInput.addEventListener('change', e => { handleFiles(Array.from(e.target.files)); fileInput.value = ''; });
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('over');
  if(e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  if(e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
});

async function handleFiles(files){
  if(!files.length) return;

  const cfgFile = files.find(f => f.name.toLowerCase() === 'config.json');
  const rawFile = files.find(f => f.name.toLowerCase().endsWith('.json') && f.name.toLowerCase() !== 'config.json');

  if(rawFile){
    try {
      const text = await rawFile.text();
      const data = JSON.parse(text);

      let cfgData = null;
      if(cfgFile) {
        const cfgText = await cfgFile.text();
        cfgData = JSON.parse(cfgText);
      }

      if(data.mouthStages || data.skinBase64){ loadProjectFromRaw(data, cfgData); return; }
    } catch(e){ console.warn('RAW parse fail', e); }
  }

  const pngFile = files.find(f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.png'));
  if(pngFile){ loadSkinFile(pngFile); return; }
  alert('Нужен PNG 64×64, RAW.json, или перетащите RAW.json и config.json вместе.');
}

document.getElementById('btnPickDir').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) {
    alert('Твой браузер не поддерживает автоматическое открытие папок. Перетащи файлы вручную.');
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker();
    const rawHandle = await dirHandle.getFileHandle('RAW.json');
    const file = await rawHandle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);

    let cfgData = null;
    try {
      const cfgHandle = await dirHandle.getFileHandle('config.json');
      const cfgFile = await cfgHandle.getFile();
      const cfgText = await cfgFile.text();
      cfgData = JSON.parse(cfgText);
    } catch(e) {
      // config.json не найден, ничего страшного
    }

    if(data.mouthStages || data.skinBase64){
      loadProjectFromRaw(data, cfgData);
    } else {
      alert('В выбранной папке найден файл RAW.json, но он неверного формата.');
    }
  } catch (err) {
    if (err.name === 'NotFoundError') {
      alert('В выбранной папке нет файла RAW.json. Возможно, ты ещё не сохранял проект.');
    } else {
      console.log(err);
    }
  }
});

document.getElementById('btnCreate').addEventListener('click', () => {
  state.mouthCount = parseInt(document.getElementById('mouthCount').value, 10) || 6;
  state.hasBlinking = document.getElementById('hasBlinking').checked;
  state.hasRage = document.getElementById('hasRage').checked;

  state.mouthStages = [];
  for(let i=0;i<state.mouthCount;i++){
    const s = makeStage();
    s.base.set(state.skinFaces.front.base);
    s.hat.set(state.skinFaces.front.hat);
    state.mouthStages.push(s);
  }
  state.blinkStages = [];
  state.rageStage = null;
  state.eyeMask = null;
  state.blinkFrequency = state.settings.blinkInterval || 5;
  state.blinkOnlyEyes = false;
  state.undoStack = [];
  state.redoStack = [];
  updateUndoButtons();
  ensureThresholds();
  enterProject();
});

function enterProject(){
  state.activeStageIdx = 0;
  state.mode = 'view';
  state.tool = 'brush';
  document.getElementById('btnMode').textContent = '2D';
  document.body.classList.remove('editing');
  showPage('mouth');
  setTool('brush');
}

/* ============ Навигация ============ */

document.getElementById('btnNext').addEventListener('click', () => {
  const p = state.page;
  if(p === 'mouth'){
    if(state.hasBlinking){ showPage('eyeselect'); }
    else if(state.hasRage){ createRageStage(); showPage('rage'); }
    else { showPage('test'); }
  } else if(p === 'eyeselect'){
    initBlinkStages();
    showPage('blink');
  } else if(p === 'blink'){
    if(state.hasRage){ createRageStage(); showPage('rage'); }
    else { showPage('test'); }
  } else if(p === 'rage'){
    showPage('test');
  } else if(p === 'download'){
    showPage('test');
  }
});

document.getElementById('btnBack').addEventListener('click', () => {
  const p = state.page;
  if(p === 'test'){
    if(state.hasRage) showPage('rage');
    else if(state.hasBlinking) showPage('blink');
    else showPage('mouth');
  } else if(p === 'rage'){
    if(state.hasBlinking) showPage('blink');
    else showPage('mouth');
  } else if(p === 'blink'){
    showPage('eyeselect');
  } else if(p === 'eyeselect'){
    showPage('mouth');
  } else if(p === 'download'){
    showPage('test');
  }
});

document.getElementById('btnConfirm').addEventListener('click', () => {
  showPage('download');
});

function initBlinkStages(){
  if(state.blinkStages.length) return;
  const count = Math.max(2, 3);
  for(let i=0;i<count;i++){
    const s = makeStage();
    s.base.set(state.skinFaces.front.base);
    s.hat.set(state.skinFaces.front.hat);
    state.blinkStages.push(s);
  }
}
function createRageStage(){
  if(state.rageStage) return;
  state.rageStage = makeStage();
  state.rageStage.base.set(state.skinFaces.front.base);
  state.rageStage.hat.set(state.skinFaces.front.hat);
}

/* ============ Экспорт ============ */

document.getElementById('btnExport').addEventListener('click', async () => {
  const status = document.getElementById('exportStatus');
  status.textContent = 'Собираю файлы…';

  const oldBase = state.showBase;
  const oldHat = state.showHat;
  state.showBase = true;
  state.showHat = true;

  try {
    const files = [];

    const stage1 = state.mouthStages[0];
    for(let i=0; i<state.mouthStages.length; i++){
      const delta = (i > 0) ? stage1 : null;
      files.push({
        name: `image_mouth_${i+1}.png`,
        data: await renderStageToPNG(state.mouthStages[i], delta)
      });
    }

    const baseBlink = state.blinkStages[0];
    for(let i=0;i<state.blinkStages.length;i++){
      const delta = (i > 0) ? baseBlink : state.mouthStages[0];
      files.push({name: `image_blink_${i+1}.png`, data: await renderBlinkToPNG(state.blinkStages[i], delta)});
    }

    if(state.rageStage){
      files.push({name: 'image_rage.png', data: await renderRageToPNG(state.rageStage)});
    }

    files.push({name: 'skin.png', data: await renderSkinPNG()});

    const cfg = {
      sensitivity: state.settings.sensitivity,
      thresholds: state.settings.thresholds,
      blink_interval: state.blinkFrequency,
      rage_key: state.settings.rageKey,
      shake_force: state.settings.shakeForce,
      blink_duration: state.settings.blinkDuration,
      mouth_count: state.mouthStages.length,
      has_blinking: state.blinkStages.length > 0,
      has_rage: !!state.rageStage,
      blink_count: state.blinkStages.length,
      blink_only_eyes: state.blinkOnlyEyes,
      memory_limit_mb: state.settings.memory_limit_mb || 300 // <--- ДОБАВИТЬ ЭТО
    };
    files.push({name: 'config.json', data: new TextEncoder().encode(JSON.stringify(cfg, null, 2))});

    const raw = {
      version: 3,
      skinBase64: await renderSkinDataURL(),
      mouthStages: state.mouthStages.map(s => ({
        base: layerToPNGBase64(s.base),
        hat: layerToPNGBase64(s.hat)
      })),
      blinkStages: state.blinkStages.map(s => ({
        base: layerToPNGBase64(s.base),
        hat: layerToPNGBase64(s.hat)
      })),
      rageStage: state.rageStage ? {
        base: layerToPNGBase64(state.rageStage.base),
        hat: layerToPNGBase64(state.rageStage.hat)
      } : null,
      eyeMask: state.eyeMask ? arrayToBase64(state.eyeMask) : null,
      settings: {
        sensitivity: state.settings.sensitivity,
        thresholds: state.settings.thresholds,
        blinkInterval: state.blinkFrequency,
        rageKey: state.settings.rageKey,
        shakeForce: state.settings.shakeForce,
        blinkDuration: state.settings.blinkDuration
      },
      blinkOnlyEyes: state.blinkOnlyEyes,
      rotations: state.rot
    };
    files.push({name: 'RAW.json', data: new TextEncoder().encode(JSON.stringify(raw))});

    if(window.showDirectoryPicker){
      try {
        const dir = await window.showDirectoryPicker();
        for(const f of files){
          const fh = await dir.getFileHandle(f.name, {create: true});
          const w = await fh.createWritable();
          await w.write(f.data);
          await w.close();
        }
        status.textContent = `✓ Сохранено ${files.length} файлов`;
        return;
      } catch(err){ console.log('dir picker failed', err); }
    }

    const zip = buildZip(files);
    const url = URL.createObjectURL(zip);
    const a = document.createElement('a');
    a.href = url; a.download = 'headvoice_project.zip';
    document.body.appendChild(a); a.click(); a.remove();
    status.textContent = `✓ Скачан zip`;
  } catch(err){
    console.error(err);
    status.textContent = 'Ошибка: ' + err.message;
  } finally {
    state.showBase = oldBase;
    state.showHat = oldHat;
  }
});

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

async function renderSkinPNG(){
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const imgData = ctx.createImageData(64, 64);
  const d = imgData.data;
  const block = MAX_RES / 8;
  for(const f of FACE_NAMES){
    for(const layer of ['base','hat']){
      const uv = FACE_UV[layer][f];
      const tex = state.skinFaces[f][layer];
      for(let sy=0;sy<8;sy++){
        for(let sx=0;sx<8;sx++){
          const srcX = Math.floor((sx + 0.5) * block);
          const srcY = Math.floor((sy + 0.5) * block);
          const so = (srcY*MAX_RES + srcX) * 4;
          const dx = uv[0] + sx;
          const dy = uv[1] + sy;
          const doff = (dy*64 + dx) * 4;
          d[doff]   = tex[so];
          d[doff+1] = tex[so+1];
          d[doff+2] = tex[so+2];
          d[doff+3] = tex[so+3];
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderSkinDataURL(){
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 64;
  const ctx = cv.getContext('2d');
  const imgData = ctx.createImageData(64, 64);
  const d = imgData.data;
  const block = MAX_RES / 8;
  for(const f of FACE_NAMES){
    for(const layer of ['base','hat']){
      const uv = FACE_UV[layer][f];
      const tex = state.skinFaces[f][layer];
      for(let sy=0;sy<8;sy++){
        for(let sx=0;sx<8;sx++){
          const srcX = Math.floor((sx + 0.5) * block);
          const srcY = Math.floor((sy + 0.5) * block);
          const so = (srcY*MAX_RES + srcX) * 4;
          const dx = uv[0] + sx;
          const dy = uv[1] + sy;
          const doff = (dy*64 + dx) * 4;
          d[doff]   = tex[so];
          d[doff+1] = tex[so+1];
          d[doff+2] = tex[so+2];
          d[doff+3] = tex[so+3];
        }
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return cv.toDataURL('image/png');
}

/* ============ ZIP ============ */

function crc32(u8){
  let crc = ~0;
  for(let i=0;i<u8.length;i++){
    crc ^= u8[i];
    for(let j=0;j<8;j++) crc = (crc>>>1) ^ (0xEDB88320 & -(crc&1));
  }
  return (~crc) >>> 0;
}
function buildZip(files){
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for(const f of files){
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true); dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true); dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true); lh.set(name, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + name.length);
    const dv2 = new DataView(ch.buffer);
    dv2.setUint32(0, 0x02014b50, true); dv2.setUint16(4, 20, true);
    dv2.setUint16(6, 20, true); dv2.setUint16(8, 0, true);
    dv2.setUint16(10, 0, true); dv2.setUint16(12, 0, true);
    dv2.setUint16(14, 0, true); dv2.setUint32(16, crc, true);
    dv2.setUint32(20, data.length, true); dv2.setUint32(24, data.length, true);
    dv2.setUint16(28, name.length, true); dv2.setUint16(30, 0, true);
    dv2.setUint16(32, 0, true); dv2.setUint16(34, 0, true);
    dv2.setUint16(36, 0, true); dv2.setUint32(38, 0, true);
    dv2.setUint32(42, offset, true); ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  let cdSize = 0;
  for(const c of central) cdSize += c.length;
  const eocd = new Uint8Array(22);
  const dv3 = new DataView(eocd.buffer);
  dv3.setUint32(0, 0x06054b50, true); dv3.setUint16(8, files.length, true);
  dv3.setUint16(10, files.length, true); dv3.setUint32(12, cdSize, true);
  dv3.setUint32(16, offset, true);
  return new Blob([...parts, ...central, eocd], {type: 'application/zip'});
}

/* ============ Тур ============ */

const TOUR_UPLOAD = [
  {target:'#dropzone', title:'👋 Привет!', text:'Закинь сюда свой скин из Minecraft (файл PNG 64×64). Если ты уже делал скин раньше, нажми «Продолжить из папки» и выбери свой проект.'},
  {target:'#settings-block', title:'⚙️ Параметры', text:'Выбери, сколько будет этапов открытия рта (для голоса). Рекомендуем 6-8. Тут же можно выключить моргание или режим ярости, если они тебе не нужны.'},
  {target:'#btnCreate', title:'🚀 СОЗДАТЬ', text:'Нажми эту кнопку, чтобы перейти к рисованию.'}
];

const TOUR_PROJECT = [
  {page:'mouth', target:'#carouselViewport', title:'🎭 Этапы мимики', text:'Каждый этап — это твой рот в разном положении. Этап 1 — это рот закрыт. Этап 2 — чуть открыт, и так далее. Листай колесиком мыши или стрелками по бокам.'},
  {page:'mouth', target:'#global-tools', title:'🛠 Инструменты', text:'Кисть (B) — рисует. Ластик (X) — стирает (делает прозрачным). Возврат (R) — возвращает как было. Ctrl+Z — отменить. Пробел — скрыть шапку. Alt — скрыть базу.'},
  {page:'mouth', target:'#preview-panel', title:'👁 Превью', text:'Справа ты видишь, как голова выглядит в 3D. Если говоришь в микрофон — она будет открывать рот в реальном времени.'},
  {page:'eyeselect', title:'👀 Область глаз', text:'По умолчанию выделено всё лицо. Если ты хочешь, чтобы при моргании двигались ТОЛЬКО глаза, сотри красную заливку с остальных частей лица (щёк, рта).'},
  {page:'blink', target:'#carouselViewportB', title:'😴 Моргание', text:'Тут ты рисуешь, как закрываются глаза. Этап 1 — глаза открыты (база). Этап 2 — полузакрыты. Этап 3 — полностью закрыты.'},
  {page:'rage', target:'#carouselViewportR', title:'😡 Ярость (Rage)', text:'Этот режим включается, когда ты жмешь клавишу в игре (например, J). Нарисуй тут злые глаза или красную ауру.'},
  {page:'test', target:'.test-canvas-wrap', title:'🎮 Тест', text:'Проверь, как всё работает. Говори в микрофон и зажми клавишу ярости.'},
  {page:'test', target:'.settings-panel', title:'🎚 Настройки', text:'Настрой чувствительность микрофона, силу тряски при ярости и частоту моргания.'},
  {page:'download', target:'#btnExport', title:'💾 Сохранение', text:'Нажми «Сохранить» и выбери папку, где лежит программа HeadVoice. После этого в самой программе нажми «Обновить», и твой скин появится!'}
];

let tourSteps = [];
let tourIdx = 0;
let tourRaf = null;

function isPageAvailable(page){
  if(page === 'mouth') return state.mouthStages.length > 0;
  if(page === 'blink') return state.blinkStages.length > 0;
  if(page === 'rage') return !!state.rageStage;
  if(page === 'test') return state.mouthStages.length > 0;
  if(page === 'download') return state.mouthStages.length > 0;
  if(page === 'eyeselect') return state.hasBlinking;
  return true;
}

function openTour(){
  if(state.page === 'upload'){
    tourSteps = TOUR_UPLOAD.map(s => ({...s, page:'upload'}));
    tourIdx = 0;
  } else {
    tourSteps = TOUR_PROJECT.filter(s => isPageAvailable(s.page));
    if(!tourSteps.length) return;
    tourIdx = tourSteps.findIndex(s => s.page === state.page);
    if(tourIdx < 0) tourIdx = 0;
  }
  document.getElementById('tourWrap').classList.remove('hidden');
  showTourStep();
}
function closeTour(){ document.getElementById('tourWrap').classList.add('hidden'); }
function tourNext(){ if(tourIdx < tourSteps.length-1){ tourIdx++; showTourStep(); } else closeTour(); }
function tourPrev(){ if(tourIdx > 0){ tourIdx--; showTourStep(); } }

function showTourStep(){
  const s = tourSteps[tourIdx];
  if(s.page && s.page !== state.page && isPageAvailable(s.page)){
    showPage(s.page);
  }
  document.getElementById('tourTitle').textContent = s.title;
  document.getElementById('tourText').textContent = s.text;
  document.getElementById('tourStep').textContent = `Шаг ${tourIdx+1} / ${tourSteps.length}`;
  document.getElementById('tourPrev').disabled = tourIdx === 0;
  document.getElementById('tourNext').textContent = tourIdx === tourSteps.length-1 ? 'Готово' : 'Далее →';

  const dots = document.getElementById('tourDots');
  dots.innerHTML = '';
  tourSteps.forEach((_, i) => {
    const d = document.createElement('button');
    d.className = 'dot' + (i === tourIdx ? ' active' : (i < tourIdx ? ' past' : ''));
    d.addEventListener('click', () => { tourIdx = i; showTourStep(); });
    dots.appendChild(d);
  });

  setTimeout(() => {
    const el = document.querySelector(s.target);
    if(el) el.scrollIntoView({behavior:'smooth', block:'center'});
    setTimeout(() => positionHighlight(), 200);
  }, 60);
}

function positionHighlight(){
  const s = tourSteps[tourIdx];
  const hl = document.getElementById('tourHl');
  const el = s ? document.querySelector(s.target) : null;
  if(!el){ hl.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  if(r.width < 2 || r.height < 2){ hl.style.display = 'none'; return; }
  hl.style.display = 'block';
  hl.style.left = (r.left - 6) + 'px';
  hl.style.top = (r.top - 6) + 'px';
  hl.style.width = (r.width + 12) + 'px';
  hl.style.height = (r.height + 12) + 'px';
}

window.addEventListener('scroll', () => {
  if(document.getElementById('tourWrap').classList.contains('hidden')) return;
  if(tourRaf) return;
  tourRaf = requestAnimationFrame(() => { tourRaf = null; positionHighlight(); });
}, {passive: true});
window.addEventListener('resize', () => {
  if(document.getElementById('tourWrap').classList.contains('hidden')) return;
  positionHighlight();
});

document.getElementById('btnHelp').addEventListener('click', openTour);
document.getElementById('tourPrev').addEventListener('click', tourPrev);
document.getElementById('tourNext').addEventListener('click', tourNext);
document.getElementById('tourClose').addEventListener('click', closeTour);

/* ============ Инициализация ============ */

document.getElementById('logo').addEventListener('click', () => location.reload());

drawWheel();
updateColorUI();
updateUndoButtons();

if(!sessionStorage.getItem('hv_tour_seen')){
  sessionStorage.setItem('hv_tour_seen', '1');
  setTimeout(() => { if(state.page === 'upload') openTour(); }, 500);
}
'use strict';

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

function renderFlatFace(imgData, stage, tabName = 'mouth'){
    const size = MAX_RES;
    const d = imgData.data;
    for(let p=0;p<size*size;p++){ const o = p*4; d[o]=d[o+1]=d[o+2]=d[o+3]=0; }
    if(!stage) return;

    if (tabName === 'rage') {
        // Для Rage рисуем только переднюю часть
        if(state.showBase) blitLayer(d, size, stage.base);
        if(state.showHat)  blitLayer(d, size, stage.hat);
        return;
    }

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

// ZIP (crc32 и buildZip)
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
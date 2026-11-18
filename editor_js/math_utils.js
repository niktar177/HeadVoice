'use strict';

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
    if(!isFinite(h)) h = 0;
    if(!isFinite(s)) s = 0;
    if(!isFinite(v)) v = 0;
    h = ((h % 1) + 1) % 1;
    s = Math.max(0, Math.min(1, s));
    v = Math.max(0, Math.min(1, v));
    const i = Math.floor(h*6), f = h*6-i;
    const p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
    let r, g, b;
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

// RGB 0..255 → HSV {h:0..1, s:0..1, v:0..1}
// Используется в color_picker.js и canvas_editor.js (pickColor) — единая точка правды.
function rgbToHsv(r, g, b){
    r = Math.max(0, Math.min(255, r)) / 255;
    g = Math.max(0, Math.min(255, g)) / 255;
    b = Math.max(0, Math.min(255, b)) / 255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const d = max - min;
    let h = 0;
    if(d !== 0){
        if(max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if(max === g) h = ((b - r) / d + 2) / 6;
        else               h = ((r - g) / d + 4) / 6;
    }
    return {h, s: max === 0 ? 0 : d / max, v: max};
}

function getViewRadius(rot){
    // Фиксированный радиус, чтобы модель не меняла размер при вращении
    return CUBE_HAT * Math.SQRT2 * 1.25;
}

// Вписывание прямоугольника srcW×srcH в dstW×dstH с сохранением пропорций (letterbox).
// scale — множитель внутри dst: 1.0 = максимально вписать, 0.5 = вдвое меньше, 2.0 = вдвое больше.
// Возвращает {x, y, w, h} — координаты отрисовки в системе dst.
// Используется для PNG-модели: скин-майнкрафт сюда НЕ идёт (там 8×8 грани апскейлятся жёстко).
function fitRect(srcW, srcH, dstW, dstH, scale){
    if(!(srcW > 0) || !(srcH > 0)){
        return {x: 0, y: 0, w: dstW, h: dstH};
    }
    const s = Math.min(dstW / srcW, dstH / srcH) * (scale == null ? 1 : scale);
    const w = Math.max(1, Math.round(srcW * s));
    const h = Math.max(1, Math.round(srcH * s));
    return {
        x: Math.round((dstW - w) / 2),
        y: Math.round((dstH - h) / 2),
        w, h
    };
}
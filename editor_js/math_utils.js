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

function getViewRadius(rot){
    // Фиксированный радиус, чтобы модель не меняла размер при вращении
    return CUBE_HAT * Math.SQRT2 * 1.25;
}
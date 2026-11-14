'use strict';

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
    const hex = '#' + rgb.map(x => x.toString(16).padStart(2,'0')).join('').toUpperCase();

    document.getElementById('curColor').style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    document.getElementById('hexInput').value = hex;
    document.getElementById('bigHex').value = hex;
    document.getElementById('valSlider').value = Math.round(v * 100);
    document.getElementById('rgbR').value = rgb[0];
    document.getElementById('rgbG').value = rgb[1];
    document.getElementById('rgbB').value = rgb[2];

    const rad = 160/2 - 6;
    const mx = 80 + Math.cos(h*Math.PI*2) * s * rad;
    const my = 80 + Math.sin(h*Math.PI*2) * s * rad;
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

    const syncRGB = () => {
        const r = parseInt(document.getElementById('rgbR').value, 10)/255;
        const g = parseInt(document.getElementById('rgbG').value, 10)/255;
        const b = parseInt(document.getElementById('rgbB').value, 10)/255;

        const max = Math.max(r,g,b), min = Math.min(r,g,b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        state.hsv = {h, s: max === 0 ? 0 : d/max, v: max};
        updateColorUI();
    };

    ['rgbR', 'rgbG', 'rgbB'].forEach(id => {
        document.getElementById(id).addEventListener('input', syncRGB);
    });

    const hexToHsv = (hexStr) => {
        let hex = hexStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
        if (hex.length === 6) {
            const r = parseInt(hex.substr(0,2), 16)/255;
            const g = parseInt(hex.substr(2,2), 16)/255;
            const b = parseInt(hex.substr(4,2), 16)/255;
            const max = Math.max(r,g,b), min = Math.min(r,g,b);
            const d = max - min;
            let h = 0;
            if (d !== 0) {
                if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
                else if (max === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6;
            }
            state.hsv = {h, s: max === 0 ? 0 : d/max, v: max};
            updateColorUI();
        }
    };

    document.getElementById('hexInput').addEventListener('change', e => hexToHsv(e.target.value));
    document.getElementById('bigHex').addEventListener('change', e => hexToHsv(e.target.value));

    // Переключатель режима
    document.getElementById('btnPaletteMode').addEventListener('click', (e) => {
        const rgbBox = document.getElementById('paletteRGB');
        const hexBox = document.getElementById('paletteHexMode');
        if (rgbBox.style.display === 'none') {
            rgbBox.style.display = 'block';
            hexBox.style.display = 'none';
            e.target.textContent = 'RGB';
        } else {
            rgbBox.style.display = 'none';
            hexBox.style.display = 'block';
            e.target.textContent = 'HEX';
        }
    });
})();

drawWheel();
updateColorUI();
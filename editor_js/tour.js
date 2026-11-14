'use strict';

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
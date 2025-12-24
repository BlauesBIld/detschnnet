const deck = document.getElementById("deck");
const background = document.getElementById("background");
const slides = Array.from(document.querySelectorAll(".slide"));

// Config knobs
const scrollDurationMs = 1400;     // slower/faster slide transition
const inputCooldownMs = 950;       // prevents rapid multi-slide jumps
const wheelThreshold = 12;         // ignore tiny wheel movements

// Each slide defines its gradient as two colors (start, end)
const gradients = [
    ["#ffe2ec", "#fff7d6"],
    ["#d6f7ff", "#e9ddff"],
    ["#e6ffdf", "#fff0d9"],
    ["#f2e6ff", "#ffe9f3"],
    ["#fff0d9", "#d6f7ff"]
];

// ---------- helpers ----------
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function clampIndex(i) {
    return Math.max(0, Math.min(slides.length - 1, i));
}

function hexToRgb(hex) {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const n = parseInt(full, 16);
    return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255};
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function mixColor(c1, c2, t) {
    const a = hexToRgb(c1);
    const b = hexToRgb(c2);
    const r = Math.round(lerp(a.r, b.r, t));
    const g = Math.round(lerp(a.g, b.g, t));
    const bb = Math.round(lerp(a.b, b.b, t));
    return `rgb(${r} ${g} ${bb})`;
}

function setGradient(colorA, colorB) {
    background.style.background = `linear-gradient(135deg, ${colorA}, ${colorB})`;
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------- appear animation (only first time a slide becomes centered) ----------
const openedSlides = new Set();

const appearObserver = new IntersectionObserver(
    (entries) => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;

            const slide = e.target;

            if (openedSlides.has(slide)) continue;
            openedSlides.add(slide);

            slide.classList.add("is-visible");
            appearObserver.unobserve(slide);
        }
    },
    {threshold: 0.62}
);

slides.forEach(s => appearObserver.observe(s));

// ---------- smooth gradient update based on current scrollTop ----------
let rafPending = false;

function updateBackgroundFromScroll() {
    rafPending = false;

    const y = deck.scrollTop;
    const h = window.innerHeight;

    const raw = y / h;
    const i = Math.floor(raw);
    const t = clamp01(raw - i);

    const i0 = clampIndex(i);
    const i1 = clampIndex(i + 1);

    const [a0, b0] = gradients[i0];
    const [a1, b1] = gradients[i1];

    const colorA = mixColor(a0, a1, t);
    const colorB = mixColor(b0, b1, t);

    setGradient(colorA, colorB);
}

function requestBgUpdate() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(updateBackgroundFromScroll);
}

deck.addEventListener("scroll", requestBgUpdate, {passive: true});
window.addEventListener("resize", requestBgUpdate);

// ---------- one-slide-at-a-time navigation ----------
let activeIndex = 0;
let isAnimating = false;
let inputLocked = false;

function scrollToIndex(index) {
    activeIndex = clampIndex(index);

    const startTop = deck.scrollTop;
    const targetTop = slides[activeIndex].offsetTop;
    const delta = targetTop - startTop;

    if (Math.abs(delta) < 2) return;

    isAnimating = true;

    const start = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - start) / scrollDurationMs);
        const eased = easeInOutCubic(t);

        deck.scrollTop = startTop + delta * eased;
        updateBackgroundFromScroll();

        if (t < 1) requestAnimationFrame(frame);
        else isAnimating = false;
    }

    requestAnimationFrame(frame);
}

function currentIndexFromScroll() {
    const y = deck.scrollTop + window.innerHeight * 0.35;

    let best = 0;
    let bestDist = Infinity;

    for (let i = 0; i < slides.length; i++) {
        const d = Math.abs(slides[i].offsetTop - y);
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }

    return best;
}

function goNext() {
    const cur = currentIndexFromScroll();
    scrollToIndex(cur + 1);
}

function goPrev() {
    const cur = currentIndexFromScroll();
    scrollToIndex(cur - 1);
}

function lockInput() {
    inputLocked = true;
    setTimeout(() => {
        inputLocked = false;
    }, inputCooldownMs);
}

// Wheel -> one slide
deck.addEventListener("wheel", (e) => {
    if (isAnimating || inputLocked) return;
    if (Math.abs(e.deltaY) < wheelThreshold) return;

    e.preventDefault();

    if (e.deltaY > 0) goNext();
    else goPrev();

    lockInput();
}, {passive: false});

// Touch swipe -> one slide
let touchStartY = 0;
let touchStartX = 0;

deck.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
}, {passive: true});

deck.addEventListener("touchend", (e) => {
    if (isAnimating || inputLocked) return;

    const t = e.changedTouches[0];
    const dy = touchStartY - t.clientY;
    const dx = touchStartX - t.clientX;

    if (Math.abs(dy) < 55) return;
    if (Math.abs(dx) > Math.abs(dy) * 0.8) return;

    if (dy > 0) goNext();
    else goPrev();

    lockInput();
}, {passive: true});

// Optional: keyboard navigation
window.addEventListener("keydown", (e) => {
    if (isAnimating || inputLocked) return;

    if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        goNext();
        lockInput();
    } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        goPrev();
        lockInput();
    }
});

// Init
scrollToIndex(0);
requestBgUpdate();

// ---------- relationship timer ----------
const startDate = new Date("2025-05-14T02:37:00");

const els = {
    years: document.getElementById("tYears"),
    months: document.getElementById("tMonths"),
    days: document.getElementById("tDays"),
    hours: document.getElementById("tHours"),
    minutes: document.getElementById("tMinutes")
};

function addMonths(date, months) {
    const d = new Date(date);
    const targetMonth = d.getMonth() + months;

    d.setMonth(targetMonth);

    // If we rolled over (e.g. Jan 31 -> Mar 3), clamp to last day of previous month
    if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
        d.setDate(0);
    }

    return d;
}

function addYears(date, years) {
    const d = new Date(date);
    const m = d.getMonth();
    d.setFullYear(d.getFullYear() + years);

    // Feb 29 handling
    if (d.getMonth() !== m) d.setDate(0);
    return d;
}

function computeCalendarDiff(from, to) {
    if (to < from) return {years: 0, months: 0, days: 0, hours: 0, minutes: 0};

    let cursor = new Date(from);

    let years = 0;
    while (addYears(cursor, 1) <= to) {
        cursor = addYears(cursor, 1);
        years++;
    }

    let months = 0;
    while (addMonths(cursor, 1) <= to) {
        cursor = addMonths(cursor, 1);
        months++;
    }

    const ms = to - cursor;

    const totalMinutes = Math.floor(ms / 60000);
    const minutes = totalMinutes % 60;

    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;

    const totalDays = Math.floor(totalHours / 24);
    const days = totalDays;

    return {years, months, days, hours, minutes};
}

function plural(value, singular, pluralForm) {
    return value === 1 ? singular : pluralForm;
}

function setTimerLine(numId, labelId, value, singular, pluralForm) {
    const numEl = document.getElementById(numId);
    const labelEl = document.getElementById(labelId);
    if (!numEl || !labelEl) return;

    numEl.textContent = String(value);
    labelEl.textContent = plural(value, singular, pluralForm);
}

function updateTimer() {
    const now = new Date();
    let totalSeconds = Math.max(0, Math.floor((now - startDate) / 1000));

    const seconds = totalSeconds % 60;
    totalSeconds = Math.floor(totalSeconds / 60);

    const minutes = totalSeconds % 60;
    totalSeconds = Math.floor(totalSeconds / 60);

    const hours = totalSeconds % 24;
    totalSeconds = Math.floor(totalSeconds / 24);

    const days = totalSeconds % 30;
    totalSeconds = Math.floor(totalSeconds / 30);

    const months = totalSeconds % 12;
    const years = Math.floor(totalSeconds / 12);

    setTimerLine("tYears", "lYears", years, "year", "years");
    setTimerLine("tMonths", "lMonths", months, "month", "months");
    setTimerLine("tDays", "lDays", days, "day", "days");
    setTimerLine("tHours", "lHours", hours, "hour", "hours");
    setTimerLine("tMinutes", "lMinutes", minutes, "minute", "minutes");
    setTimerLine("tSeconds", "lSeconds", seconds, "second", "seconds");
}

updateTimer();
setInterval(updateTimer, 1000);


const galleryTrack = document.getElementById("galleryTrack");
const imageCount = 20;
const extension = "jpg"; // change if needed

if (galleryTrack) {
    for (let i = 1; i <= imageCount; i++) {
        const img = document.createElement("img");
        img.src = `/img/gallery/img${i}.${extension}`;
        img.loading = "lazy";
        img.alt = "Us";
        galleryTrack.appendChild(img);
    }

    // duplicate for seamless scroll
    for (let i = 1; i <= imageCount; i++) {
        const img = document.createElement("img");
        img.src = `/img/gallery/img${i}.${extension}`;
        img.loading = "lazy";
        img.alt = "Us";
        galleryTrack.appendChild(img);
    }
}

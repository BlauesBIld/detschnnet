const deck = document.getElementById("deck");
const background = document.getElementById("background");
const slides = Array.from(document.querySelectorAll(".slide"));

// Config knobs
const scrollDurationMs = 900;
const inputCooldownMs = 950;
const wheelThreshold = 36;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    const h = deck.clientHeight || window.innerHeight;

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

// ---------- one-slide-at-a-time navigation ----------
let activeIndex = 0;
let isAnimating = false;
let inputLocked = false;
let animationFrame = 0;

function scrollToIndex(index) {
    activeIndex = clampIndex(index);

    const startTop = deck.scrollTop;
    const targetTop = slides[activeIndex].offsetTop;
    const delta = targetTop - startTop;

    if (Math.abs(delta) < 2) {
        deck.scrollTop = targetTop;
        return;
    }

    cancelAnimationFrame(animationFrame);

    if (prefersReducedMotion) {
        deck.scrollTop = targetTop;
        updateBackgroundFromScroll();
        return;
    }

    isAnimating = true;

    const start = performance.now();

    function frame(now) {
        const t = Math.min(1, (now - start) / scrollDurationMs);
        const eased = easeInOutCubic(t);

        deck.scrollTop = startTop + delta * eased;
        updateBackgroundFromScroll();

        if (t < 1) animationFrame = requestAnimationFrame(frame);
        else {
            deck.scrollTop = targetTop;
            isAnimating = false;
        }
    }

    animationFrame = requestAnimationFrame(frame);
}

function currentIndexFromScroll() {
    const y = deck.scrollTop;

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
let wheelDelta = 0;
let wheelResetTimer = 0;

deck.addEventListener("wheel", (e) => {
    e.preventDefault();

    if (isAnimating || inputLocked) return;

    const multiplier = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? deck.clientHeight : 1;
    const delta = e.deltaY * multiplier;

    if (wheelDelta && Math.sign(wheelDelta) !== Math.sign(delta)) wheelDelta = 0;
    wheelDelta += delta;

    clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(() => {
        wheelDelta = 0;
    }, 180);

    if (Math.abs(wheelDelta) < wheelThreshold) return;

    if (wheelDelta > 0) goNext();
    else goPrev();

    wheelDelta = 0;
    lockInput();
}, {passive: false});

// Touch swipe -> one slide
let touchStartY = 0;
let touchStartX = 0;
let slideTouchActive = false;

deck.addEventListener("touchstart", (e) => {
    slideTouchActive = false;
    if (e.target.closest('[data-slide-gesture="ignore"]')) return;
    if (e.touches.length !== 1) return;
    slideTouchActive = true;
    touchStartY = e.touches[0].clientY;
    touchStartX = e.touches[0].clientX;
}, {passive: true});

deck.addEventListener("touchmove", (e) => {
    if (!slideTouchActive) return;
    if (e.touches.length === 1 && e.cancelable) e.preventDefault();
}, {passive: false});

deck.addEventListener("touchend", (e) => {
    if (!slideTouchActive || e.touches.length !== 0) return;
    slideTouchActive = false;
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

deck.addEventListener("touchcancel", () => {
    slideTouchActive = false;
    touchStartY = 0;
    touchStartX = 0;
}, {passive: true});

// Optional: keyboard navigation
window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || document.getElementById("photoViewer")?.open) return;
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

// Match the actual visible viewport, including mobile browser bars and
// orientation changes, then keep the current slide precisely aligned.
let viewportResizeFrame = 0;

function syncViewportHeight() {
    // A rotation or browser-bar resize invalidates an in-flight scroll target.
    cancelAnimationFrame(animationFrame);
    isAnimating = false;
    const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight);
    document.documentElement.style.setProperty("--viewport-height", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--viewport-unit", `${viewportHeight / 100}px`);

    cancelAnimationFrame(viewportResizeFrame);
    viewportResizeFrame = requestAnimationFrame(() => {
        deck.scrollTop = slides[activeIndex].offsetTop;
        requestBgUpdate();
    });
}

window.addEventListener("resize", syncViewportHeight, {passive: true});
window.visualViewport?.addEventListener("resize", syncViewportHeight, {passive: true});

// Init
syncViewportHeight();
scrollToIndex(0);
requestBgUpdate();

// ---------- relationship timers ----------
// Give every timer a different random starting second so their second counters
// do not move in lockstep. The values remain stable until the page is reloaded.
const randomSeconds = [];
while (randomSeconds.length < 3) {
    const second = Math.floor(Math.random() * 59) + 1;
    if (!randomSeconds.includes(second)) randomSeconds.push(second);
}

const friendshipDate = new Date(2024, 2, 27, 20, 23, randomSeconds[0]);
const startDate = new Date(2025, 4, 14, 2, 37, randomSeconds[1]);
const engagementDate = new Date(2026, 6, 30, 20, 40, randomSeconds[2]);

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

function updateTimer(start, numberPrefix, labelPrefix) {
    const now = new Date();
    let totalSeconds = Math.max(0, Math.floor((now - start) / 1000));

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

    setTimerLine(`${numberPrefix}Years`, `${labelPrefix}Years`, years, "year", "years");
    setTimerLine(`${numberPrefix}Months`, `${labelPrefix}Months`, months, "month", "months");
    setTimerLine(`${numberPrefix}Days`, `${labelPrefix}Days`, days, "day", "days");
    setTimerLine(`${numberPrefix}Hours`, `${labelPrefix}Hours`, hours, "hour", "hours");
    setTimerLine(`${numberPrefix}Minutes`, `${labelPrefix}Minutes`, minutes, "minute", "minutes");
    setTimerLine(`${numberPrefix}Seconds`, `${labelPrefix}Seconds`, seconds, "second", "seconds");
}

function updateTimers() {
    updateTimer(friendshipDate, "f", "fl");
    updateTimer(startDate, "t", "l");
    updateTimer(engagementDate, "e", "el");
}

updateTimers();
setInterval(updateTimers, 1000);


// ---------- Endless diagonal photo map ----------
const photoMap = document.getElementById("photoMap");
const mapPlane = document.getElementById("photoMapPlane");
const photoViewer = document.getElementById("photoViewer");
const viewerImage = document.getElementById("viewerImage");
const viewerCaption = document.getElementById("viewerCaption");
const motionButton = document.getElementById("mapMotion");

if (photoMap && mapPlane && photoViewer) {
    const imageCount = 20;
    const angle = -16 * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const wrap = (value, size) => ((value % size) + size) % size;
    const historyKey = "lovePhoto";
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let tiles = [];
    let columns = 0;
    let rows = 0;
    let stepX = 0;
    let stepY = 0;
    let panX = 0;
    let panY = 0;
    let pointer = null;
    let suppressPointerClick = false;
    let pendingTapTile = null;
    let mapVisible = false;
    let paused = motionPreference.matches;
    let resumeAt = 0;
    let mapFrame = 0;
    let lastFrameTime = 0;
    let returnFocus = photoMap;
    let closingViewer = false;
    let gridX = NaN;
    let gridY = NaN;
    let keyboardFocus = false;
    let viewerGeneration = 0;
    let viewerAnimations = [];
    let transitionTile = null;
    let activePhoto = 0;
    let viewerRect = null;
    const viewerClose = document.getElementById("viewerClose");
    const driftSpeed = 11.9025;
    const openDuration = 480;
    const closeDuration = 380;
    const fullImageFrame = {
        transform: "translate3d(0px, 0px, 0) rotate(0deg) scale(1)",
        clipPath: "inset(0px 0px round 26px)", opacity: 1
    };

    function mapIsMoving(now = performance.now()) {
        return !paused && !motionPreference.matches && !pointer && now >= resumeAt &&
            (!keyboardFocus || photoViewer.open);
    }

    function moveMap(screenX, screenY) {
        // Convert screen movement into the rotated grid's coordinates.
        panX += screenX * cos + screenY * sin;
        panY += -screenX * sin + screenY * cos;
    }

    function tilePosition(tile, secondsAhead = 0) {
        const width = columns * stepX;
        const height = rows * stepY;
        const advance = mapIsMoving() ? driftSpeed * secondsAhead : 0;
        return {
            x: wrap(tile.column * stepX + panX + advance * (cos + sin), width) - width / 2,
            y: wrap(tile.row * stepY - (tile.column % 5) * stepY / 5 + panY +
                advance * (cos - sin), height) - height / 2
        };
    }

    function drawMap(force = false) {
        const width = columns * stepX;
        const height = rows * stepY;
        panX = wrap(panX, width);
        panY = wrap(panY, height);
        const nextX = Math.floor(panX / stepX) * stepX;
        const nextY = Math.floor(panY / stepY) * stepY;
        // Most frames change just one composited layer. Reposition the tiles
        // only when crossing a cell boundary, with wrapping outside the view.
        if (force || nextX !== gridX || nextY !== gridY) {
            gridX = nextX;
            gridY = nextY;
            for (const tile of tiles) {
                const x = wrap(tile.column * stepX + gridX, width) - width / 2;
                const y = wrap(tile.row * stepY - (tile.column % 5) * stepY / 5 + gridY, height) - height / 2;
                tile.button.style.transform = `translate3d(${x}px, ${y}px, 0)`;
            }
        }
        mapPlane.style.transform = `rotate(-16deg) translate3d(${panX - gridX}px, ${panY - gridY}px, 0)`;
    }

    function layoutMap() {
        const tileWidth = Math.max(130, Math.min(220, photoMap.clientWidth * 0.34));
        const tileHeight = tileWidth * 1.3;
        stepX = tileWidth + 22;
        stepY = tileHeight + 22;
        // Extra cells stay outside the viewport, where they wrap invisibly.
        // Multiples of 5 × 4 keep all 20 photos in a repeating, stable pattern.
        const width = photoMap.clientWidth * cos + photoMap.clientHeight * Math.abs(sin);
        const height = photoMap.clientWidth * Math.abs(sin) + photoMap.clientHeight * cos;
        const nextColumns = Math.ceil((Math.ceil(width / stepX) + 3) / 5) * 5;
        const nextRows = Math.ceil((Math.ceil(height / stepY) + 3) / 4) * 4;
        photoMap.style.setProperty("--tile-width", `${tileWidth}px`);
        photoMap.style.setProperty("--tile-height", `${tileHeight}px`);
        if (nextColumns !== columns || nextRows !== rows) {
            columns = nextColumns;
            rows = nextRows;
            tiles = [];
            const fragment = document.createDocumentFragment();
            for (let row = 0; row < rows; row++) {
                for (let column = 0; column < columns; column++) {
                    const photo = (row % 4) * 5 + column % 5 + 1;
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "photo-map-tile";
                    button.dataset.photo = photo;
                    button.tabIndex = -1;
                    button.setAttribute("aria-label", `Open photo ${photo} of ${imageCount} of Dariela and Dejan`);
                    const img = document.createElement("img");
                    img.src = `/img/gallery/thumbs/img${photo}.webp`;
                    img.alt = "Dariela and Dejan together";
                    img.loading = "lazy";
                    img.decoding = "async";
                    img.draggable = false;
                    button.appendChild(img);
                    fragment.appendChild(button);
                    tiles.push({button, img, column, row, photo});
                }
            }
            mapPlane.replaceChildren(fragment);
        }
        drawMap(true);
        if (photoViewer.open && !closingViewer && !viewerAnimations.length) fitViewerImage();
    }

    function animateMap(now) {
        mapFrame = 0;
        if (!mapVisible || document.hidden) return;
        const elapsed = Math.min((now - lastFrameTime) / 1000, 0.05);
        lastFrameTime = now;
        if (mapIsMoving(now)) {
            moveMap(elapsed * driftSpeed, elapsed * driftSpeed);
            drawMap();
        }
        mapFrame = requestAnimationFrame(animateMap);
    }

    function startMapAnimation() {
        if (mapFrame || !mapVisible || document.hidden) return;
        lastFrameTime = performance.now();
        mapFrame = requestAnimationFrame(animateMap);
    }

    function findPhotoTile(photo, preferred = returnFocus) {
        const mapRect = photoMap.getBoundingClientRect();
        const distance = (tile) => {
            const {x, y} = tilePosition(tile);
            const dx = (x + (stepX - 22) / 2) * cos - (y + (stepY - 22) / 2) * sin;
            const dy = (x + (stepX - 22) / 2) * sin + (y + (stepY - 22) / 2) * cos;
            return {visible: Math.abs(dx) < mapRect.width / 2 && Math.abs(dy) < mapRect.height / 2,
                value: Math.hypot(dx, dy)};
        };
        const matches = tiles.filter(tile => tile.photo === photo);
        const original = matches.find(tile => tile.button === preferred);
        if (original && distance(original).visible) return original;
        return matches.reduce((best, tile) => {
            const a = distance(tile), b = best && distance(best);
            return !b || (a.visible && !b.visible) || (a.visible === b.visible && a.value < b.value) ? tile : best;
        }, null);
    }

    function fitViewerImage() {
        if (!viewerImage.naturalWidth || !photoViewer.open) return;
        const style = getComputedStyle(photoViewer);
        const availableWidth = photoViewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const availableHeight = photoViewer.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) -
            viewerCaption.offsetHeight - 14;
        const ratio = viewerImage.naturalWidth / viewerImage.naturalHeight;
        const width = Math.max(1, Math.min(availableWidth, availableHeight * ratio));
        viewerImage.style.width = `${width}px`;
        viewerImage.style.height = `${width / ratio}px`;
        viewerRect = viewerImage.getBoundingClientRect();
    }

    function tileFrame(tile, secondsAhead = 0) {
        if (!tile || !viewerRect) return {...fullImageFrame, opacity: 0};
        const mapRect = photoMap.getBoundingClientRect();
        const {x, y} = tilePosition(tile, secondsAhead);
        const tileWidth = stepX - 22, tileHeight = stepY - 22;
        const centerX = mapRect.left + mapRect.width / 2 + (x + tileWidth / 2) * cos - (y + tileHeight / 2) * sin;
        const centerY = mapRect.top + mapRect.height / 2 + (x + tileWidth / 2) * sin + (y + tileHeight / 2) * cos;
        // Uniform scaling plus a changing crop preserves the photo's proportions
        // while it changes from the map's portrait crop to the full photograph.
        const scale = Math.max((tileWidth - 10) / viewerRect.width, (tileHeight - 10) / viewerRect.height);
        const insetX = Math.max(0, (viewerRect.width - (tileWidth - 10) / scale) / 2);
        const insetY = Math.max(0, (viewerRect.height - (tileHeight - 10) / scale) / 2);
        return {
            transform: `translate3d(${centerX - viewerRect.left - viewerRect.width / 2}px, ${centerY - viewerRect.top - viewerRect.height / 2}px, 0) rotate(-16deg) scale(${scale})`,
            clipPath: `inset(${insetY}px ${insetX}px round ${21 / scale}px)`, opacity: 1
        };
    }

    function stopViewerAnimations() {
        viewerAnimations.forEach(animation => animation.cancel());
        viewerAnimations = [];
        transitionTile?.button.classList.remove("is-viewer-source");
        transitionTile = null;
        photoViewer.classList.remove("is-transitioning");
    }

    function animateViewer(element, frames, duration) {
        const animation = element.animate(frames, {
            duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both"
        });
        // Cancellation (Back during opening, or Forward during closing) is normal.
        animation.finished.catch(() => {});
        viewerAnimations.push(animation);
        return animation;
    }

    async function showPhoto(photo, focusTarget = photoMap) {
        const generation = ++viewerGeneration;
        stopViewerAnimations();
        returnFocus = focusTarget;
        closingViewer = false;
        activePhoto = photo;
        viewerRect = null;
        resumeAt = 0;
        const tile = findPhotoTile(photo, focusTarget);
        // Begin with the cached preview; decode the original off-screen and swap
        // it in after the flight, without changing the image's fitted dimensions.
        viewerImage.style.visibility = "hidden";
        viewerImage.src = tile?.img.currentSrc || tile?.img.src || `/img/gallery/img${photo}.jpg`;
        viewerImage.alt = `Photo ${photo} of Dariela and Dejan together`;
        viewerCaption.textContent = `${photo} / ${imageCount} · Our little world ❤️`;
        if (!photoViewer.open) photoViewer.showModal();
        viewerClose.focus({preventScroll: true});
        const fullImage = new Image();
        fullImage.src = `/img/gallery/img${photo}.jpg`;
        const fullReady = fullImage.decode().then(() => fullImage).catch(() => null);
        const duration = motionPreference.matches ? 0 : openDuration;
        photoViewer.classList.add("is-transitioning");
        animateViewer(photoViewer, [{backgroundColor: "#17131600"}, {backgroundColor: "#171316b8"}], duration);
        animateViewer(viewerClose, [{opacity: 0}, {opacity: 1}], duration);
        animateViewer(viewerCaption, [{opacity: 0}, {opacity: 1}], duration);
        await viewerImage.decode().catch(() => {});
        if (generation !== viewerGeneration) return;
        // If a preview cannot load, the original can still open normally.
        if (!viewerImage.naturalWidth) {
            const original = await fullReady;
            if (generation !== viewerGeneration) return;
            if (original) {
                viewerImage.src = original.src;
                await viewerImage.decode().catch(() => {});
                if (generation !== viewerGeneration) return;
            }
        }
        fitViewerImage();
        const canFly = mapVisible && !isAnimating && tile && viewerRect;
        if (canFly && duration) {
            transitionTile = tile;
            tile.button.classList.add("is-viewer-source");
        }
        viewerImage.style.visibility = "";
        animateViewer(viewerImage, [canFly ? tileFrame(tile) : {...fullImageFrame, opacity: 0}, fullImageFrame], duration);
        await Promise.all(viewerAnimations.map(animation => animation.finished.catch(() => {})));
        if (generation !== viewerGeneration) return;
        stopViewerAnimations();
        fitViewerImage();
        const original = await fullReady;
        if (generation === viewerGeneration && photoViewer.open && original) viewerImage.src = original.src;
    }

    async function finishPhotoClose() {
        const imageStyle = getComputedStyle(viewerImage);
        const from = {
            transform: imageStyle.transform === "none" ? fullImageFrame.transform : imageStyle.transform,
            clipPath: imageStyle.clipPath === "none" ? fullImageFrame.clipPath : imageStyle.clipPath,
            opacity: imageStyle.opacity
        };
        const backgroundColor = getComputedStyle(photoViewer).backgroundColor;
        const closeOpacity = getComputedStyle(viewerClose).opacity;
        const captionOpacity = getComputedStyle(viewerCaption).opacity;
        const generation = ++viewerGeneration;
        closingViewer = true;
        stopViewerAnimations();
        const duration = motionPreference.matches ? 0 : closeDuration;
        const tile = findPhotoTile(activePhoto);
        if (tile && viewerRect && duration) {
            transitionTile = tile;
            tile.button.classList.add("is-viewer-source");
        }
        photoViewer.classList.add("is-transitioning");
        animateViewer(viewerImage, [from, tileFrame(tile, duration / 1000)], duration);
        animateViewer(photoViewer, [{backgroundColor}, {backgroundColor: "#17131600"}], duration);
        animateViewer(viewerClose, [{opacity: closeOpacity}, {opacity: 0}], duration);
        animateViewer(viewerCaption, [{opacity: captionOpacity}, {opacity: 0}], duration);
        await Promise.all(viewerAnimations.map(animation => animation.finished.catch(() => {})));
        if (generation !== viewerGeneration) return;
        photoViewer.close();
        stopViewerAnimations();
        closingViewer = false;
        resumeAt = 0;
        const target = (tile?.button.isConnected ? tile.button : findPhotoTile(activePhoto)?.button) ||
            (returnFocus.isConnected ? returnFocus : photoMap);
        target.focus({preventScroll: true});
    }

    function openPhoto(photo, focusTarget) {
        if (photoViewer.open) return;
        history.pushState({...history.state, [historyKey]: photo}, "");
        showPhoto(photo, focusTarget);
    }

    function closePhoto() {
        if (!photoViewer.open || closingViewer) return;
        closingViewer = true;
        history.back();
    }

    window.addEventListener("popstate", (event) => {
        const photo = event.state?.[historyKey];
        if (Number.isInteger(photo) && photo >= 1 && photo <= imageCount) {
            scrollToIndex(slides.length - 1);
            showPhoto(photo);
        } else if (photoViewer.open) {
            finishPhotoClose();
        }
    });
    viewerClose.addEventListener("click", closePhoto);
    photoViewer.addEventListener("cancel", (event) => {
        event.preventDefault();
        closePhoto();
    });
    photoViewer.addEventListener("click", (event) => {
        if (event.target === photoViewer) closePhoto();
    });

    photoMap.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0 || pointer || photoViewer.open) return;
        suppressPointerClick = false;
        pendingTapTile = null;
        pointer = {
            id: event.pointerId, x: event.clientX, y: event.clientY,
            startX: event.clientX, startY: event.clientY, moved: false,
            dragThreshold: event.pointerType === "touch" ? 14 : 8,
            tile: event.target.closest(".photo-map-tile")
        };
        // Leave taps on the native button. Capturing here retargets Android's
        // eventual click to the map instead of the photo that was touched.
    });
    photoMap.addEventListener("pointermove", (event) => {
        if (!pointer || pointer.id !== event.pointerId) return;
        if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > pointer.dragThreshold) {
            pointer.moved = true;
            photoMap.classList.add("is-dragging");
            photoMap.setPointerCapture(event.pointerId);
        }
        if (pointer.moved) {
            moveMap(event.clientX - pointer.x, event.clientY - pointer.y);
            drawMap();
        }
        pointer.x = event.clientX;
        pointer.y = event.clientY;
    });
    function endPointer(event) {
        if (!pointer || pointer.id !== event.pointerId) return;
        const ended = pointer;
        pointer = null;
        suppressPointerClick = ended.moved || event.type !== "pointerup";
        pendingTapTile = suppressPointerClick ? null : ended.tile;
        photoMap.classList.remove("is-dragging");
        resumeAt = 0;
        if (photoMap.hasPointerCapture(event.pointerId)) photoMap.releasePointerCapture(event.pointerId);
        // Opening on pointerup can change the hit target before the browser
        // dispatches click. Let that click activate the photo exactly once.
    }
    photoMap.addEventListener("pointerup", endPointer);
    photoMap.addEventListener("pointercancel", endPointer);
    // Mouse releases outside the map still need to clear the held gesture when
    // it has not moved far enough to start capturing a drag.
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    photoMap.addEventListener("lostpointercapture", (event) => {
        // Touch implicitly captures to the tile first. Its capture-loss event
        // bubbles here when capture moves to the map; that is not a cancellation.
        if (event.target === photoMap) endPointer(event);
    });
    photoMap.addEventListener("dragstart", (event) => event.preventDefault());
    photoMap.addEventListener("focusin", () => {
        keyboardFocus = photoMap.matches(":focus-visible");
    });
    photoMap.addEventListener("focusout", () => { keyboardFocus = false; });
    // Use one native activation path for touch, mouse, keyboard and assistive
    // technology. Only actual drags and cancelled gestures suppress a click.
    photoMap.addEventListener("click", (event) => {
        const tile = event.target.closest(".photo-map-tile") ||
            (event.detail !== 0 ? pendingTapTile : null);
        pendingTapTile = null;
        if (event.detail !== 0 && (suppressPointerClick || pointer?.moved)) {
            if (pointer) endPointer({pointerId: pointer.id, type: "pointercancel"});
            event.preventDefault();
            return;
        }
        if (tile) {
            // A native click can arrive even when a browser omitted pointerup.
            if (pointer) endPointer({pointerId: pointer.id, type: "pointerup"});
            pendingTapTile = null;
            openPhoto(Number(tile.dataset.photo), tile);
        }
    });
    photoMap.addEventListener("keydown", (event) => {
        const movement = {ArrowLeft: [90, 0], ArrowRight: [-90, 0], ArrowUp: [0, 90], ArrowDown: [0, -90]};
        if (movement[event.key]) {
            event.preventDefault();
            moveMap(...movement[event.key]);
            drawMap();
            resumeAt = performance.now() + 3000;
        } else if (event.key === "Enter" && event.target === photoMap) {
            event.preventDefault();
            const distance = (tile) => {
                const {x, y} = tilePosition(tile);
                return Math.hypot(x + (stepX - 22) / 2, y + (stepY - 22) / 2);
            };
            const nearest = tiles.reduce((best, tile) => distance(tile) < distance(best) ? tile : best);
            openPhoto(nearest.photo, photoMap);
        }
    });

    document.getElementById("memoriesBack").addEventListener("click", () => {
        if (isAnimating) return;
        goPrev();
        lockInput();
    });
    function updateMotionButton() {
        motionButton.setAttribute("aria-pressed", String(paused));
        motionButton.textContent = paused ? "Resume motion" : "Pause motion";
        motionButton.disabled = motionPreference.matches;
        if (motionPreference.matches) motionButton.textContent = "Motion off";
    }
    motionButton.addEventListener("click", () => {
        paused = !paused;
        updateMotionButton();
    });
    motionPreference.addEventListener("change", () => {
        paused = motionPreference.matches;
        updateMotionButton();
    });
    new ResizeObserver(layoutMap).observe(photoMap);
    new IntersectionObserver(([entry]) => {
        mapVisible = entry.isIntersecting;
        if (mapVisible) startMapAnimation();
        else {
            cancelAnimationFrame(mapFrame);
            mapFrame = 0;
        }
    }, {threshold: 0.5}).observe(photoMap);
    document.addEventListener("visibilitychange", startMapAnimation);
    layoutMap();
    updateMotionButton();
    // Restore an open photo if this history entry is reloaded.
    const restoredPhoto = history.state?.[historyKey];
    if (Number.isInteger(restoredPhoto) && restoredPhoto >= 1 && restoredPhoto <= imageCount) {
        scrollToIndex(slides.length - 1);
        showPhoto(restoredPhoto);
    }
}

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../public/my/script.js'), 'utf8')
    .split('// ---------- Endless diagonal photo map ----------')[1];
const flush = () => new Promise(resolve => setImmediate(resolve));

// A browser boundary double: exercise real event handlers and animation promises,
// including cancellation, without loading unrelated slides or network images.
function setup({width = 390, height = 844, reduced = false} = {}) {
    let now = 1000, nextFrame = 0, tileWrites = 0, focus = null;
    const frames = new Map(), animations = [], windowEvents = {}, resizes = [];
    const preference = {matches: reduced, addEventListener() {}};
    const elements = {};
    class Element {
        constructor(tag = '') {
            this.tag = tag;
            this.events = {};
            this.dataset = {};
            this.children = [];
            this.classes = new Set();
            this.classList = {
                add: name => this.classes.add(name), remove: name => this.classes.delete(name)
            };
            this.style = new Proxy({setProperty(name, value) {this[name] = value;}}, {
                set: (target, name, value) => {
                    if (this.className === 'photo-map-tile' && name === 'transform') tileWrites++;
                    target[name] = value;
                    return true;
                }
            });
            this.activeAnimations = [];
            this.isConnected = true;
            this.open = false;
            this.naturalWidth = 440;
            this.naturalHeight = 572;
            this.offsetHeight = 16;
        }
        setAttribute() {}
        addEventListener(name, handler) {this.events[name] = handler;}
        appendChild(child) {this.children.push(child);}
        replaceChildren(fragment) {
            this.children.forEach(child => {child.isConnected = false;});
            this.children = fragment.children;
        }
        matches() {return false;}
        focus() {focus = this;}
        setPointerCapture(id) {this.capture = id;}
        hasPointerCapture(id) {return this.capture === id;}
        releasePointerCapture() {this.capture = null;}
        showModal() {this.open = true;}
        close() {this.open = false;}
        decode() {return Promise.resolve();}
        getBoundingClientRect() {
            const w = parseFloat(this.style.width) || this.clientWidth;
            const h = parseFloat(this.style.height) || this.clientHeight;
            return {left: this.tag === 'viewer-image' ? (width - w) / 2 : 0,
                top: this.tag === 'viewer-image' ? (height - h) / 2 : 0, width: w, height: h};
        }
        animate(keyframes, options) {
            let resolve, reject;
            const animation = {element: this, keyframes, options, state: 'running',
                finished: new Promise((yes, no) => {resolve = yes; reject = no;}),
                finish() {if (this.state !== 'running') return; this.state = 'finished'; resolve();},
                cancel() {
                    this.element.activeAnimations = this.element.activeAnimations.filter(a => a !== this);
                    if (this.state === 'running') reject(new Error('Cancelled'));
                    this.state = 'cancelled';
                }
            };
            this.activeAnimations.push(animation);
            animations.push(animation);
            return animation;
        }
    }
    for (const id of ['photoMap', 'photoMapPlane', 'photoViewer', 'viewerImage', 'viewerCaption',
        'mapMotion', 'viewerClose', 'memoriesBack']) elements[id] = new Element();
    const map = elements.photoMap, plane = elements.photoMapPlane, viewer = elements.photoViewer;
    map.clientWidth = width; map.clientHeight = height;
    viewer.clientWidth = width; viewer.clientHeight = height;
    elements.viewerImage.tag = 'viewer-image';
    const history = {state: null,
        pushState(state) {this.state = state;},
        back() {this.state = null; windowEvents.popstate({state: null});}
    };
    const context = {
        document: {hidden: false, getElementById: id => elements[id], createElement: tag => new Element(tag),
            createDocumentFragment: () => new Element(), addEventListener() {}},
        window: {matchMedia: () => preference, addEventListener: (name, handler) => {windowEvents[name] = handler;}},
        performance: {now: () => now}, history, Image: Element,
        getComputedStyle(element) {
            const animation = element.activeAnimations.at(-1);
            return {paddingLeft: '24', paddingRight: '24', paddingTop: '80', paddingBottom: '56',
                transform: 'none', clipPath: 'none', opacity: '1', backgroundColor: '#171316b8',
                ...element.style, ...(animation ? animation.keyframes[animation.state === 'finished' ? 1 : 0] : {})};
        },
        requestAnimationFrame(handler) {frames.set(++nextFrame, handler); return nextFrame;},
        cancelAnimationFrame(id) {frames.delete(id);},
        ResizeObserver: class {constructor(handler) {resizes.push(handler);} observe() {}},
        IntersectionObserver: class {constructor(handler) {this.handler = handler;} observe() {this.handler([{isIntersecting: true}]);}},
        isAnimating: false, scrollToIndex() {}, slides: [1, 2, 3, 4, 5], goPrev() {}, lockInput() {}
    };
    vm.runInNewContext(source, context, {filename: 'public/my/script.js'});
    return {elements, map, plane, viewer, animations, history, windowEvents,
        get tileWrites() {return tileWrites;}, get focus() {return focus;},
        tick(ms = 16) {now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(handler => handler(now));},
        finishAnimations() {animations.forEach(animation => animation.finish());},
        resize(w, h) {map.clientWidth = viewer.clientWidth = width = w; map.clientHeight = viewer.clientHeight = height = h; resizes.forEach(handler => handler());},
        pointer(type, tile, x = 30, y = 30) {
            map.events[type]({type, isPrimary: true, button: 0, pointerId: 1,
                clientX: x, clientY: y, target: {closest: () => tile}});
        }
    };
}

test('drift updates one layer, holds during touch, and resumes on the first frame', () => {
    const s = setup();
    const writes = s.tileWrites;
    const first = s.plane.style.transform;
    for (let i = 0; i < 120; i++) s.tick();
    assert.notEqual(s.plane.style.transform, first);
    assert.equal(s.tileWrites, writes, 'individual tiles should not be rewritten every frame');
    s.pointer('pointerdown', null);
    const held = s.plane.style.transform;
    s.tick(); assert.equal(s.plane.style.transform, held);
    s.pointer('pointermove', null, 80, 80);
    s.pointer('pointerup', null, 80, 80);
    const released = s.plane.style.transform;
    s.tick(); assert.notEqual(s.plane.style.transform, released);
});

test('visible photos move continuously across cell rebases and torus wrapping', () => {
    for (const width of [390, 1600]) {
        const s = setup({width});
        const positions = () => {
            const translation = value => value.match(/translate3d\(([^,]+),\s*([^,]+),/).slice(1).map(parseFloat);
            const [px, py] = translation(s.plane.style.transform);
            const angle = -16 * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
            const tw = parseFloat(s.map.style['--tile-width']), th = parseFloat(s.map.style['--tile-height']);
            return s.plane.children.map(tile => {
                const [x, y] = translation(tile.style.transform);
                return {x: (x + px + tw / 2) * cos - (y + py + th / 2) * sin,
                    y: (x + px + tw / 2) * sin + (y + py + th / 2) * cos};
            });
        };
        let previous = positions();
        for (let i = 0; i < 3000; i++) {
            s.tick();
            const current = positions();
            previous.forEach((before, index) => {
                if (Math.abs(before.x) < width / 2 && Math.abs(before.y) < 844 / 2) {
                    assert.ok(Math.abs(current[index].x - before.x - 9 * .016) < 1e-7,
                        JSON.stringify({width, i, index, before, after: current[index], plane: s.plane.style.transform}));
                    assert.ok(Math.abs(current[index].y - before.y - 9 * .016) < 1e-7);
                }
            });
            previous = current;
        }
        assert.ok(s.tileWrites < 3000, 'rebases should be occasional, not per frame');
    }
});

test('open and close animate rotation, scale and crop while the map keeps drifting', async () => {
    const s = setup(), tile = s.plane.children.find(button => button.dataset.photo === 13);
    s.pointer('pointerdown', tile); s.pointer('pointerup', tile);
    await flush();
    assert.equal(s.viewer.open, true);
    assert.match(s.elements.viewerImage.src, /thumbs\/img13.webp$/);
    const flight = s.animations.find(animation => animation.element === s.elements.viewerImage);
    assert.match(flight.keyframes[0].transform, /rotate\(-16deg\) scale\(/);
    assert.match(flight.keyframes[1].transform, /rotate\(0deg\) scale\(1\)/);
    assert.match(flight.keyframes[0].clipPath, /inset\(/);
    const before = s.plane.style.transform;
    s.tick(); assert.notEqual(s.plane.style.transform, before);
    s.finishAnimations(); await flush();
    assert.match(s.elements.viewerImage.src, /img13.jpg$/);
    assert.equal(s.plane.children.some(button => button.classes.has('is-viewer-source')), false);
    s.elements.viewerClose.events.click(); await flush();
    assert.equal(s.viewer.open, true, 'keep the modal until its return flight finishes');
    const returning = s.animations.filter(animation => animation.element === s.elements.viewerImage).at(-1);
    assert.match(returning.keyframes[1].transform, /rotate\(-16deg\) scale\(/);
    const closing = s.plane.style.transform;
    s.tick(); assert.notEqual(s.plane.style.transform, closing);
    s.finishAnimations(); await flush();
    assert.equal(s.viewer.open, false);
    assert.equal(s.focus.dataset.photo, 13);
    assert.equal(s.plane.children.some(button => button.classes.has('is-viewer-source')), false);
});

test('browser Back during opening and Forward during closing cancel stale completion', async () => {
    const s = setup(), tile = s.plane.children[0];
    s.pointer('pointerdown', tile); s.pointer('pointerup', tile);
    await flush();
    s.history.back(); await flush();
    s.windowEvents.popstate({state: {lovePhoto: 2}}); await flush();
    s.finishAnimations(); await flush();
    assert.equal(s.viewer.open, true);
    assert.match(s.elements.viewerImage.src, /img2.jpg$/);
    assert.equal(s.plane.children.some(button => button.classes.has('is-viewer-source')), false);
    s.history.back(); await flush(); s.finishAnimations(); await flush();
    assert.equal(s.viewer.open, false);
});

test('resize while viewing returns to a connected tile and reduced motion skips flights', async () => {
    const s = setup({reduced: true}), original = s.plane.children[0];
    const before = s.plane.style.transform;
    s.tick(); assert.equal(s.plane.style.transform, before);
    s.pointer('pointerdown', original); s.pointer('pointerup', original);
    await flush(); s.finishAnimations(); await flush();
    assert.equal(s.animations.every(animation => animation.options.duration === 0), true);
    s.resize(1600, 1000);
    assert.equal(original.isConnected, false);
    s.history.back(); await flush(); s.finishAnimations(); await flush();
    assert.equal(s.viewer.open, false);
    assert.equal(s.focus.isConnected, true);
    assert.equal(s.focus.dataset.photo, original.dataset.photo);
});

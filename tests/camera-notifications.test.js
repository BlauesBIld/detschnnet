const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({permission = 'default', saved = false} = {}) {
    const elements = new Map(), notifications = [], timers = [], storage = new Map();
    if (saved) storage.set('camera-desktop-alerts', 'true');
    let requests = 0, source;
    function element() {
        return {children: [], hidden: false, disabled: false, value: '', textContent: '', dataset: {}, style: {},
            listeners: new Map(), classList: {toggle() {}},
            addEventListener(type, callback) {this.listeners.set(type, callback);},
            append(...children) {this.children.push(...children);}, replaceChildren(...children) {this.children = children;},
            setAttribute() {}, removeAttribute() {}, scrollIntoView() {}, play: async () => {}, pause() {}, load() {}};
    }
    const get = selector => {if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector);};
    get('#camera-settings').elements = {csrfToken: {value: 'test-token'}};
    get('#clip-filter').value = 'all';
    class Notification {
        static permission = permission;
        static async requestPermission() {requests++; return Notification.permission = 'granted';}
        constructor(title, options) {notifications.push({title, options});}
        close() {}
    }
    class EventSource {
        constructor() {source = this; this.handlers = new Map();}
        addEventListener(type, callback) {this.handlers.set(type, callback);}
        close() {}
        emit(type, data, id = 'session:1') {this.handlers.get(type)?.({data: JSON.stringify(data), lastEventId: id});}
    }
    const context = {document: {querySelector: get, createElement: element}, window: {Notification, focus() {}, addEventListener() {}, matchMedia: () => ({matches: true})},
        Notification, EventSource, localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
        fetch: async () => ({ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => ({clips: [], nextBefore: null})}),
        setTimeout: callback => {timers.push(callback); return timers.length;}, clearTimeout() {}, URLSearchParams, Date, Set, Number, String, Math};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/catcam/motion.js'), 'utf8'), context);
    return {get, notifications, source, requests: () => requests, Notification, click: selector => get(selector).listeners.get('click')?.({currentTarget: get(selector)})};
}

test('desktop notification permission is requested only by clicking the opt-in button', async () => {
    const page = setup();
    assert.equal(page.requests(), 0);
    page.source.emit('motion', {at: Date.now(), recording: true});
    assert.equal(page.notifications.length, 0);
    await page.click('#enable-notifications');
    assert.equal(page.requests(), 1);
    page.source.emit('motion', {at: Date.now() + 6000, recording: true}, 'session:2');
    assert.equal(page.notifications.length, 1);
    assert.equal(page.notifications[0].title, 'Camera motion detected');
    assert.match(page.notifications[0].options.body, /clip is being saved/);
    await page.click('#enable-notifications');
    page.source.emit('motion', {at: Date.now() + 12000, recording: true}, 'session:3');
    assert.equal(page.notifications.length, 1);
});

test('event replay and duplicate motion do not flood the desktop, and recording failures are stated honestly', () => {
    const page = setup({permission: 'granted', saved: true});
    const at = Date.now();
    page.source.emit('motion', {at, recording: false}, 'session:1');
    page.source.emit('motion', {at, recording: false}, 'session:1');
    page.source.emit('motion', {at: at + 1000, recording: true}, 'session:2');
    assert.equal(page.notifications.length, 1);
    assert.match(page.notifications[0].options.body, /Recording is currently unavailable/);
    page.source.emit('status', {enabled: true, sensor: 'listening', recording: 'error', warning: 'Disk full'});
    assert.match(page.get('#monitor-status').textContent, /Recording needs attention/);
    assert.equal(page.get('#monitor-warning').textContent, 'Disk full');
});

// Connects to the app's debuggable WebView via a minimal, hand-rolled Chrome
// DevTools Protocol client built on `ws` (no Chrome browser needed).
//
// NOTE: `chrome-remote-interface` was tried first, but its websocket
// handshake reliably hangs ("socket hang up") against this WebView's
// devtools server, even though a raw `ws` connection to the exact same
// webSocketDebuggerUrl works fine. Hence the small client below, which only
// implements what run-tests.js needs (Runtime.enable / Runtime.evaluate / close).
const http = require('http');
const WebSocket = require('ws');
const { adb, sleep } = require('./util');

const DEVTOOLS_LOCAL_PORT = 9222;
const SOCKET_WAIT_TIMEOUT_MS = 20000;
const TARGET_WAIT_TIMEOUT_MS = 20000;

// Other apps (e.g. Google app search webview) can expose their own
// webview_devtools_remote_<pid> socket, so we must match our app's own pid,
// not just grab the first devtools socket found on the device.
function findDevtoolsSocketForPid(serial, pid) {
    const result = adb(['shell', 'cat', '/proc/net/unix'], serial);
    const lines = (result.stdout || '').split('\n');
    const wantedSuffix = `webview_devtools_remote_${pid}`;
    const match = lines.find((line) => line.includes(wantedSuffix));
    if (!match) return null;
    const parts = match.trim().split(/\s+/);
    return parts[parts.length - 1].replace(/^@/, '');
}

async function waitForDevtoolsSocket(serial, pid, timeoutMs = SOCKET_WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const socketName = findDevtoolsSocketForPid(serial, pid);
        if (socketName) return socketName;
        await sleep(500);
    }
    throw new Error(`No debuggable WebView devtools socket found for pid ${pid}. Is the app running with debugging enabled?`);
}

function forwardDevtools(serial, socketName) {
    adb(['forward', `tcp:${DEVTOOLS_LOCAL_PORT}`, `localabstract:${socketName}`], serial);
}

function listPageTargets() {
    return new Promise((resolve, reject) => {
        http
            .get({ host: '127.0.0.1', port: DEVTOOLS_LOCAL_PORT, path: '/json/list' }, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(err);
                    }
                });
            })
            .on('error', reject);
    });
}

async function waitForPageTarget(timeoutMs = TARGET_WAIT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const targets = await listPageTargets();
        const page = targets.find((t) => t.type === 'page');
        if (page) return page;
        await sleep(500);
    }
    throw new Error('No WebView page target found via the DevTools Protocol.');
}

// Minimal CDP client: request/response correlation by id, events are ignored.
class CDPClient {
    constructor(ws) {
        this._ws = ws;
        this._nextId = 1;
        this._pending = new Map();
        ws.on('message', (data) => this._onMessage(data));
        this.Runtime = {
            enable: () => this._send('Runtime.enable'),
            evaluate: (params) => this._send('Runtime.evaluate', params),
        };
    }

    _onMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }
        if (msg.id && this._pending.has(msg.id)) {
            const { resolve, reject } = this._pending.get(msg.id);
            this._pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    }

    _send(method, params = {}) {
        const id = this._nextId++;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject });
            this._ws.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        return new Promise((resolve) => {
            this._ws.once('close', resolve);
            this._ws.close();
        });
    }
}

function connectWebSocket(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

async function connect(serial, pid) {
    const socketName = await waitForDevtoolsSocket(serial, pid);
    forwardDevtools(serial, socketName);

    const page = await waitForPageTarget();
    const wsPath = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, '');
    const ws = await connectWebSocket(`ws://127.0.0.1:${DEVTOOLS_LOCAL_PORT}${wsPath}`);

    const client = new CDPClient(ws);
    await client.Runtime.enable();
    return client;
}

async function waitForHarness(client, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { result } = await client.Runtime.evaluate({
            expression: 'typeof window.__healthTestHarness !== "undefined"',
            returnByValue: true,
        });
        if (result.value) return;
        await sleep(500);
    }
    throw new Error('Timed out waiting for window.__healthTestHarness to be ready.');
}

async function execHarness(client, command, args) {
    const expression = `window.__healthTestHarness.exec(${JSON.stringify(command)}, ${JSON.stringify(args)})`;
    const { result, exceptionDetails } = await client.Runtime.evaluate({
        expression,
        awaitPromise: true,
        returnByValue: true,
    });
    if (exceptionDetails) {
        // Errors from cordova's onError are often plain rejected strings, not
        // Error objects, so they show up as `.value` rather than `.description`.
        const exception = exceptionDetails.exception || {};
        const message = exception.description || exception.value;
        throw new Error(`Harness command "${command}" failed: ${message || exceptionDetails.text}`);
    }
    return result.value === undefined ? undefined : JSON.parse(result.value);
}

module.exports = { connect, waitForHarness, execHarness, DEVTOOLS_LOCAL_PORT };

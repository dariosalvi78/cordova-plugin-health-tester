// Connects to the app's WKWebView via WebKit's remote inspector protocol,
// bridged through `ios-webkit-debug-proxy` (brew install ios-webkit-debug-proxy).
//
// Unlike Chrome/Android, WebKit's inspector protocol is not flat: every real
// command must be wrapped in Target.sendMessageToTarget and responses come
// back inside Target.dispatchMessageFromTarget events. Confirmed via manual
// spike (see /memories/session/plan.md) - chrome-remote-interface-style flat
// clients do NOT work here, hence the small custom client below.
const fs = require('fs');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const WebSocket = require('ws');
const { sleep } = require('./util');

// Deliberately distinct from Android's fixed CDP port (9222, via adb forward)
// - a stale Android `adb forward tcp:9222 ...` left over from a previous run
// otherwise silently shadows this proxy's device-list port and causes
// confusing "Timed out waiting for a debuggable WKWebView page" failures.
const PROXY_DEVICE_PORT = 9331;
const PROXY_PAGE_PORT_RANGE = ':9331-9420';

// Finds the current simulator's webinspectord unix socket (one is created
// per boot under a random /private/tmp/com.apple.launchd.* directory).
function findSimulatorSocket() {
    const dir = '/private/tmp';
    const entries = fs.readdirSync(dir).filter((name) => name.startsWith('com.apple.launchd.'));
    let newest = null;
    for (const entry of entries) {
        const socketPath = `${dir}/${entry}/com.apple.webinspectord_sim.socket`;
        if (fs.existsSync(socketPath)) {
            const stat = fs.statSync(socketPath);
            if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { path: socketPath, mtimeMs: stat.mtimeMs };
        }
    }
    if (!newest) throw new Error('Could not find the simulator webinspectord socket. Is a simulator booted?');
    return newest.path;
}

function startProxy(socketPath) {
    // best-effort: clear out any stale instance from a previous interrupted run
    spawnSync('pkill', ['-f', 'ios_webkit_debug_proxy']);
    return spawn('ios_webkit_debug_proxy', ['-c', PROXY_PAGE_PORT_RANGE, '-s', `unix:${socketPath}`], {
        stdio: 'ignore',
    });
}

function httpGetJson(port, urlPath) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

async function waitForDevice(timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const devices = await httpGetJson(PROXY_DEVICE_PORT, '/json');
            if (devices.length > 0) return devices[0];
        } catch (err) {
            // proxy not listening yet
        }
        await sleep(500);
    }
    throw new Error('Timed out waiting for ios_webkit_debug_proxy to report the simulator device.');
}

async function waitForPage(pagePort, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const pages = await httpGetJson(pagePort, '/json');
            const page = pages.find((p) => p.webSocketDebuggerUrl);
            if (page) return page;
        } catch (err) {
            // not ready yet
        }
        await sleep(500);
    }
    throw new Error('Timed out waiting for a debuggable WKWebView page.');
}

// Minimal CDP client for WebKit's Target-wrapped inspector protocol.
class WebKitCDPClient {
    constructor(ws) {
        this._ws = ws;
        this._nextId = 1;
        this._pending = new Map();
        this._targetId = null;
        this._targetReady = new Promise((resolve) => {
            this._targetReadyResolve = resolve;
        });
        ws.on('message', (data) => this._onMessage(data));
        this.Runtime = {
            enable: () => this._sendToTarget('Runtime.enable'),
            evaluate: (params) => this._sendToTarget('Runtime.evaluate', params),
        };
    }

    _onMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch {
            return;
        }
        if (msg.method === 'Target.targetCreated' && !this._targetId) {
            this._targetId = msg.params.targetInfo.targetId;
            this._targetReadyResolve();
            return;
        }
        if (msg.method === 'Target.dispatchMessageFromTarget') {
            let inner;
            try {
                inner = JSON.parse(msg.params.message);
            } catch {
                return;
            }
            if (inner.id !== undefined && this._pending.has(inner.id)) {
                const { resolve, reject } = this._pending.get(inner.id);
                this._pending.delete(inner.id);
                if (inner.error) reject(new Error(inner.error.message));
                else resolve(inner.result);
            }
        }
    }

    async _sendToTarget(method, params = {}) {
        if (!this._targetId) await this._targetReady;
        const innerId = this._nextId++;
        const message = JSON.stringify({ id: innerId, method, params });
        return new Promise((resolve, reject) => {
            this._pending.set(innerId, { resolve, reject });
            this._ws.send(
                JSON.stringify({
                    id: this._nextId++,
                    method: 'Target.sendMessageToTarget',
                    params: { targetId: this._targetId, message },
                })
            );
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

async function connect() {
    const socketPath = findSimulatorSocket();
    const proxyProcess = startProxy(socketPath);
    await sleep(1500); // give the proxy a moment to start listening

    const device = await waitForDevice();
    const pagePort = Number(new URL(`http://${device.url}`).port);
    const page = await waitForPage(pagePort);

    const wsPath = new URL(page.webSocketDebuggerUrl.replace(/^ws:\/\//, 'http://')).pathname;
    const ws = await connectWebSocket(`ws://127.0.0.1:${pagePort}${wsPath}`);

    const client = new WebKitCDPClient(ws);
    await client.Runtime.enable();
    return { client, proxyProcess };
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

// Polls a global result flag instead of relying on Runtime.evaluate's
// awaitPromise, which was found (via spike) not to reliably resolve Promise
// results over WebKit's inspector protocol the way it does on Chrome/Android.
async function execHarness(client, command, args, timeoutMs = 30000) {
    const runId = `__harness_run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const kickoff = `
        window.${runId} = { done: false };
        window.__healthTestHarness.exec(${JSON.stringify(command)}, ${JSON.stringify(args)})
            .then((r) => { window.${runId} = { done: true, value: r }; })
            .catch((e) => { window.${runId} = { done: true, error: (e && e.message) || String(e) }; });
        true;
    `;
    await client.Runtime.evaluate({ expression: kickoff, returnByValue: true });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { result } = await client.Runtime.evaluate({
            expression: `JSON.stringify(window.${runId})`,
            returnByValue: true,
        });
        const state = JSON.parse(result.value);
        if (state.done) {
            await client.Runtime.evaluate({ expression: `delete window.${runId}`, returnByValue: true });
            if (state.error) throw new Error(`Harness command "${command}" failed: ${state.error}`);
            return state.value === undefined ? undefined : JSON.parse(state.value);
        }
        await sleep(300);
    }
    throw new Error(`Timed out waiting for harness command "${command}" to complete.`);
}

function stopProxy(proxyProcess) {
    if (proxyProcess && !proxyProcess.killed) proxyProcess.kill();
}

module.exports = { connect, waitForHarness, execHarness, stopProxy };

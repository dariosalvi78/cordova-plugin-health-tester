#!/usr/bin/env node
// Orchestrates the full Android E2E test run:
// setup AVD -> boot emulator -> build/install app -> grant permissions ->
// connect to the WebView via CDP -> run test scenarios -> report -> teardown.
const path = require('path');
const fs = require('fs');
const { adb, sleep } = require('./util');
const setupAvd = require('./setup-avd');
const lifecycle = require('./emulator-lifecycle');
const buildInstall = require('./build-and-install');
const permissions = require('./grant-permissions');
const bridge = require('./webview-bridge');
const { shouldRunOnPlatform } = require('../shared/test-filter');

const KEEP_EMULATOR = process.argv.includes('--keep-emulator');
const DIAGNOSTICS_DIR = path.join(__dirname, 'diagnostics');

async function waitFor(predicate, timeoutMs, description) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return;
        await sleep(500);
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function ensurePermissions(serial, client) {
    const unsupported = permissions.grantViaAdb(serial);
    if (permissions.checkGranted(serial, undefined, unsupported)) return;

    console.log('Direct adb grant did not stick; triggering consent screen and using UI automation...');
    const authPromise = bridge.execHarness(client, 'requestAuthorization', { read: ['steps'], write: ['steps'] });
    await sleep(3000); // let the Health Connect consent screen render
    permissions.grantViaUiAutomation(serial);
    await authPromise;

    if (!permissions.checkGranted(serial, undefined, unsupported)) {
        throw new Error('Unable to grant Health Connect permissions for steps, even with the UI automation fallback.');
    }
}

function captureDiagnostics(serial, testName) {
    const safeName = testName.replace(/[^a-z0-9]+/gi, '_');
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    try {
        adb(['shell', 'screencap', '-p', `/sdcard/${safeName}.png`], serial);
        adb(['pull', `/sdcard/${safeName}.png`, path.join(DIAGNOSTICS_DIR, `${safeName}.png`)], serial);
    } catch (err) {
        console.warn(`Could not capture screenshot: ${err.message}`);
    }
    try {
        const logcat = adb(['logcat', '-d'], serial, { allowFailure: true });
        fs.writeFileSync(path.join(DIAGNOSTICS_DIR, `${safeName}.log`), logcat.stdout || '');
    } catch (err) {
        console.warn(`Could not capture logcat: ${err.message}`);
    }
}

function printSummary(results) {
    console.log('\n=== Test Summary ===');
    for (const r of results) {
        if (r.skipped) {
            console.log(`SKIP  ${r.name}`);
        } else {
            console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
        }
    }
    const executed = results.filter((r) => !r.skipped);
    const passed = executed.filter((r) => r.pass).length;
    const skipped = results.filter((r) => r.skipped).length;
    console.log(`\n${passed}/${executed.length} passed${skipped ? ` (${skipped} skipped)` : ''}`);
}

async function main() {
    let serial;
    let client;
    const results = [];

    try {
        setupAvd.installPackages();
        if (!setupAvd.avdExists()) setupAvd.createAvd();

        serial = lifecycle.getBootedSerial();
        if (serial) {
            await lifecycle.waitForBoot(serial);
        } else {
            serial = await lifecycle.startEmulator();
        }
        lifecycle.setLockPin(serial);
        lifecycle.unlockScreen(serial);

        const apkFile = buildInstall.buildApk();
        buildInstall.installApk(serial, apkFile);
        buildInstall.launchApp(serial);
        await waitFor(() => !!buildInstall.getAppPid(serial), 20000, 'app process to start');
        const pid = buildInstall.getAppPid(serial);

        client = await bridge.connect(serial, pid);
        await bridge.waitForHarness(client);

        await ensurePermissions(serial, client);

        const harness = {
            platform: 'android',
            sleep,
            exec: (cmd, args) => bridge.execHarness(client, cmd, args),
        };

        const testsDir = path.join(__dirname, '..', 'shared', 'tests');
        const testFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js'));
        for (const file of testFiles) {
            const test = require(path.join(testsDir, file));
            if (!shouldRunOnPlatform(test, 'android')) {
                console.log(`\n--- Skipping: ${test.name} (platforms: ${JSON.stringify(test.platforms || test.platform)}) ---`);
                results.push({ name: test.name, pass: true, skipped: true });
                continue;
            }
            console.log(`\n--- Running: ${test.name} ---`);
            try {
                await test.run(harness);
                console.log(`PASS: ${test.name}`);
                results.push({ name: test.name, pass: true });
            } catch (err) {
                console.error(`FAIL: ${test.name}\n${err.stack || err}`);
                results.push({ name: test.name, pass: false, error: err.message });
                captureDiagnostics(serial, test.name);
            }
        }
    } finally {
        if (client) await client.close().catch(() => {});
        if (serial && !KEEP_EMULATOR) lifecycle.stopEmulator(serial);
    }

    printSummary(results);
    process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}

main().catch((err) => {
    console.error('Fatal error running the test suite:', err.stack || err);
    process.exitCode = 1;
});

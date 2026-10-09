#!/usr/bin/env node
// Orchestrates the full iOS Simulator E2E test run:
// setup simulator -> boot -> build/install app -> grant permissions ->
// connect to the WebView via WebKit's inspector protocol -> run test
// scenarios -> report -> teardown.
const path = require('path');
const fs = require('fs');
const { sleep, run } = require('./util');
const { appPath } = require('./config');
const setupSimulator = require('./setup-simulator');
const lifecycle = require('./simulator-lifecycle');
const buildInstall = require('./build-and-install');
const permissions = require('./grant-permissions');
const bridge = require('./webview-bridge');
const { shouldRunOnPlatform } = require('../shared/test-filter');

const KEEP_SIMULATOR = process.argv.includes('--keep-simulator');
const DIAGNOSTICS_DIR = path.join(__dirname, 'diagnostics');

function captureDiagnostics(udid, testName) {
    const safeName = testName.replace(/[^a-z0-9]+/gi, '_');
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
    try {
        run('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(DIAGNOSTICS_DIR, `${safeName}.png`)]);
    } catch (err) {
        console.warn(`Could not capture screenshot: ${err.message}`);
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
    let udid;
    let client;
    let proxyProcess;
    const results = [];

    try {
        udid = setupSimulator.ensureDevice();
        await lifecycle.bootSimulator(udid);

        const appBundlePath = buildInstall.buildApp();
        buildInstall.installApp(udid, appBundlePath);
        buildInstall.launchApp(udid);
        await sleep(2000); // let the app + webview spin up

        const connection = await bridge.connect();
        client = connection.client;
        proxyProcess = connection.proxyProcess;
        await bridge.waitForHarness(client);

        const harness = {
            platform: 'ios',
            sleep,
            exec: (cmd, args) => bridge.execHarness(client, cmd, args),
        };

        const testsDir = path.join(__dirname, '..', 'shared', 'tests');
        const testFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.js'));
        const tests = testFiles.map((file) => require(path.join(testsDir, file)));
        const applicableTests = tests.filter((t) => shouldRunOnPlatform(t, 'ios'));
        // Request every data type up front for applicable tests so a single consent sheet (if any)
        // covers all tests, instead of each test's own requestAuthorization
        // call potentially triggering its own separate sheet mid-run.
        const allDataTypes = [...new Set(applicableTests.flatMap((t) => t.dataTypes || []))];

        try {
            await permissions.grantHealthKitPermissions(udid, {
                requestAuthorization: () => harness.exec('requestAuthorization', { read: allDataTypes, write: allDataTypes }),
            });
        } catch (err) {
            console.warn(`Permission auto-grant failed or unavailable: ${err.message}`);
            console.warn('Continuing - tests that need HealthKit authorization may fail.');
        }

        for (const test of tests) {
            if (!shouldRunOnPlatform(test, 'ios')) {
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
                captureDiagnostics(udid, test.name);
            }
        }
    } finally {
        if (client) await client.close().catch(() => {});
        bridge.stopProxy(proxyProcess);
        if (udid && !KEEP_SIMULATOR) lifecycle.shutdownSimulator(udid);
    }

    printSummary(results);
    process.exitCode = results.some((r) => !r.pass) ? 1 : 0;
}

main().catch((err) => {
    console.error('Fatal error running the test suite:', err.stack || err);
    process.exitCode = 1;
});

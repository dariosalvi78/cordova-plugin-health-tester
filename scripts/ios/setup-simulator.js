#!/usr/bin/env node
// Ensures the required iOS runtime is installed and the dedicated test
// simulator device exists (a separate device from any you use manually).
const { simctl } = require('./util');
const { deviceName, deviceType, runtimeId } = require('./config');

function findDeviceUdid() {
    const result = simctl(['list', 'devices', '-j'], { allowFailure: true });
    try {
        const data = JSON.parse(result.stdout || '{}');
        const devicesByRuntime = data.devices || {};
        for (const runtime of Object.keys(devicesByRuntime)) {
            const match = devicesByRuntime[runtime].find((d) => d.name === deviceName);
            if (match) return match.udid;
        }
    } catch (err) {
        // ignore parse errors, treat as "not found"
    }
    return null;
}

function ensureRuntimeInstalled() {
    const result = simctl(['list', 'runtimes', '-j'], { allowFailure: true });
    try {
        const data = JSON.parse(result.stdout || '{}');
        const found = (data.runtimes || []).some((r) => r.identifier === runtimeId);
        if (!found) {
            throw new Error(
                `iOS runtime ${runtimeId} is not installed. Install it via Xcode > Settings > ` +
                    `Platforms, or "xcodebuild -downloadPlatform iOS", then re-run.`
            );
        }
    } catch (err) {
        if (err instanceof SyntaxError) return; // couldn't parse, let simctl create fail loudly instead
        throw err;
    }
}

function createDevice() {
    console.log(`Creating simulator "${deviceName}"...`);
    const result = simctl(['create', deviceName, deviceType, runtimeId]);
    return (result.stdout || '').trim();
}

function ensureDevice() {
    ensureRuntimeInstalled();
    const existing = findDeviceUdid();
    if (existing) {
        console.log(`Simulator "${deviceName}" already exists (${existing}).`);
        return existing;
    }
    return createDevice();
}

if (require.main === module) ensureDevice();

module.exports = { findDeviceUdid, ensureRuntimeInstalled, createDevice, ensureDevice };

// Builds the sample app's Simulator .app bundle, installs it, and launches it.
const path = require('path');
const fs = require('fs');
const { run, simctl } = require('./util');
const { bundleId, appPath } = require('./config');

const SAMPLE_APP_DIR = path.resolve(__dirname, '..', '..');

function buildApp() {
    console.log('Building sample app for iOS Simulator...');
    run('npx', ['cordova', 'build', 'ios', '--emulator'], { cwd: SAMPLE_APP_DIR, stdio: 'inherit' });
    const fullAppPath = path.join(SAMPLE_APP_DIR, appPath);
    if (!fs.existsSync(fullAppPath)) {
        throw new Error(`Expected app bundle not found at ${fullAppPath}`);
    }
    return fullAppPath;
}

function installApp(udid, appBundlePath) {
    console.log(`Installing ${appBundlePath} on ${udid}...`);
    simctl(['install', udid, appBundlePath]);
}

// Returns the launched process's pid, parsed from simctl's "<bundleId>: <pid>" output.
function launchApp(udid) {
    console.log('Launching app...');
    const result = simctl(['launch', udid, bundleId]);
    const match = (result.stdout || '').match(/:\s*(\d+)/);
    return match ? match[1] : null;
}

module.exports = { buildApp, installApp, launchApp, SAMPLE_APP_DIR };

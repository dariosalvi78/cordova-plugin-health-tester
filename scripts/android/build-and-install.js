// Builds the sample app's debug APK, installs it, and launches it on the device.
const path = require('path');
const fs = require('fs');
const { run, adb } = require('./util');
const { appId, mainActivity, apkPath } = require('./config');

const SAMPLE_APP_DIR = path.resolve(__dirname, '..', '..');

function buildApk() {
    console.log('Building sample app for Android...');
    run('cordova', ['build', 'android'], { cwd: SAMPLE_APP_DIR, stdio: 'inherit' });
    const fullApkPath = path.join(SAMPLE_APP_DIR, apkPath);
    if (!fs.existsSync(fullApkPath)) {
        throw new Error(`Expected APK not found at ${fullApkPath}`);
    }
    return fullApkPath;
}

function installApk(serial, apkFile) {
    console.log(`Installing ${apkFile} on ${serial}...`);
    adb(['install', '-r', apkFile], serial);
}

function launchApp(serial) {
    console.log('Launching app...');
    // force-stop first: guarantees a fresh process even if a previous run
    // left the app/task in a stuck state (e.g. blocked on a system dialog)
    adb(['shell', 'am', 'force-stop', appId], serial, { allowFailure: true });
    adb(['shell', 'am', 'start', '-n', `${appId}/${mainActivity}`], serial);
}

function getAppPid(serial) {
    const result = adb(['shell', 'pidof', appId], serial, { allowFailure: true });
    const pid = (result.stdout || '').trim();
    return pid || null;
}

module.exports = { buildApk, installApk, launchApp, getAppPid, SAMPLE_APP_DIR };

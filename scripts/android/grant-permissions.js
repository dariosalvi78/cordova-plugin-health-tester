// Grants Health Connect permissions for tests, preferring a direct adb grant
// and falling back to UI automation of the consent screen if that doesn't stick.
// NOTE: the UI-automation path is unverified/fragile and only used as a fallback.
const fs = require('fs');
const path = require('path');
const { adb } = require('./util');
const { appId } = require('./config');

// Reads every android.permission.health.* entry declared in config.xml, so
// adding a new test for another data type just means declaring its
// permission there (already required for Health Connect anyway) - no need to
// hardcode a permission list here.
function readDeclaredPermissions() {
    const configXmlPath = path.join(__dirname, '..', '..', 'config.xml');
    const xml = fs.readFileSync(configXmlPath, 'utf8');
    const matches = xml.matchAll(/android:name="(android\.permission\.health\.[A-Z0-9_]+)"/g);
    return [...new Set([...matches].map((m) => m[1]))];
}

function grantViaAdb(serial, permissions = readDeclaredPermissions()) {
    console.log(`Granting permissions via adb: ${permissions.join(', ')}`);
    const unsupported = [];
    for (const perm of permissions) {
        const result = adb(['shell', 'pm', 'grant', appId, perm], serial, { allowFailure: true });
        // Permissions added in newer Android versions than the emulator's are unknown to it.
        if (/Unknown permission/.test((result.stdout || '') + (result.stderr || ''))) unsupported.push(perm);
    }
    if (unsupported.length) {
        console.warn(`Skipping permissions unknown to this Android version: ${unsupported.join(', ')}`);
    }
    return unsupported;
}

function checkGranted(serial, permissions = readDeclaredPermissions(), ignore = []) {
    const result = adb(['shell', 'dumpsys', 'package', appId], serial, { allowFailure: true });
    const output = result.stdout || '';
    return permissions
        .filter((perm) => !ignore.includes(perm))
        .every((perm) => new RegExp(`${perm}: granted=true`).test(output));
}

function grantViaUiAutomation(serial) {
    console.log('Falling back to UI automation on the Health Connect consent screen...');
    adb(['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml'], serial);
    const dumpResult = adb(['shell', 'cat', '/sdcard/window_dump.xml'], serial);
    const xml = dumpResult.stdout || '';

    const match = xml.match(/text="Allow all"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!match) {
        throw new Error('Could not find an "Allow all" button in the Health Connect consent screen dump.');
    }
    const [, x1, y1, x2, y2] = match.slice(1).map(Number);
    const tapX = Math.round((x1 + x2) / 2);
    const tapY = Math.round((y1 + y2) / 2);
    adb(['shell', 'input', 'tap', String(tapX), String(tapY)], serial);
}

module.exports = { grantViaAdb, checkGranted, grantViaUiAutomation, readDeclaredPermissions };

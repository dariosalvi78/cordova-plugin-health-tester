// Grants HealthKit permissions for tests.
//
// Unlike Android's Health Connect, `xcrun simctl privacy` has NO "health"
// service (confirmed via `xcrun simctl help privacy` - only calendar,
// contacts, location, photos, media-library, microphone, motion, reminders,
// siri are supported). There is no adb-grant-style shortcut for HealthKit.
//
// HealthKit's authorization sheet is presented natively, inside the app's own
// process (not a separate system app), so the only way to automate it is UI
// automation of that sheet. We use `idb` (Facebook's iOS automation tool,
// https://fbidb.io) for simulator taps since it needs no changes to the
// Cordova-generated Xcode project (unlike XCUITest, which would require a
// test target that `cordova prepare` would wipe out on every rebuild).
//
// Verified manually: idb's accessibility ("ax") backend cannot find the
// sheet's "Turn On All"/"Allow" buttons by label (they live outside the
// app's own accessibility tree), so this uses coordinate-based HID taps
// instead, positioned as fractions of the screen size (fetched from idb
// itself, not hardcoded pixels) based on this sheet's observed layout:
// "Turn On All" toggle ~54% down the screen, "Allow" button ~85% down.
const { spawnSync } = require('child_process');
const { sleep } = require('./util');

const TURN_ON_ALL_Y_FRACTION = 0.539;
const ALLOW_Y_FRACTION = 0.848;
const X_FRACTION = 0.49;

function checkIdbAvailable() {
    const idb = spawnSync('idb', ['list-targets'], { encoding: 'utf8' });
    const companion = spawnSync('idb_companion', ['--help'], { encoding: 'utf8' });
    return idb.status === 0 && companion.status === 0;
}

function getScreenSize(udid) {
    const result = spawnSync('idb', ['ui', 'describe-all', '--format', 'complete', '--udid', udid, '--json'], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`idb ui describe-all failed:\n${result.stdout}${result.stderr}`);
    }
    const data = JSON.parse(result.stdout);
    return data.screen; // { width, height } in points
}

function tap(udid, xFraction, yFraction, screen) {
    const x = Math.round(screen.width * xFraction);
    const y = Math.round(screen.height * yFraction);
    const result = spawnSync('idb', ['ui', 'tap', String(x), String(y), '--api', 'hid', '--udid', udid], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(`idb ui tap ${x},${y} failed:\n${result.stdout}${result.stderr}`);
    }
}

async function tapAllowViaIdb(udid) {
    const screen = getScreenSize(udid);
    tap(udid, X_FRACTION, TURN_ON_ALL_Y_FRACTION, screen); // "Turn On All"
    await sleep(500);
    tap(udid, X_FRACTION, ALLOW_Y_FRACTION, screen); // "Allow"
}

async function grantHealthKitPermissions(udid, { requestAuthorization }) {
    if (!checkIdbAvailable()) {
        throw new Error(
            'HealthKit permissions cannot be auto-granted: `idb`/`idb_companion` are not installed, and ' +
                'there is no `simctl privacy` service for HealthKit. Install them with:\n' +
                '  brew tap facebook/fb && brew install idb-companion && pip3 install fb-idb\n' +
                'or grant the permission manually by tapping through the consent sheet once on the simulator.'
        );
    }

    spawnSync('idb', ['connect', udid], { encoding: 'utf8' }); // safe to call even if already connected

    // Trigger the consent sheet (fire-and-forget on the harness side; we tap
    // afterwards once it's had time to render). If everything is already
    // authorized from a previous run, no sheet appears and the taps are
    // harmless no-ops that land on the app's own (already dismissed) screen.
    const authPromise = requestAuthorization();
    await sleep(2000);
    try {
        await tapAllowViaIdb(udid);
    } catch (err) {
        console.warn(`idb tap attempt failed (may be harmless if already authorized): ${err.message}`);
    }
    await authPromise;
}

module.exports = { checkIdbAvailable, tapAllowViaIdb, grantHealthKitPermissions };

module.exports = { checkIdbAvailable, tapAllowViaIdb, grantHealthKitPermissions };

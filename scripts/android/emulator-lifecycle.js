// Boot/shutdown lifecycle for the headless test emulator, plus the lock-screen
// PIN setup that Health Connect requires to be present on the device.
const { spawn } = require('child_process');
const { paths, adb, sleep } = require('./util');
const { avdName, lockPin } = require('./config');

const BOOT_TIMEOUT_MS = 3 * 60 * 1000;
const ATTACH_TIMEOUT_MS = 60 * 1000;
const POLL_INTERVAL_MS = 2000;

function getBootedSerial() {
    const result = adb(['devices']);
    const lines = (result.stdout || '').split('\n').slice(1);
    for (const line of lines) {
        const [serial, state] = line.trim().split(/\s+/);
        if (serial && serial.startsWith('emulator-') && state === 'device') return serial;
    }
    return null;
}

async function waitForBoot(serial, timeoutMs = BOOT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = adb(['shell', 'getprop', 'sys.boot_completed'], serial, { allowFailure: true });
        if ((result.stdout || '').trim() === '1') return;
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`Emulator ${serial} did not finish booting within ${timeoutMs}ms`);
}

async function startEmulator() {
    console.log(`Booting emulator "${avdName}" headless...`);
    const child = spawn(
        paths.emulator,
        ['-avd', avdName, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect'],
        { detached: true, stdio: 'ignore' }
    );
    child.unref();

    const deadline = Date.now() + ATTACH_TIMEOUT_MS;
    let serial = null;
    while (Date.now() < deadline && !serial) {
        serial = getBootedSerial();
        if (!serial) await sleep(1000);
    }
    if (!serial) throw new Error('Emulator did not appear in `adb devices` output in time.');

    await waitForBoot(serial);
    console.log(`Emulator booted: ${serial}`);
    return serial;
}

function setLockPin(serial) {
    console.log('Setting lock screen PIN (required by Health Connect)...');
    adb(['shell', 'locksettings', 'set-pin', lockPin], serial, { allowFailure: true });
}

function unlockScreen(serial) {
    adb(['shell', 'wm', 'dismiss-keyguard'], serial, { allowFailure: true });
    adb(['shell', 'input', 'keyevent', '82'], serial, { allowFailure: true });
}

function stopEmulator(serial) {
    console.log(`Stopping emulator ${serial}...`);
    adb(['emu', 'kill'], serial, { allowFailure: true });
}

module.exports = { getBootedSerial, waitForBoot, startEmulator, setLockPin, unlockScreen, stopEmulator };

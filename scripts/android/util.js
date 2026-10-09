// Small process/adb helpers shared by the Android E2E test automation scripts.
const path = require('path');
const { spawnSync } = require('child_process');

const ANDROID_HOME = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!ANDROID_HOME) {
    throw new Error('ANDROID_HOME (or ANDROID_SDK_ROOT) must be set to run the Android test automation.');
}

const paths = {
    androidHome: ANDROID_HOME,
    adb: path.join(ANDROID_HOME, 'platform-tools', 'adb'),
    emulator: path.join(ANDROID_HOME, 'emulator', 'emulator'),
    avdmanager: path.join(ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    sdkmanager: path.join(ANDROID_HOME, 'cmdline-tools', 'latest', 'bin', 'sdkmanager'),
};

function run(cmd, args, opts = {}) {
    const { allowFailure, ...spawnOpts } = opts;
    const result = spawnSync(cmd, args, { encoding: 'utf8', ...spawnOpts });
    if (result.status !== 0 && !allowFailure) {
        const out = (result.stdout || '') + (result.stderr || '');
        throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}\n${out}`);
    }
    return result;
}

function adb(args, serial, opts = {}) {
    const fullArgs = serial ? ['-s', serial, ...args] : args;
    return run(paths.adb, fullArgs, opts);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { paths, run, adb, sleep };

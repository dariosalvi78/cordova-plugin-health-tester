// Small process helpers shared by the iOS Simulator E2E test automation scripts.
const { spawnSync } = require('child_process');

function run(cmd, args, opts = {}) {
    const { allowFailure, ...spawnOpts } = opts;
    const result = spawnSync(cmd, args, { encoding: 'utf8', ...spawnOpts });
    if (result.status !== 0 && !allowFailure) {
        const out = (result.stdout || '') + (result.stderr || '');
        throw new Error(`Command failed (${result.status}): ${cmd} ${args.join(' ')}\n${out}`);
    }
    return result;
}

function simctl(args, opts = {}) {
    return run('xcrun', ['simctl', ...args], opts);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { run, simctl, sleep };

// Boot/shutdown lifecycle for the dedicated test simulator.
const { simctl, sleep } = require('./util');

const BOOT_TIMEOUT_MS = 3 * 60 * 1000;

function isBooted(udid) {
    const result = simctl(['list', 'devices', '-j'], { allowFailure: true });
    try {
        const data = JSON.parse(result.stdout || '{}');
        for (const runtime of Object.keys(data.devices || {})) {
            const match = data.devices[runtime].find((d) => d.udid === udid);
            if (match) return match.state === 'Booted';
        }
    } catch (err) {
        // ignore, treat as not booted
    }
    return false;
}

async function waitForBoot(udid, timeoutMs = BOOT_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = simctl(['bootstatus', udid, '-b'], { allowFailure: true });
        if (result.status === 0) return;
        await sleep(2000);
    }
    throw new Error(`Simulator ${udid} did not finish booting within ${timeoutMs}ms`);
}

async function bootSimulator(udid) {
    if (isBooted(udid)) {
        console.log(`Simulator ${udid} is already booted.`);
        return;
    }
    console.log(`Booting simulator ${udid}...`);
    simctl(['boot', udid]);
    await waitForBoot(udid);
    console.log('Simulator booted.');
}

function shutdownSimulator(udid) {
    console.log(`Shutting down simulator ${udid}...`);
    simctl(['shutdown', udid], { allowFailure: true });
}

module.exports = { isBooted, waitForBoot, bootSimulator, shutdownSimulator };

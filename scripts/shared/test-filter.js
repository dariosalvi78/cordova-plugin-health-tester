// Helper to check whether a shared test is targeted for a given platform ('android' or 'ios').
// Tests can optionally export `platforms: ['android']` (or `platform: 'ios'`, etc.).
// If omitted or empty, the test runs on all platforms.
function shouldRunOnPlatform(test, currentPlatform) {
    if (!test) return false;
    const raw = test.platforms !== undefined ? test.platforms : test.platform;
    if (!raw) return true;

    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length === 0) return true;

    const target = String(currentPlatform).toLowerCase();
    return list.some((p) => String(p).toLowerCase() === target);
}

module.exports = { shouldRunOnPlatform };

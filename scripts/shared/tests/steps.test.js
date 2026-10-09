// E2E scenario: request auth for steps, store a sample, query it back, then delete it.
// Shared between scripts/android/run-tests.js and scripts/ios/run-tests.js -
// the plugin's JS API is unified across platforms, so the same harness
// commands apply unchanged on both.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'steps: request authorization, store, query, delete',
    dataTypes: ['steps'],
    async run(harness) {
        const now = Date.now() - 120000;
        // Epoch-ms numbers: JSON-safe over the CDP wire. The in-browser test
        // harness (www/js/test-harness.js) converts these to real Date
        // objects before calling the plugin, since iOS requires Date
        // instances while Android accepts either.
        const startDate = now - 60 * 1000;
        const endDate = now;
        const stepsValue = 42;

        await harness.exec('requestAuthorization', { read: ['steps'], write: ['steps'] });

        const authorized = await harness.exec('isAuthorized', { read: ['steps'], write: ['steps'] });
        assert(authorized === true, `Expected app to be authorized for steps, got: ${JSON.stringify(authorized)}`);

        await harness.exec('store', { dataType: 'steps', startDate, endDate, value: stepsValue });

        const queried = await harness.exec('query', {
            dataType: 'steps',
            startDate: startDate - 1000,
            endDate: endDate + 1000,
        });
        assert(Array.isArray(queried), `Expected query result to be an array, got: ${JSON.stringify(queried)}`);
        const stored = queried.find(
            (d) => d.value === stepsValue && Math.abs(new Date(d.startDate).getTime() - startDate) < 2000
        );
        assert(stored, `Expected to find stored steps sample (value=${stepsValue}) in: ${JSON.stringify(queried)}`);

        await harness.exec('delete', { dataType: 'steps', startDate, endDate });

        const afterDelete = await harness.exec('query', {
            dataType: 'steps',
            startDate: startDate - 1000,
            endDate: endDate + 1000,
        });
        const stillThere = afterDelete.find(
            (d) => d.value === stepsValue && Math.abs(new Date(d.startDate).getTime() - startDate) < 2000
        );
        assert(!stillThere, `Expected steps sample to be deleted, but still found: ${JSON.stringify(stillThere)}`);
    },
};

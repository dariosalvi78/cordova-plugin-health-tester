// E2E scenario: request auth for steps, store a sample, query it back, then delete it.
// Shared between scripts/android/run-tests.js and scripts/ios/run-tests.js -
// the plugin's JS API is unified across platforms, so the same harness
// commands apply unchanged on both.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'activity_intensity: request authorization, store, query, delete',
    platforms: ['android'],
    dataTypes: ['activity_intensity'],
    async run(harness) {
        const now = Date.now() - 120000;
        // Epoch-ms numbers: JSON-safe over the CDP wire. The in-browser test
        // harness (www/js/test-harness.js) converts these to real Date
        // objects before calling the plugin, since iOS requires Date
        // instances while Android accepts either.
        const startDate = now - 15 * 60 * 1000;
        const endDate = now;
        const activityIntensityValue = 'moderate';

        await harness.exec('requestAuthorization', { read: ['activity_intensity'], write: ['activity_intensity'] });

        const authorized = await harness.exec('isAuthorized', { read: ['activity_intensity'], write: ['activity_intensity'] });
        assert(authorized === true, `Expected app to be authorized for activity_intensity, got: ${JSON.stringify(authorized)}`);

        await harness.exec('store', { dataType: 'activity_intensity', startDate, endDate, value: activityIntensityValue });

        const queried = await harness.exec('query', {
            dataType: 'activity_intensity',
            startDate: startDate - 120000,
            endDate: endDate + 120000,
        });
        assert(Array.isArray(queried), `Expected query result to be an array, got: ${JSON.stringify(queried)}`);
        const stored = queried.find(
            (d) => d.value === activityIntensityValue && Math.abs(new Date(d.startDate).getTime() - startDate) < 2000
        );
        assert(stored, `Expected to find stored activity_intensity sample (value=${activityIntensityValue}) in: ${JSON.stringify(queried)}`);

        await harness.exec('delete', { dataType: 'activity_intensity', startDate, endDate });

        const afterDelete = await harness.exec('query', {
            dataType: 'activity_intensity',
            startDate: startDate - 120000,
            endDate: endDate + 120000,
        });
        const stillThere = afterDelete.find(
            (d) => d.value === activityIntensityValue && Math.abs(new Date(d.startDate).getTime() - startDate) < 2000
        );
        assert(!stillThere, `Expected activity_intensity sample to be deleted, but still found: ${JSON.stringify(stillThere)}`);
    },
};

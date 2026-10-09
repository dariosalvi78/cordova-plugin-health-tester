// E2E scenario: request auth for vo2max, store a point-in-time sample, query it back, then delete it.
// vo2max is a point-in-time measurement (Android's Vo2MaxRecord only uses
// startDate internally), so startDate/endDate are set equal here.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'vo2max: request authorization, store, query, delete',
    dataTypes: ['vo2max'],
    async run(harness) {
        // A few seconds in the past, not exactly "now": Health Connect
        // rejects record times "in the future", and small clock skew between
        // this host and the emulator/simulator can otherwise trip that check.
        const timestamp = Date.now() - 120000;
        const vo2maxValue = 42.5; // mL/kg/min

        await harness.exec('requestAuthorization', { read: ['vo2max'], write: ['vo2max'] });

        const authorized = await harness.exec('isAuthorized', { read: ['vo2max'], write: ['vo2max'] });
        assert(authorized === true, `Expected app to be authorized for vo2max, got: ${JSON.stringify(authorized)}`);

        await harness.exec('store', {
            dataType: 'vo2max',
            startDate: timestamp,
            endDate: timestamp,
            value: vo2maxValue,
        });

        const queried = await harness.exec('query', {
            dataType: 'vo2max',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        assert(Array.isArray(queried), `Expected query result to be an array, got: ${JSON.stringify(queried)}`);
        const stored = queried.find(
            (d) => Math.abs(d.value - vo2maxValue) < 0.01 && Math.abs(new Date(d.startDate).getTime() - timestamp) < 2000
        );
        assert(stored, `Expected to find stored vo2max sample (value=${vo2maxValue}) in: ${JSON.stringify(queried)}`);

        // Delete by range, not an exact instant: Android requires endDate > startDate.
        await harness.exec('delete', {
            dataType: 'vo2max',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });

        const afterDelete = await harness.exec('query', {
            dataType: 'vo2max',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        const stillThere = afterDelete.find(
            (d) => Math.abs(d.value - vo2maxValue) < 0.01 && Math.abs(new Date(d.startDate).getTime() - timestamp) < 2000
        );
        assert(!stillThere, `Expected vo2max sample to be deleted, but still found: ${JSON.stringify(stillThere)}`);
    },
};

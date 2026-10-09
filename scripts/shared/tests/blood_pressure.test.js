// E2E scenario: request auth for blood_pressure, store a point-in-time
// systolic/diastolic reading, query it back, then delete it.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'blood_pressure: request authorization, store, query, delete',
    dataTypes: ['blood_pressure'],
    async run(harness) {
        // A few seconds in the past, not exactly "now": Health Connect
        // rejects record times "in the future", and small clock skew between
        // this host and the emulator/simulator can otherwise trip that check.
        const timestamp = Date.now() - 120000;
        const systolic = 120;
        const diastolic = 80;

        await harness.exec('requestAuthorization', { read: ['blood_pressure'], write: ['blood_pressure'] });

        const authorized = await harness.exec('isAuthorized', { read: ['blood_pressure'], write: ['blood_pressure'] });
        assert(authorized === true, `Expected app to be authorized for blood_pressure, got: ${JSON.stringify(authorized)}`);

        await harness.exec('store', {
            dataType: 'blood_pressure',
            startDate: timestamp,
            endDate: timestamp,
            value: { systolic, diastolic },
        });

        const queried = await harness.exec('query', {
            dataType: 'blood_pressure',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        assert(Array.isArray(queried), `Expected query result to be an array, got: ${JSON.stringify(queried)}`);
        const matches = (d) =>
            d.value &&
            Math.abs(d.value.systolic - systolic) < 0.01 &&
            Math.abs(d.value.diastolic - diastolic) < 0.01 &&
            Math.abs(new Date(d.startDate).getTime() - timestamp) < 2000;

        const stored = queried.find(matches);
        assert(
            stored,
            `Expected to find stored blood_pressure sample (systolic=${systolic}, diastolic=${diastolic}) in: ${JSON.stringify(queried)}`
        );

        // Delete by range, not an exact instant: Android requires endDate > startDate.
        await harness.exec('delete', {
            dataType: 'blood_pressure',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });

        const afterDelete = await harness.exec('query', {
            dataType: 'blood_pressure',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        const stillThere = afterDelete.find(matches);
        assert(!stillThere, `Expected blood_pressure sample to be deleted, but still found: ${JSON.stringify(stillThere)}`);
    },
};

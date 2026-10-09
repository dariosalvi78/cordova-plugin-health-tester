// E2E scenario: request auth for basal_body_temperature, store a point-in-time sample, query it back, then delete it.
// basal_body_temperature is a point-in-time measurement (Android's BasalBodyTemperatureRecord only uses
// startDate internally), so startDate/endDate are set equal here.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'basal_body_temperature: request authorization, store, query, delete',
    dataTypes: ['basal_body_temperature'],
    async run(harness) {
        // A few seconds in the past, not exactly "now": Health Connect
        // rejects record times "in the future", and small clock skew between
        // this host and the emulator/simulator can otherwise trip that check.
        const timestamp = Date.now() - 120000;
        const basalBodyTemperatureValue = 36.5; // °C

        await harness.exec('requestAuthorization', { read: ['basal_body_temperature'], write: ['basal_body_temperature'] });

        const authorized = await harness.exec('isAuthorized', { read: ['basal_body_temperature'], write: ['basal_body_temperature'] });
        assert(authorized === true, `Expected app to be authorized for basal_body_temperature, got: ${JSON.stringify(authorized)}`);

        await harness.exec('store', {
            dataType: 'basal_body_temperature',
            startDate: timestamp,
            endDate: timestamp,
            value: basalBodyTemperatureValue,
        });

        const queried = await harness.exec('query', {
            dataType: 'basal_body_temperature',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        assert(Array.isArray(queried), `Expected query result to be an array, got: ${JSON.stringify(queried)}`);
        const stored = queried.find(
            (d) => Math.abs(d.value - basalBodyTemperatureValue) < 0.01 && Math.abs(new Date(d.startDate).getTime() - timestamp) < 2000
        );
        assert(stored, `Expected to find stored basal_body_temperature sample (value=${basalBodyTemperatureValue}) in: ${JSON.stringify(queried)}`);

        // Delete by range, not an exact instant: Android requires endDate > startDate.
        await harness.exec('delete', {
            dataType: 'basal_body_temperature',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });

        const afterDelete = await harness.exec('query', {
            dataType: 'basal_body_temperature',
            startDate: timestamp - 1000,
            endDate: timestamp + 1000,
        });
        const stillThere = afterDelete.find(
            (d) => Math.abs(d.value - basalBodyTemperatureValue) < 0.01 && Math.abs(new Date(d.startDate).getTime() - timestamp) < 2000
        );
        assert(!stillThere, `Expected basal_body_temperature sample to be deleted, but still found: ${JSON.stringify(stillThere)}`);
    },
};

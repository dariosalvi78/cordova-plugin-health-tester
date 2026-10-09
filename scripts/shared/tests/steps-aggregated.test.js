// E2E scenario: store several steps samples, then verify queryAggregated
// (no bucket) returns their correct cumulative sum as a single object.
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

module.exports = {
    name: 'steps: queryAggregated (no bucket) sums stored values',
    dataTypes: ['steps'],
    async run(harness) {
        const recordCount = 10;
        const valuePerRecord = 10;
        const recordDurationMs = 1000;
        const gapMs = 2000;
        // Comfortably in the past (not exactly "now"): Health Connect rejects
        // record times "in the future", and clock skew can trip that at an exact instant.
        const baseTime = Date.now() - 120000 - recordCount * (recordDurationMs + gapMs);

        await harness.exec('requestAuthorization', { read: ['steps'], write: ['steps'] });

        const records = [];
        for (let i = 0; i < recordCount; i++) {
            const startDate = baseTime + i * (recordDurationMs + gapMs);
            const endDate = startDate + recordDurationMs;
            records.push({ startDate, endDate });
            await harness.exec('store', { dataType: 'steps', startDate, endDate, value: valuePerRecord });
        }

        const rangeStart = records[0].startDate - 1000;
        const rangeEnd = records[records.length - 1].endDate + 1000;

        // Health Connect may need a moment before aggregates reflect fresh writes.
        if (harness.platform === 'android') await harness.sleep(3000);

        try {
            const aggregated = await harness.exec('queryAggregated', {
                dataType: 'steps',
                startDate: rangeStart,
                endDate: rangeEnd,
            });

            assert(
                aggregated && typeof aggregated === 'object' && !Array.isArray(aggregated),
                `Expected a single aggregated object (no bucket requested), got: ${JSON.stringify(aggregated)}`
            );
            const expectedTotal = recordCount * valuePerRecord;
            assert(
                aggregated.value === expectedTotal,
                `Expected aggregated steps value ${expectedTotal}, got: ${JSON.stringify(aggregated)}`
            );
        } finally {
            // cleanup, even if the assertions above failed
            for (const record of records) {
                await harness.exec('delete', {
                    dataType: 'steps',
                    startDate: record.startDate - 1,
                    endDate: record.endDate + 1,
                });
            }
        }
    },
};

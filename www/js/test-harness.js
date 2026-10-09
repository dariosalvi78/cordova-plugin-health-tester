// Bridge exposing cordova.plugins.health as Promise-returning commands, driven
// remotely over the Chrome DevTools Protocol by scripts/android/run-tests.js.
(function () {
    function wrapSingleArg(fn) {
        return (arg) => new Promise((resolve, reject) => fn(arg, resolve, reject));
    }

    function wrapNoArg(fn) {
        return () => new Promise((resolve, reject) => fn(resolve, reject));
    }

    // Test scenarios send startDate/endDate as plain epoch-ms numbers (JSON-safe
    // over the CDP wire). Android's plugin API accepts numbers directly, but
    // iOS's native store()/query()/delete() require real JS Date instances -
    // so the harness converts them here, right before calling the plugin.
    function withDateFields(args) {
        if (!args || typeof args !== 'object') return args;
        const converted = Object.assign({}, args);
        if (typeof converted.startDate === 'number') converted.startDate = new Date(converted.startDate);
        if (typeof converted.endDate === 'number') converted.endDate = new Date(converted.endDate);
        return converted;
    }

    function install() {
        const health = cordova.plugins.health;

        const commands = {
            isAvailable: wrapNoArg((onSuccess, onError) => health.isAvailable(onSuccess, onError)),
            requestAuthorization: wrapSingleArg((authObj, onSuccess, onError) => health.requestAuthorization(authObj, onSuccess, onError)),
            isAuthorized: wrapSingleArg((authObj, onSuccess, onError) => health.isAuthorized(authObj, onSuccess, onError)),
            query: wrapSingleArg((opts, onSuccess, onError) => health.query(withDateFields(opts), onSuccess, onError)),
            queryAggregated: wrapSingleArg((opts, onSuccess, onError) => health.queryAggregated(withDateFields(opts), onSuccess, onError)),
            store: wrapSingleArg((data, onSuccess, onError) => health.store(withDateFields(data), onSuccess, onError)),
            delete: wrapSingleArg((data, onSuccess, onError) => health.delete(withDateFields(data), onSuccess, onError)),
        };

        window.__healthTestHarness = {
            ready: true,
            // returns a JSON string so results survive the CDP round-trip unambiguously (e.g. Date objects)
            exec(command, args) {
                const fn = commands[command];
                if (!fn) {
                    return Promise.reject(new Error(`Unknown harness command: ${command}`));
                }
                return fn(args).then((result) => JSON.stringify(result === undefined ? null : result));
            },
        };
    }

    document.addEventListener('deviceready', install, false);
})();

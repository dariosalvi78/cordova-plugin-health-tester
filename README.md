# E2E test automation (Android + iOS)

Scripts in this folder automate testing `cordova-plugin-health` against real
Health Connect (Android) and HealthKit (iOS) implementations, end to end,
without manual steps on an emulator/simulator.

## What it does

1. **Provision** a virtual device: an Android Virtual Device (API 36,
   `google_apis`, arm64, Health Connect built in) or an iOS Simulator
   (iPhone 17 Pro, iOS 26.1).
2. **Boot** it headlessly (Android also configures a lock screen PIN, required
   by Health Connect).
3. **Build & install** the sample app and launch it.
4. **Grant permissions** for the data type(s) under test (aggregated from every
   test file's `dataTypes` so one pass covers everything):
   - Android: `adb shell pm grant`, falling back to UI automation of the
     Health Connect consent screen if the direct grant doesn't stick.
   - iOS: there is no `simctl privacy` service for HealthKit, so this uses
     `idb` (`https://fbidb.io`) to tap the native consent sheet via
     coordinate-based HID taps (the sheet isn't reachable through idb's
     accessibility tree by label). Verified working end-to-end. If
     `idb`/`idb_companion` aren't installed, a clear warning is printed and
     the run continues (tests needing authorization may then fail, unless
     already granted from a previous run on the same simulator).
5. **Connect to the app's WebView**:
   - Android: over the Chrome DevTools Protocol via `adb forward` + a small
     hand-rolled CDP client built on the `ws` package (no Chrome browser
     required; `chrome-remote-interface` was tried first but its websocket
     handshake hangs against this WebView's devtools server).
   - iOS: via `ios-webkit-debug-proxy` (`brew install ios-webkit-debug-proxy`)
     bridging WebKit's remote inspector protocol, plus a small custom client
     (also on `ws`) that wraps every command in `Target.sendMessageToTarget`
     - WebKit's protocol is not flat like Chrome's.
6. **Run test scenarios** (in `scripts/shared/tests/*.test.js`, shared by both
   platforms) against `window.__healthTestHarness`, a small bridge injected
   into the app (`www/js/test-harness.js`) that wraps the plugin's callback
   API in Promises so it can be driven remotely.
7. **Report** pass/fail per scenario, capturing diagnostics on failure
   (Android: screenshot + logcat; iOS: screenshot), and exits non-zero if
   anything failed.

## Prerequisites

- **Android**: Android SDK installed, with `ANDROID_HOME` (or
  `ANDROID_SDK_ROOT`) set and `cmdline-tools`, `platform-tools`, and
  `emulator` packages present. `cordova` CLI on `PATH`.
- **iOS**: Xcode with the iOS 26.1 simulator runtime installed, and
  `ios-webkit-debug-proxy` (`brew install ios-webkit-debug-proxy`). For
  automated permission granting, also install `idb`:
  `brew tap facebook/fb && brew install idb-companion && pipx install fb-idb`
  (pipx keeps it isolated from system Python; `brew trust --tap facebook/fb`
  may be needed first since it's a third-party tap).
- Run `npm install` in `sample-app/` once (installs the `ws` package).

## npm scripts

| Script                        | What it does |
|--------------------------------|--------------|
| `npm run test:android:setup`   | Installs the required SDK packages and creates the `cordova_health_test_api36` AVD if missing. No build, no tests. |
| `npm run test:android`         | Full Android run: setup → boot emulator → build/install/launch app → grant permissions → run tests → report, then **shuts the emulator down** afterwards regardless of outcome. |
| `npm run test:android:keep`    | Same as `test:android`, but leaves the emulator running afterwards (`--keep-emulator`) so you can inspect device state instead of it disappearing right after the run. |
| `npm run test:ios:setup`       | Ensures the iOS runtime is installed and creates the `cordova_health_test` simulator device if missing. |
| `npm run test:ios`             | Full iOS run: setup → boot simulator → build/install/launch app → grant permissions → run tests → report, then **shuts the simulator down** afterwards. |
| `npm run test:ios:keep`        | Same as `test:ios`, but leaves the simulator running afterwards (`--keep-simulator`). |

## Adding a new test scenario

Add a file to `scripts/shared/tests/` (e.g. `weight.test.js`) exporting
`{ name, dataTypes, platforms, async run(harness) }`:
- `dataTypes`: array of plugin data type strings the test needs (e.g.
  `['weight']`) - used to request all permissions for all tests up front in
  one pass (Android grants them all via adb; iOS requests them all in a
  single `requestAuthorization` call so at most one consent sheet appears).
- `platforms`: (optional) array of platform names where the test should run,
  e.g. `['android']`, `['ios']`, or `['android', 'ios']` (or a single string
  `'android'` / `'ios'`). If omitted or empty, the test runs on both platforms.
  Tests targeting only another platform are skipped automatically during the run
  and their `dataTypes` are excluded from the initial permission request.
- `run(harness)`: `harness.exec(command, args)` calls one of the harness
  commands (`isAvailable`, `requestAuthorization`, `isAuthorized`, `query`,
  `store`, `delete`) and returns a Promise. `args` should use plain epoch-ms
  numbers for `startDate`/`endDate` (not `Date` objects - they don't survive
  the JSON round-trip to the WebView); the harness converts them to real
  `Date` objects before calling the plugin, since iOS requires `Date`
  instances while Android accepts either.

Note: point-in-time data types (e.g. `vo2max`) still need `startDate`/
`endDate` both present (Android requires both even though it only uses
`startDate`), and should use a timestamp a few seconds in the past rather
than exactly `Date.now()` - Health Connect rejects record times "in the
future", and small clock skew between the host and emulator can trip that
check at an exact instant.

The file is picked up automatically by both `scripts/android/run-tests.js`
and `scripts/ios/run-tests.js`.

### Editing the plugin itself

If you edit files in `../cordova-plugin-health/` (e.g. fixing a bug found by
these tests), **`cordova build` will NOT automatically pick up the change**.
This project references the plugin via a local `file:../cordova-plugin-health`
dependency, and Cordova only copies a plugin's `www/` files into
`platforms/*/` at install time - editing the already-installed source in
place does not trigger a re-copy, even via `cordova prepare`. Force a refresh
with:

```
npx cordova plugin remove cordova-plugin-health
npx cordova plugin add ../cordova-plugin-health \
  --variable HEALTH_READ_PERMISSION="App needs to read data" \
  --variable HEALTH_WRITE_PERMISSION="App needs to write data" \
  --save
```

(This was discovered the hard way: an earlier fix to `www/ios/HealthKit.js`
appeared to work because a separate, unrelated fix elsewhere happened to
avoid triggering the buggy code path - the actual bytes in
`platforms/ios/www/...` were stale the whole time.)

## Known risks / things to verify

- Android: whether `adb shell pm grant` actually grants Health Connect
  permissions was verified to work directly on this setup - no UI-automation
  fallback needed in practice so far.
- iOS: `idb`-based permission granting is verified working end-to-end
  (installed, connected, and tapped through a real HealthKit consent sheet
  automatically for a new data type). The tap coordinates are fractions of
  the screen size tuned to this specific sheet's layout on iPhone 17 Pro -
  if the sheet layout differs (more data types, different device, iOS
  version), the fractions in `scripts/ios/grant-permissions.js` may need
  adjusting.
- HealthKit permissions persist across runs on the same dedicated simulator
  (`cordova_health_test`) - only genuinely new data types trigger a fresh
  consent sheet on subsequent runs.
- iOS: a real plugin bug was found and fixed via this automation -
  `cordova-plugin-health/www/ios/HealthKit.js`'s internal validation helper
  fell through to native `cordova.exec` even after calling `onError`, which
  combined with a native ms/seconds mismatch could crash the app.
- **Android: `queryAggregated()` (no bucket, and bucketed) currently returns
  `value: 0` for `steps`, even though the underlying records genuinely exist**
  (confirmed via plain `query()` returning them correctly). Reproduced
  consistently, with no timing/consistency delay (tested up to 26s after
  write) and independent of `DataOrigin` filtering (explicitly setting the
  app's own package as origin did not fix it either). The identical test
  passes cleanly on iOS, confirming this is Android/Health Connect-specific,
  not a bug in the test itself. `scripts/shared/tests/steps-aggregated.test.js`
  is left in the suite failing on Android as an accurate signal of this real
  bug rather than muted - needs further investigation in
  `cordova-plugin-health/src/android/HealthPlugin.java`'s `queryAggregated()`
  / `StepsFunctions.populateFromAggregatedQuery()`, possibly related to the
  alpha-quality `androidx.health.connect:connect-client:1.2.0-alpha06`
  dependency or this specific emulator system image (Health Connect
  controller `versionName=15`).
- Diagnostics on failure are written to `scripts/android/diagnostics/` or
  `scripts/ios/diagnostics/` respectively.


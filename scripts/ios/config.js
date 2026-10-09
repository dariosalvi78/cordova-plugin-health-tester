// Shared constants for the iOS Simulator E2E test automation scripts.
module.exports = {
    bundleId: 'test.cordovatester',
    // Dedicated simulator managed by these scripts (kept separate from any
    // simulator you use manually, so we're free to boot/erase/shutdown it).
    deviceName: 'cordova_health_test',
    deviceType: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
    runtimeId: 'com.apple.CoreSimulator.SimRuntime.iOS-26-1',
    // Matches config.xml's <name>Hello Cordova</name>.
    appPath: 'platforms/ios/build/Debug-iphonesimulator/Hello Cordova.app',
};

// Shared constants for the Android E2E test automation scripts.
module.exports = {
    appId: 'test.cordovatester',
    mainActivity: 'test.cordovatester.MainActivity',
    avdName: 'cordova_health_test_api36',
    // Health Connect is built into the OS from API 34+, so a plain google_apis
    // image (no Play Store) is enough and keeps setup simple/fast.
    systemImage: 'system-images;android-36;google_apis;arm64-v8a',
    platformPackage: 'platforms;android-36',
    device: 'pixel_6',
    // Health Connect requires the device to have a screen lock configured.
    lockPin: '1234',
    apkPath: 'platforms/android/app/build/outputs/apk/debug/app-debug.apk',
};

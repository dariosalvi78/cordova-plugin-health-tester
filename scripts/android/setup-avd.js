#!/usr/bin/env node
// Ensures the required SDK packages are installed and the test AVD exists.
const { paths, run } = require('./util');
const { avdName, systemImage, platformPackage, device } = require('./config');

function avdExists() {
    const result = run(paths.avdmanager, ['list', 'avd'], { allowFailure: true });
    return (result.stdout || '').includes(`Name: ${avdName}`);
}

function installPackages() {
    console.log(`Ensuring SDK packages are installed: ${systemImage}, ${platformPackage}`);
    // auto-accept any license prompts sdkmanager may print
    run(paths.sdkmanager, ['--install', systemImage, platformPackage], { input: 'y\n'.repeat(20) });
}

function createAvd() {
    console.log(`Creating AVD "${avdName}"...`);
    run(
        paths.avdmanager,
        ['create', 'avd', '--name', avdName, '--package', systemImage, '--device', device, '--force'],
        { input: 'no\n' } // decline "create custom hardware profile" prompt
    );
}

function main() {
    installPackages();
    if (avdExists()) {
        console.log(`AVD "${avdName}" already exists, skipping creation.`);
        return;
    }
    createAvd();
    console.log('AVD setup complete.');
}

if (require.main === module) main();

module.exports = { avdExists, installPackages, createAvd };

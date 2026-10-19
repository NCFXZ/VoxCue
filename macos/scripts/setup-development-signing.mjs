import { initializeDevelopmentSigning } from './development-signing.mjs';

const signing = await initializeDevelopmentSigning();
console.log('Fixed local development signing identity ready (SHA-256): ' + signing.sha256);
console.log('Keep macos/.tools/development-signing private and preserve it across rebuilds.');

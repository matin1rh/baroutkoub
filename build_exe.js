import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

console.log('================================================================');
console.log('   Baroutkoub Reconciliation - Windows EXE Builder (Node Script) ');
console.log('================================================================\n');

try {
  console.log('[Step 1/3] Installing Electron & Electron-Builder...');
  execSync('npm install --save-dev electron electron-builder', { stdio: 'inherit' });

  console.log('\n[Step 2/3] Building production client bundle...');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('\n[Step 3/3] Packaging standalone Windows EXE & Portable files...');
  execSync('npx electron-builder --win', { stdio: 'inherit' });

  console.log('\n================================================================');
  console.log(' SUCCESS! Windows application built successfully.');
  console.log(' Output folder: dist_electron/');
  console.log('================================================================\n');
} catch (error) {
  console.error('\n[Error occurred during build process]:', error.message || error);
  process.exit(1);
}

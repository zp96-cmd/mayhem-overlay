// Starts the mock live-client server AND the overlay in mock mode (for testing).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-liveclient.mjs')], {
  stdio: 'inherit',
});
const electronBin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const app = spawn(electronBin, ['.'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, MAYHEM_MOCK: '1' },
});
app.on('exit', () => { mock.kill(); process.exit(0); });

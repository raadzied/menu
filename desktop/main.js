const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let server;
const port = process.env.PORT || 3000;
const logFile = path.join(os.tmpdir(), 'menuone-desktop.log');

function log(message) {
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`); } catch (_) {}
}

function serverPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'server', 'MenuOne-mesakhen.exe');
  return path.join(__dirname, '..', 'dist', 'MenuOne-mesakhen.exe');
}

function startServer() {
  const exe = serverPath();
  log(`server path=${exe} exists=${fs.existsSync(exe)}`);
  if (!fs.existsSync(exe)) throw new Error(`لم يتم العثور على خادم المطعم: ${exe}`);
  server = spawn(exe, ['--no-browser'], { windowsHide: true, cwd: path.dirname(exe), stdio: 'pipe' });
  log(`server spawned pid=${server.pid}`);
  server.stdout.on('data', (data) => log(`server stdout: ${data.toString().trim()}`));
  server.stderr.on('data', (data) => log(`server stderr: ${data.toString().trim()}`));
  server.on('exit', (code, signal) => log(`server exit code=${code} signal=${signal}`));
  server.on('error', (err) => { log(`server spawn error: ${err.stack || err.message}`); dialog.showErrorBox('تعذر تشغيل الخادم', err.message); });
}

async function waitForServer() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { await fetch(`http://127.0.0.1:${port}/api/menu/public`); return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('انتهت مهلة تشغيل خادم المطعم');
}

async function createWindow() {
  log('creating application window');
  startServer();
  await waitForServer();
  log('server responded; loading login page');
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 650,
    title: 'منيو ون - مسخن',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  win.on('closed', () => { if (server && !server.killed) server.kill(); });
  await win.loadURL(`http://127.0.0.1:${port}/admin/login.html`);
}

app.whenReady().then(() => { log('electron ready'); return createWindow(); }).catch((err) => { log(`startup error: ${err.stack || err.message}`); dialog.showErrorBox('منيو ون', err.message); });
app.on('window-all-closed', () => { if (server && !server.killed) server.kill(); app.quit(); });

const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  let pingParam = 'http://127.0.0.1:8787/ready';
  const rawUrl = process.env.MATERIALS_SPIKE_URL || process.argv[2];
  if (rawUrl) {
    if (rawUrl.includes('ping=')) {
      const searchPart = rawUrl.includes('?') ? rawUrl.split('?')[1] : rawUrl;
      const sp = new URLSearchParams(searchPart);
      if (sp.has('ping')) {
        pingParam = sp.get('ping');
      }
    } else if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      pingParam = rawUrl;
    }
  }

  const spikePath = path.resolve(__dirname, '../../dist/spike.html');
  win.loadFile(spikePath, {
    query: { ping: pingParam },
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

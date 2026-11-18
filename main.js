'use strict';
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// 포터블 exe 로 실행하면 설정·프리셋을 exe 옆 폴더에 저장해요 (PC 에 흔적을 남기지 않음)
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'OracleSqlFormatter-data'));
}
// Windows 작업표시줄에서 이 앱의 아이콘 · 이름으로 묶이게 해요 (package.json 의 build.appId 와 같아야 해요)
app.setAppUserModelId('local.oracle.sqlformatter');

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: '#0B0F14',
    title: 'Oracle SQL 포매터',
    icon: path.join(__dirname, 'src', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  // 바깥 주소로 나가거나 새 창이 뜨지 않게 막아요
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // 점검용: F12 로 개발자 도구
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());

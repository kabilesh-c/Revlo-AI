const { app, ipcMain } = require('electron'); ipcMain.handle('ping', () => 'pong');

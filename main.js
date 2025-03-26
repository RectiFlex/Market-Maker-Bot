const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const store = new Store();
const ethers = require('ethers');

// Check if .env exists, create from sample if not
if (!fs.existsSync(path.join(__dirname, '.env')) && fs.existsSync(path.join(__dirname, '.env-sample'))) {
  fs.copyFileSync(path.join(__dirname, '.env-sample'), path.join(__dirname, '.env'));
}

// Require bot functionality (without running it automatically)
const botModule = require('./bot');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile('index.html');
  
  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();
  
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers for bot interactions
ipcMain.handle('save-settings', async (event, settings) => {
  store.set('botSettings', settings);
  return { success: true };
});

ipcMain.handle('load-settings', async () => {
  return store.get('botSettings', {
    provider: 'goerli',
    tokenAddress: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984',
    buyAmount: '0.001',
    targetPrice: '',
    tradeFrequency: '3600',
    slippageTolerance: '50',
    twapEnabled: false,
    twapIntervals: 4,
    twapSpread: 3600,
    pairAddress: '0xF95df7A4766532A7273C6bB512F2C25429f19925'
  });
});

ipcMain.handle('start-bot', async (event, settings, options = {}) => {
  try {
    await botModule.startBot(settings, options);
    return { success: true, message: 'Bot started successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('stop-bot', async () => {
  try {
    botModule.stopBot();
    return { success: true, message: 'Bot stopped successfully' };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-bot-status', () => {
  return {
    isRunning: botModule.isRunning(),
    trades: botModule.getTrades(),
    lastCheck: botModule.getLastCheck()
  };
});

ipcMain.handle('get-token-balance', async (event, settings) => {
  try {
    const balance = await botModule.getTokenBalance(settings);
    return { success: true, balance };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-eth-balance', async (event, settings) => {
  try {
    const balance = await botModule.getEthBalance(settings);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    return { 
      success: true, 
      balance,
      walletAddress: wallet.address
    };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-price', async (event, settings) => {
  try {
    const price = await botModule.getCurrentPrice(settings);
    return { success: true, price };
  } catch (error) {
    return { success: false, message: error.message };
  }
});

ipcMain.handle('get-block-info', async (event, settings) => {
  try {
    const blockInfo = await botModule.getBlockInfo(settings);
    return {
      success: true,
      blockNumber: blockInfo.blockNumber,
      timestamp: blockInfo.timestamp,
      explorerUrl: blockInfo.explorerUrl
    };
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
});

ipcMain.handle('test-connection', async (event, settings) => {
  try {
    const result = await botModule.testConnection(settings);
    return result;
  } catch (error) {
    return { 
      success: false, 
      error: error.message 
    };
  }
});

ipcMain.handle('get-explorer-url', (event, settings) => {
  return botModule.getExplorerUrl(settings);
}); 
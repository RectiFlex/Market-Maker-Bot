const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  startBot: (settings, options) => ipcRenderer.invoke('start-bot', settings, options),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  getTokenBalance: (settings) => ipcRenderer.invoke('get-token-balance', settings),
  getEthBalance: (settings) => ipcRenderer.invoke('get-eth-balance', settings),
  getPrice: (settings) => ipcRenderer.invoke('get-price', settings),
  getBlockInfo: (settings) => ipcRenderer.invoke('get-block-info', settings),
  testConnection: (settings) => ipcRenderer.invoke('test-connection', settings),
  getExplorerUrl: (settings) => ipcRenderer.invoke('get-explorer-url', settings)
}); 
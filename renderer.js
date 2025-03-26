// DOM elements
const toggleBotBtn = document.getElementById('toggleBotBtn');
const refreshBalanceBtn = document.getElementById('refreshBalanceBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsForm = document.getElementById('settingsForm');
const walletAddressEl = document.getElementById('wallet-address');
const walletAddressFullEl = document.getElementById('wallet-address-full');
const ethBalanceEl = document.getElementById('eth-balance');
const ethUsdValueEl = document.getElementById('eth-usd-value');
const tokenBalanceEl = document.getElementById('token-balance');
const tokenUsdValueEl = document.getElementById('token-usd-value');
const currentPriceEl = document.getElementById('current-price');
const priceChangeEl = document.getElementById('price-change');
const botStatusEl = document.getElementById('bot-status');
const botStatusBadgeEl = document.getElementById('bot-status-badge');
const recentTradesEl = document.getElementById('recent-trades');
const tradeHistoryEl = document.getElementById('trade-history');
const logContainerEl = document.getElementById('logContainer');
const darkModeSwitch = document.getElementById('darkModeSwitch');
const twapEnabledEl = document.getElementById('twapEnabled');
const twapSettingsContainerEl = document.getElementById('twapSettingsContainer');
const tokenAddressField = document.getElementById('tokenAddress');
const pairAddressField = document.getElementById('pairAddress');
const providerSelect = document.getElementById('providerSelect');
const currentNetworkEl = document.getElementById('current-network');
const currentBlockEl = document.getElementById('current-block');
const lastUpdateEl = document.getElementById('last-update');
const dexscreenerIframe = document.getElementById('dexscreener-iframe');

// Chart data
let priceChart = null;
let priceData = {
  labels: [],
  prices: []
};

// App state
let isRunning = false;
let settings = {};
let lastPrice = 0;
let statusInterval = null;
let blockCheckInterval = null;
let ethPrice = 0; // ETH/USD price
let tokenInfo = {
  symbol: 'UNKNOWN',
  name: 'Unknown Token',
  decimals: 18,
  pairAddress: '0xF95df7A4766532A7273C6bB512F2C25429f19925' // Default pair address
};

// Initialize the app
async function initialize() {
  addLogEntry('Initializing app...', 'info');
  
  // Get ETH/USD price
  await fetchEthPrice();
  
  // Load settings
  await loadSettings();
  
  // Setup event listeners
  setupEventListeners();
  
  // Update UI
  await updateBlockInfo();
  await updateBalances();
  
  // Start status check interval
  startStatusCheck();
  
  // Start block check interval
  startBlockCheck();
  
  // Get wallet address from private key
  await updateWalletInfo();
  
  addLogEntry('App initialized successfully', 'success');
}

// Fetch current ETH price in USD
async function fetchEthPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    const data = await response.json();
    ethPrice = data.ethereum.usd;
    console.log(`Current ETH price: $${ethPrice}`);
  } catch (error) {
    console.error('Error fetching ETH price:', error);
    ethPrice = 0;
  }
}

// Update wallet information
async function updateWalletInfo() {
  try {
    const ethResult = await window.api.getEthBalance(settings);
    if (ethResult.success && ethResult.walletAddress) {
      const address = ethResult.walletAddress;
      walletAddressEl.textContent = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
      walletAddressFullEl.textContent = address;
      
      // Create etherscan link
      const explorerUrl = await window.api.getExplorerUrl(settings);
      walletAddressFullEl.innerHTML = `<a href="${explorerUrl}/address/${address}" target="_blank">${address}</a>`;
    } else {
      walletAddressEl.textContent = 'Wallet not loaded';
      walletAddressFullEl.textContent = 'Wallet not loaded';
    }
  } catch (error) {
    console.error('Error updating wallet info:', error);
    walletAddressEl.textContent = 'Wallet not loaded';
    walletAddressFullEl.textContent = 'Error loading wallet';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Toggle bot button
  toggleBotBtn.addEventListener('click', async () => {
    if (isRunning) {
      await stopBot();
    } else {
      await startBot();
    }
  });
  
  // Refresh balance button
  refreshBalanceBtn.addEventListener('click', async () => {
    refreshBalanceBtn.disabled = true;
    refreshBalanceBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Refreshing...';
    
    await fetchEthPrice();
    await updateBlockInfo();
    await updateBalances();
    await updateWalletInfo();
    
    refreshBalanceBtn.disabled = false;
    refreshBalanceBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Refresh';
  });
  
  // Save settings button
  saveSettingsBtn.addEventListener('click', async () => {
    await saveSettings();
  });
  
  // Dark mode toggle
  darkModeSwitch.addEventListener('change', () => {
    const isDarkMode = darkModeSwitch.checked;
    document.body.classList.toggle('dark-mode', isDarkMode);
    updateDexScreenerTheme(isDarkMode);
  });
  
  // TWAP toggle
  twapEnabledEl.addEventListener('change', () => {
    twapSettingsContainerEl.style.display = twapEnabledEl.checked ? 'block' : 'none';
  });
  
  // Token address field
  tokenAddressField.addEventListener('blur', async () => {
    if (tokenAddressField.value && tokenAddressField.value !== settings.tokenAddress) {
      await validateTokenPair();
    }
  });
  
  // Pair address field
  pairAddressField.addEventListener('change', () => {
    updateDexScreenerPair();
  });
  
  // Network select
  providerSelect.addEventListener('change', () => {
    currentNetworkEl.textContent = providerSelect.value === 'mainnet' ? 'Ethereum Mainnet' : 'Goerli Testnet';
    updateDexScreenerNetwork();
  });
}

// Update the DexScreener chart theme based on dark mode
function updateDexScreenerTheme(isDarkMode) {
  const iframe = dexscreenerIframe;
  if (!iframe) return;
  
  const network = settings.provider === 'mainnet' ? 'ethereum' : 'ethereum';
  const pair = settings.pairAddress || tokenInfo.pairAddress;
  const theme = isDarkMode ? 'dark' : 'light';
  
  iframe.src = `https://dexscreener.com/${network}/${pair}?embed=1&loadChartSettings=0&chartTheme=${theme}&theme=${theme}&chartStyle=0&chartType=usd&interval=15`;
}

// Update the DexScreener chart with the current pair address
function updateDexScreenerPair() {
  const iframe = dexscreenerIframe;
  if (!iframe) return;
  
  const network = settings.provider === 'mainnet' ? 'ethereum' : 'ethereum';
  const pairAddress = pairAddressField.value || tokenInfo.pairAddress;
  const theme = darkModeSwitch.checked ? 'dark' : 'light';
  
  iframe.src = `https://dexscreener.com/${network}/${pairAddress}?embed=1&loadChartSettings=0&chartTheme=${theme}&theme=${theme}&chartStyle=0&chartType=usd&interval=15`;
  
  // Save this for later use
  if (pairAddress && pairAddress !== tokenInfo.pairAddress) {
    tokenInfo.pairAddress = pairAddress;
  }
}

// Update the DexScreener chart network
function updateDexScreenerNetwork() {
  const iframe = dexscreenerIframe;
  if (!iframe) return;
  
  const network = settings.provider === 'mainnet' ? 'ethereum' : 'ethereum';
  const pairAddress = settings.pairAddress || tokenInfo.pairAddress;
  const theme = darkModeSwitch.checked ? 'dark' : 'light';
  
  iframe.src = `https://dexscreener.com/${network}/${pairAddress}?embed=1&loadChartSettings=0&chartTheme=${theme}&theme=${theme}&chartStyle=0&chartType=usd&interval=15`;
}

// Validate token pair when address changes
async function validateTokenPair() {
  const address = tokenAddressField.value;
  if (!address) return;
  
  // Show loading indicator
  const tokenStatusEl = document.querySelector('.token-status');
  tokenStatusEl.classList.add('loading');
  
  addLogEntry(`Validating token at ${address}...`, 'info');
  
  try {
    const tempSettings = { ...settings, tokenAddress: address, provider: providerSelect.value };
    const testResult = await window.api.testConnection(tempSettings);
    
    if (testResult.success) {
      tokenInfo = {
        ...tokenInfo,
        ...testResult.tokenInfo
      };
      
      // Try to get pair address if not already set
      if (testResult.pairAddress) {
        tokenInfo.pairAddress = testResult.pairAddress;
        pairAddressField.value = testResult.pairAddress;
        updateDexScreenerPair();
      }
      
      // Update UI with token info
      document.querySelectorAll('.token-symbol').forEach(el => {
        el.textContent = tokenInfo.symbol;
      });
      
      addLogEntry(`Token validated: ${tokenInfo.name} (${tokenInfo.symbol})`, 'success');
      updatePrice(tokenInfo.currentRate);
    } else {
      addLogEntry(`Token validation failed: ${testResult.error}`, 'error');
    }
  } catch (error) {
    addLogEntry(`Error validating token: ${error.message}`, 'error');
  } finally {
    // Hide loading indicator
    tokenStatusEl.classList.remove('loading');
  }
}

// Load settings from main process
async function loadSettings() {
  try {
    settings = await window.api.loadSettings();
    
    // Update form with settings
    for (const [key, value] of Object.entries(settings)) {
      const element = document.getElementById(key);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value;
        } else {
          element.value = value;
        }
      }
    }
    
    // Update network display
    currentNetworkEl.textContent = settings.provider === 'mainnet' ? 'Ethereum Mainnet' : 'Goerli Testnet';
    
    // Update TWAP settings visibility
    twapSettingsContainerEl.style.display = settings.twapEnabled ? 'block' : 'none';
    
    // Set DexScreener pair address if available
    if (settings.pairAddress) {
      pairAddressField.value = settings.pairAddress;
      tokenInfo.pairAddress = settings.pairAddress;
      updateDexScreenerPair();
    }
    
    // Validate token pair if address is set
    if (settings.tokenAddress) {
      await validateTokenPair();
    }
    
    addLogEntry('Settings loaded successfully', 'success');
  } catch (error) {
    addLogEntry(`Error loading settings: ${error.message}`, 'error');
  }
}

// Save settings to main process
async function saveSettings() {
  try {
    saveSettingsBtn.disabled = true;
    saveSettingsBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
    
    // Collect form data
    const formData = new FormData(settingsForm);
    const newSettings = Object.fromEntries(formData.entries());
    
    // Convert checkbox values
    newSettings.twapEnabled = twapEnabledEl.checked;
    
    // Convert string values to appropriate types
    newSettings.twapIntervals = parseInt(newSettings.twapIntervals) || 4;
    newSettings.twapSpread = parseInt(newSettings.twapSpread) || 3600;
    
    // Save pair address if provided
    if (pairAddressField.value) {
      newSettings.pairAddress = pairAddressField.value;
      tokenInfo.pairAddress = pairAddressField.value;
    }
    
    // Validate token pair if changed
    if (newSettings.tokenAddress !== settings.tokenAddress || 
        newSettings.provider !== settings.provider) {
      addLogEntry('Token or network changed, validating...', 'info');
      
      try {
        const testResult = await window.api.testConnection(newSettings);
        if (!testResult.success) {
          addLogEntry(`Token validation failed: ${testResult.error}`, 'error');
          saveSettingsBtn.disabled = false;
          saveSettingsBtn.innerHTML = 'Save Settings';
          return;
        }
        tokenInfo = {
          ...tokenInfo,
          ...testResult.tokenInfo
        };
        
        // Try to get pair address if not already set
        if (testResult.pairAddress && !newSettings.pairAddress) {
          newSettings.pairAddress = testResult.pairAddress;
          pairAddressField.value = testResult.pairAddress;
          tokenInfo.pairAddress = testResult.pairAddress;
        }
        
        addLogEntry(`Token validated: ${tokenInfo.name} (${tokenInfo.symbol})`, 'success');
        
        // Update network display
        currentNetworkEl.textContent = newSettings.provider === 'mainnet' ? 'Ethereum Mainnet' : 'Goerli Testnet';
        
        // Update DexScreener to use the right network
        updateDexScreenerNetwork();
      } catch (error) {
        addLogEntry(`Error validating token: ${error.message}`, 'error');
        saveSettingsBtn.disabled = false;
        saveSettingsBtn.innerHTML = 'Save Settings';
        return;
      }
    }
    
    // Save settings
    await window.api.saveSettings(newSettings);
    settings = newSettings;
    
    // Update UI
    await updateBlockInfo();
    await updateBalances();
    
    addLogEntry('Settings saved successfully', 'success');
    updateLastUpdateTime();
  } catch (error) {
    addLogEntry(`Error saving settings: ${error.message}`, 'error');
  } finally {
    saveSettingsBtn.disabled = false;
    saveSettingsBtn.innerHTML = 'Save Settings';
  }
}

// Start the bot
async function startBot() {
  try {
    // Disable the button while starting
    toggleBotBtn.disabled = true;
    toggleBotBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Starting...';
    
    addLogEntry('Starting bot and preparing to buy tokens immediately...', 'info');
    
    // Test token pair first
    const testResult = await window.api.testConnection(settings);
    if (!testResult.success) {
      addLogEntry(`Failed to start bot: ${testResult.error}`, 'error');
      toggleBotBtn.disabled = false;
      toggleBotBtn.innerHTML = '<i class="bi bi-play-fill"></i> Buy Now / Start Bot';
      return;
    }
    
    const result = await window.api.startBot(settings);
    
    toggleBotBtn.disabled = false;
    
    if (result.success) {
      isRunning = true;
      updateBotStatus(true);
      addLogEntry('Bot started successfully - buying tokens now', 'success');
      updateLastUpdateTime();
    } else {
      addLogEntry(`Failed to start bot: ${result.message}`, 'error');
      toggleBotBtn.innerHTML = '<i class="bi bi-play-fill"></i> Buy Now / Start Bot';
    }
  } catch (error) {
    toggleBotBtn.disabled = false;
    toggleBotBtn.innerHTML = '<i class="bi bi-play-fill"></i> Buy Now / Start Bot';
    addLogEntry(`Error starting bot: ${error.message}`, 'error');
  }
}

// Stop the bot
async function stopBot() {
  try {
    // Disable the button while stopping
    toggleBotBtn.disabled = true;
    toggleBotBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Stopping...';
    
    addLogEntry('Stopping bot...', 'info');
    const result = await window.api.stopBot();
    
    toggleBotBtn.disabled = false;
    
    if (result.success) {
      isRunning = false;
      updateBotStatus(false);
      addLogEntry('Bot stopped successfully', 'success');
      updateLastUpdateTime();
    } else {
      addLogEntry(`Failed to stop bot: ${result.message}`, 'error');
      toggleBotBtn.innerHTML = '<i class="bi bi-stop-fill"></i> Stop Bot';
    }
  } catch (error) {
    toggleBotBtn.disabled = false;
    toggleBotBtn.innerHTML = '<i class="bi bi-stop-fill"></i> Stop Bot';
    addLogEntry(`Error stopping bot: ${error.message}`, 'error');
  }
}

// Update bot status UI
function updateBotStatus(running) {
  isRunning = running;
  
  if (running) {
    toggleBotBtn.innerHTML = '<i class="bi bi-stop-fill"></i> Stop Bot';
    toggleBotBtn.classList.remove('btn-outline-success');
    toggleBotBtn.classList.add('btn-outline-danger');
    botStatusEl.textContent = 'Running';
    botStatusBadgeEl.textContent = 'Active';
    botStatusBadgeEl.classList.remove('bg-danger');
    botStatusBadgeEl.classList.add('bg-success');
  } else {
    toggleBotBtn.innerHTML = '<i class="bi bi-play-fill"></i> Buy Now / Start Bot';
    toggleBotBtn.classList.remove('btn-outline-danger');
    toggleBotBtn.classList.add('btn-outline-success');
    botStatusEl.textContent = 'Stopped';
    botStatusBadgeEl.textContent = 'Inactive';
    botStatusBadgeEl.classList.remove('bg-success');
    botStatusBadgeEl.classList.add('bg-danger');
  }
}

// Update latest block information
async function updateBlockInfo() {
  try {
    const blockInfo = await window.api.getBlockInfo(settings);
    if (blockInfo.success) {
      currentBlockEl.textContent = blockInfo.blockNumber.toLocaleString();
      currentBlockEl.innerHTML = `<a href="${blockInfo.explorerUrl}/block/${blockInfo.blockNumber}" target="_blank">${blockInfo.blockNumber.toLocaleString()}</a>`;
    }
  } catch (error) {
    console.error('Error updating block info:', error);
    currentBlockEl.textContent = 'Error';
  }
}

// Start block check interval
function startBlockCheck() {
  blockCheckInterval = setInterval(async () => {
    await updateBlockInfo();
  }, 15000); // Check every 15 seconds
}

// Update last update time
function updateLastUpdateTime() {
  lastUpdateEl.textContent = new Date().toLocaleTimeString();
}

// Update balances
async function updateBalances() {
  try {
    addLogEntry('Updating balances...', 'info');
    
    // Get ETH balance
    const ethResult = await window.api.getEthBalance(settings);
    if (ethResult.success) {
      const ethBalance = parseFloat(ethResult.balance);
      ethBalanceEl.textContent = ethBalance.toFixed(4);
      
      // Calculate USD value
      if (ethPrice > 0) {
        const usdValue = ethBalance * ethPrice;
        ethUsdValueEl.textContent = `≈ $${usdValue.toFixed(2)} USD`;
      }
    }
    
    // Get token balance
    const tokenResult = await window.api.getTokenBalance(settings);
    if (tokenResult.success) {
      const tokenBalance = parseFloat(tokenResult.balance);
      tokenBalanceEl.textContent = tokenBalance.toFixed(4);
      
      // Update token name if available
      if (tokenResult.tokenSymbol) {
        tokenInfo.symbol = tokenResult.tokenSymbol;
        document.querySelectorAll('.token-symbol').forEach(el => {
          el.textContent = tokenInfo.symbol;
        });
      }
      
      // Calculate USD value if we have both a token price and ETH price
      if (lastPrice > 0 && ethPrice > 0) {
        // tokenPrice is in tokens per ETH, so we need to convert
        const tokenPriceInEth = 1 / lastPrice; // ETH per token
        const tokenPriceInUsd = tokenPriceInEth * ethPrice;
        const usdValue = tokenBalance * tokenPriceInUsd;
        tokenUsdValueEl.textContent = `≈ $${usdValue.toFixed(2)} USD`;
      }
    }
    
    // Get current price
    const priceResult = await window.api.getPrice(settings);
    if (priceResult.success && priceResult.price && priceResult.price.rate > 0) {
      const price = priceResult.price.rate;
      if (priceResult.price.tokenSymbol) {
        tokenInfo.symbol = priceResult.price.tokenSymbol;
        document.querySelectorAll('.token-symbol').forEach(el => {
          el.textContent = tokenInfo.symbol;
        });
      }
      updatePrice(price);
    } else if (priceResult.price && priceResult.price.error) {
      addLogEntry(`Price check error: ${priceResult.price.error}`, 'error');
    }
    
    updateLastUpdateTime();
    addLogEntry('Balances updated successfully', 'success');
  } catch (error) {
    addLogEntry(`Error updating balances: ${error.message}`, 'error');
  }
}

// Update price display
function updatePrice(price) {
  if (!price || price <= 0) return;
  
  currentPriceEl.textContent = price.toFixed(4);
  
  // Update token label if available
  if (tokenInfo.symbol) {
    document.querySelectorAll('.token-symbol').forEach(el => {
      el.textContent = tokenInfo.symbol;
    });
  }
  
  // Calculate price change
  if (lastPrice > 0) {
    const change = ((price - lastPrice) / lastPrice) * 100;
    priceChangeEl.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
    priceChangeEl.classList.remove('bg-success', 'bg-danger');
    priceChangeEl.classList.add(change >= 0 ? 'bg-success' : 'bg-danger');
  }
  
  // Update last price
  lastPrice = price;
  
  // Add to chart data
  const now = new Date();
  priceData.labels.push(now.toLocaleTimeString());
  priceData.prices.push(price);
  
  // Limit data to 30 points
  if (priceData.labels.length > 30) {
    priceData.labels.shift();
    priceData.prices.shift();
  }
  
  // Update chart
  updatePriceChart();
}

// Initialize price chart
function initPriceChart() {
  const ctx = document.getElementById('priceChart').getContext('2d');
  const isDarkMode = darkModeSwitch.checked;
  
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: `Token Price (tokens per ETH)`,
        data: [],
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13, 110, 253, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: isDarkMode ? '#eee' : '#333'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        x: {
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            color: isDarkMode ? '#eee' : '#333'
          }
        },
        y: {
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            color: isDarkMode ? '#eee' : '#333'
          }
        }
      }
    }
  });
}

// Update price chart with new data
function updatePriceChart() {
  if (priceChart) {
    // Update chart label with token symbol
    priceChart.data.datasets[0].label = `${tokenInfo.symbol} Price (tokens per ETH)`;
    
    priceChart.data.labels = priceData.labels;
    priceChart.data.datasets[0].data = priceData.prices;
    priceChart.update();
  }
}

// Start status check interval
function startStatusCheck() {
  statusInterval = setInterval(async () => {
    try {
      const status = await window.api.getBotStatus();
      
      // Update running status
      updateBotStatus(status.isRunning);
      
      // Update trades
      updateTrades(status.trades);
      
      // Update price if available
      if (status.lastCheck && status.lastCheck.rate > 0) {
        if (status.lastCheck.tokenSymbol) {
          tokenInfo.symbol = status.lastCheck.tokenSymbol;
        }
        updatePrice(status.lastCheck.rate);
      }
    } catch (error) {
      console.error('Error in status check:', error);
    }
  }, 3000);
}

// Update trades display
function updateTrades(trades) {
  if (!trades || !trades.length) return;
  
  // Clear existing trades
  recentTradesEl.innerHTML = '';
  tradeHistoryEl.innerHTML = '';
  
  // Sort trades by timestamp (newest first)
  const sortedTrades = [...trades].sort((a, b) => b.timestamp - a.timestamp);
  
  // Display recent trades (up to 5)
  const recentTradesList = sortedTrades.slice(0, 5);
  recentTradesList.forEach(trade => {
    const tr = document.createElement('tr');
    
    // Type (buy/sell)
    const typeCell = document.createElement('td');
    typeCell.innerHTML = `<span class="badge ${trade.type === 'buy' ? 'bg-success' : 'bg-danger'}">${trade.type.toUpperCase()}</span>`;
    tr.appendChild(typeCell);
    
    // Amount
    const amountCell = document.createElement('td');
    amountCell.textContent = `${parseFloat(trade.type === 'buy' ? trade.amount : trade.tokenAmount).toFixed(4)}`;
    tr.appendChild(amountCell);
    
    // Price
    const priceCell = document.createElement('td');
    priceCell.textContent = `${parseFloat(trade.price).toFixed(4)}`;
    tr.appendChild(priceCell);
    
    // Time
    const timeCell = document.createElement('td');
    timeCell.textContent = new Date(trade.timestamp).toLocaleTimeString();
    tr.appendChild(timeCell);
    
    // Tx Hash
    const txCell = document.createElement('td');
    const explorerUrl = window.api.getExplorerUrl(settings);
    txCell.innerHTML = `<a href="${explorerUrl}/tx/${trade.txHash}" target="_blank">${trade.txHash.substring(0, 6)}...${trade.txHash.substring(trade.txHash.length - 4)}</a>`;
    tr.appendChild(txCell);
    
    recentTradesEl.appendChild(tr);
  });
  
  // Display full trade history
  sortedTrades.forEach(trade => {
    const tr = document.createElement('tr');
    tr.className = 'trade-row';
    
    // Type (buy/sell)
    const typeCell = document.createElement('td');
    typeCell.innerHTML = `<span class="badge ${trade.type === 'buy' ? 'bg-success' : 'bg-danger'}">${trade.type.toUpperCase()}</span>`;
    tr.appendChild(typeCell);
    
    // Date/Time
    const timeCell = document.createElement('td');
    timeCell.textContent = new Date(trade.timestamp).toLocaleString();
    tr.appendChild(timeCell);
    
    // ETH Amount
    const ethAmountCell = document.createElement('td');
    ethAmountCell.textContent = `${parseFloat(trade.amount).toFixed(6)} ETH`;
    tr.appendChild(ethAmountCell);
    
    // Token Amount
    const tokenAmountCell = document.createElement('td');
    tokenAmountCell.textContent = `${parseFloat(trade.tokenAmount).toFixed(6)} ${trade.tokenSymbol || tokenInfo.symbol}`;
    tr.appendChild(tokenAmountCell);
    
    // Price
    const priceCell = document.createElement('td');
    priceCell.textContent = `${parseFloat(trade.price).toFixed(6)}`;
    tr.appendChild(priceCell);
    
    // TWAP
    const twapCell = document.createElement('td');
    twapCell.innerHTML = trade.isTwap ? '<span class="badge bg-info">TWAP</span>' : '';
    tr.appendChild(twapCell);
    
    // Tx Hash
    const txCell = document.createElement('td');
    const explorerUrl = window.api.getExplorerUrl(settings);
    txCell.innerHTML = `<a href="${explorerUrl}/tx/${trade.txHash}" target="_blank">${trade.txHash.substring(0, 6)}...${trade.txHash.substring(trade.txHash.length - 4)}</a>`;
    tr.appendChild(txCell);
    
    tradeHistoryEl.appendChild(tr);
  });
}

// Add log entry
function addLogEntry(message, type = 'info') {
  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';
  
  const timestamp = new Date().toLocaleTimeString();
  const logType = type.toUpperCase();
  
  logEntry.innerHTML = `<span class="text-${type === 'error' ? 'danger' : 'secondary'}">[${timestamp}]</span> <span class="text-${type === 'error' ? 'danger' : type === 'success' ? 'success' : 'primary'}">[${logType}]</span> ${message}`;
  
  logContainerEl.appendChild(logEntry);
  logContainerEl.scrollTop = logContainerEl.scrollHeight;
  
  console.log(`[${timestamp}] [${logType}] ${message}`);
}

// Clean up when the window is closing
window.addEventListener('beforeunload', () => {
  if (statusInterval) clearInterval(statusInterval);
  if (blockCheckInterval) clearInterval(blockCheckInterval);
});

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initialize);
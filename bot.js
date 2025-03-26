const ethers = require('ethers');
require("dotenv").config();

// Track bot state
let isRunningBot = false;
let checkPriceInterval = null;
let twapIntervals = [];
let tradeHistory = [];
let lastPriceCheck = null;
let providerRetries = 0;
const MAX_PROVIDER_RETRIES = 5;

// Network configurations
const networkConfigs = {
  mainnet: {
    rpcUrl: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    routerAddressV2: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factoryAddressV2: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    explorerUrl: 'https://etherscan.io'
  },
  goerli: {
    rpcUrl: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
    wethAddress: '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6',
    routerAddressV2: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factoryAddressV2: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    explorerUrl: 'https://goerli.etherscan.io'
  }
};

// Helper to create provider with proper error handling
function createProvider(rpcUrl) {
  // Create provider without attaching event listeners (ethers v6 compatibility)
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  
  // In ethers v6, we don't use provider.on('error') as it's not supported
  // Instead we rely on proper try/catch blocks around provider calls
  
  return provider;
}

// Initialize contracts for a given network and wallet
async function initializeContracts(settings, wallet) {
  const networkConfig = networkConfigs[settings.provider] || networkConfigs.goerli;
  const provider = createProvider(networkConfig.rpcUrl);
  
  try {
    // Test connection first
    await provider.getNetwork();
    providerRetries = 0;
  } catch (error) {
    providerRetries++;
    if (providerRetries > MAX_PROVIDER_RETRIES) {
      throw new Error(`Failed to connect to network after ${MAX_PROVIDER_RETRIES} attempts. Please check your internet connection and API key.`);
    }
    console.error(`Provider connection error (attempt ${providerRetries}/${MAX_PROVIDER_RETRIES}): ${error.message}`);
    throw error;
  }
  
  const account = wallet.connect(provider);

  // Initialize token contract with a graceful error handler
  let token;
  try {
    token = new ethers.Contract(
      settings.tokenAddress,
      [
        'function approve(address spender, uint256 amount) external returns (bool)',
        'function allowance(address owner, address spender) public view returns (uint256)',
        'function balanceOf(address owner) external view returns (uint256)',
        'function decimals() external view returns (uint8)',
        'function symbol() external view returns (string)',
        'function name() external view returns (string)'
      ],
      account
    );
    
    // Test if we can access the token
    await token.symbol();
  } catch (error) {
    console.error(`Error initializing token contract: ${error.message}`);
    throw new Error(`Invalid token address or contract. ${error.message}`);
  }

  // Initialize Uniswap V2 Router contract
  const routerV2 = new ethers.Contract(
    networkConfig.routerAddressV2,
    [
      'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
      'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
      'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
    ],
    account
  );

  // Initialize Uniswap V2 Factory contract
  const factoryV2 = new ethers.Contract(
    networkConfig.factoryAddressV2,
    [
      'function getPair(address tokenA, address tokenB) external view returns (address pair)'
    ],
    account
  );

  return {
    provider,
    account,
    token,
    routerV2,
    factoryV2,
    wethAddress: networkConfig.wethAddress,
    explorerUrl: networkConfig.explorerUrl
  };
}

// Validate token pair exists
async function validateTokenPair(factoryV2, wethAddress, tokenAddress) {
  try {
    const pairAddress = await factoryV2.getPair(wethAddress, tokenAddress);
    
    // If pair address is zero address, the pair doesn't exist
    if (pairAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error(`No liquidity pair exists for this token on Uniswap V2`);
    }
    
    console.log(`Found valid trading pair at ${pairAddress}`);
    return {
      exists: true,
      pairAddress: pairAddress
    };
  } catch (error) {
    console.error(`Error validating token pair: ${error.message}`);
    throw error;
  }
}

// Buy tokens function with TWAP support
async function buyTokens(settings, contracts, currentPriceInfo, isTwap = false, twapAmount = null) {
  console.log('Buying Tokens via Uniswap V2' + (isTwap ? ' (TWAP)' : ''));
  const { account, token, routerV2, wethAddress } = contracts;
  
  try {
    const tokenDecimals = await token.decimals();
    const tokenSymbol = await token.symbol();
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    const buyAmount = isTwap ? twapAmount : ethers.parseUnits(settings.buyAmount, 'ether');
    
    console.log(`Buying ${tokenSymbol} with ${ethers.formatUnits(buyAmount, 'ether')} ETH`);
    
    // Get the expected amount out
    const path = [wethAddress, settings.tokenAddress];
    
    let amounts;
    try {
      amounts = await routerV2.getAmountsOut(buyAmount, path);
    } catch (error) {
      console.error(`Failed to get amounts out: ${error.message}`);
      throw new Error(`Failed to calculate trade amounts. This token may not be tradable on Uniswap V2 or has no liquidity.`);
    }
    
    const amountOutMin = amounts[1] - (amounts[1] * BigInt(settings.slippageTolerance) / BigInt(10000)); // Apply slippage tolerance
    
    console.log(`Expected tokens out: ${ethers.formatUnits(amounts[1], tokenDecimals)} ${tokenSymbol}`);
    console.log(`Minimum tokens out (with slippage): ${ethers.formatUnits(amountOutMin, tokenDecimals)} ${tokenSymbol}`);
    
    // Execute the swap
    const tx = await routerV2.swapExactETHForTokens(
      amountOutMin,
      path,
      account.address,
      deadline,
      { value: buyAmount }
    );
    
    const receipt = await tx.wait();
    console.log(`Transaction successful: ${tx.hash}`);
    
    // Log trade
    tradeHistory.push({
      type: 'buy',
      amount: ethers.formatUnits(buyAmount, 'ether'),
      tokenAmount: ethers.formatUnits(amounts[1], tokenDecimals),
      txHash: tx.hash,
      timestamp: Date.now(),
      price: currentPriceInfo.rate,
      tokenSymbol: tokenSymbol,
      isTwap
    });
    
    return {
      success: true,
      txHash: tx.hash,
      amountIn: ethers.formatUnits(buyAmount, 'ether'),
      amountOut: ethers.formatUnits(amounts[1], tokenDecimals)
    };
  } catch (error) {
    console.error(`Error buying tokens: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Sell tokens function with TWAP support
async function sellTokens(settings, contracts, currentPriceInfo, isTwap = false, twapAmount = null) {
  console.log('Selling Tokens via Uniswap V2' + (isTwap ? ' (TWAP)' : ''));
  const { account, token, routerV2, wethAddress } = contracts;
  
  try {
    const tokenDecimals = await token.decimals();
    const tokenSymbol = await token.symbol();
    
    // Calculate sell amount
    const targetPrice = BigInt(settings.targetPrice);
    const buyAmount = ethers.parseUnits(settings.buyAmount, 'ether');
    const sellAmount = isTwap ? twapAmount : (buyAmount / targetPrice);
    
    // Check token balance
    const balance = await token.balanceOf(account.address);
    console.log(`Current token balance: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
    
    if (balance < sellAmount) {
      console.log(`Not enough tokens to sell. Have ${ethers.formatUnits(balance, tokenDecimals)}, need ${ethers.formatUnits(sellAmount, tokenDecimals)}`);
      return {
        success: false,
        error: `Insufficient token balance. Have ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}, need ${ethers.formatUnits(sellAmount, tokenDecimals)} ${tokenSymbol}.`
      };
    }
    
    // Check and approve allowance
    const allowance = await token.allowance(account.address, routerV2.target);
    console.log(`Current allowance: ${ethers.formatUnits(allowance, tokenDecimals)} ${tokenSymbol}`);
    
    if (allowance < sellAmount) {
      console.log('Approving Spend');
      const approveTx = await token.approve(routerV2.target, ethers.MaxUint256); // Approve max to save on future gas
      await approveTx.wait();
      console.log(`Approval transaction: ${approveTx.hash}`);
    }
    
    // Get the expected amount out
    const path = [settings.tokenAddress, wethAddress];
    
    let amounts;
    try {
      amounts = await routerV2.getAmountsOut(sellAmount, path);
    } catch (error) {
      console.error(`Failed to get amounts out: ${error.message}`);
      throw new Error(`Failed to calculate trade amounts. This token may not be tradable on Uniswap V2 or has no liquidity.`);
    }
    
    const amountOutMin = amounts[1] - (amounts[1] * BigInt(settings.slippageTolerance) / BigInt(10000)); // Apply slippage tolerance
    
    console.log(`Expected ETH out: ${ethers.formatUnits(amounts[1], 'ether')} ETH`);
    console.log(`Minimum ETH out (with slippage): ${ethers.formatUnits(amountOutMin, 'ether')} ETH`);
    
    // Execute the swap
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    const tx = await routerV2.swapExactTokensForETH(
      sellAmount,
      amountOutMin,
      path,
      account.address,
      deadline
    );
    
    const receipt = await tx.wait();
    console.log(`Transaction successful: ${tx.hash}`);
    
    // Log trade
    tradeHistory.push({
      type: 'sell',
      amount: ethers.formatUnits(amounts[1], 'ether'),
      tokenAmount: ethers.formatUnits(sellAmount, tokenDecimals),
      txHash: tx.hash,
      timestamp: Date.now(),
      price: currentPriceInfo.rate,
      tokenSymbol: tokenSymbol,
      isTwap
    });
    
    return {
      success: true,
      txHash: tx.hash,
      amountIn: ethers.formatUnits(sellAmount, tokenDecimals),
      amountOut: ethers.formatUnits(amounts[1], 'ether')
    };
  } catch (error) {
    console.error(`Error selling tokens: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Check current price and take action
async function checkPrice(settings, contracts) {
  const { routerV2, wethAddress, token } = contracts;
  
  try {
    // Get token info
    let tokenDecimals;
    let tokenSymbol;
    
    try {
      tokenDecimals = await token.decimals();
      tokenSymbol = await token.symbol();
    } catch (error) {
      console.error(`Error getting token info: ${error.message}`);
      tokenDecimals = 18; // default to 18 decimals
      tokenSymbol = "UNKNOWN";
    }
    
    // Use V2 router to get price quote
    const buyAmount = ethers.parseUnits(settings.buyAmount, 'ether');
    
    let amountsOut;
    try {
      amountsOut = await routerV2.getAmountsOut(
        buyAmount,
        [wethAddress, settings.tokenAddress]
      );
    } catch (error) {
      console.error(`Failed to get price quote: ${error.message}`);
      
      // If this is a LP token, it's not tradable directly
      if (tokenSymbol.includes('LP') || tokenSymbol.includes('UNI-V2')) {
        throw new Error(`${tokenSymbol} appears to be a Liquidity Pool token, which cannot be traded directly. Please use a regular ERC20 token instead.`);
      }
      
      throw new Error(`Failed to get price for token ${tokenSymbol}. This token may not be tradable on Uniswap V2 or has no liquidity.`);
    }
    
    const amountOut = amountsOut[1];
    const targetPrice = BigInt(settings.targetPrice);
    const targetAmountOut = buyAmount * targetPrice;
    
    const currentRate = Number(ethers.formatUnits(amountOut, tokenDecimals)) / 
                       Number(ethers.formatUnits(buyAmount, 'ether'));
    
    console.log(`Current Exchange Rate: ${amountOut.toString()} ${tokenSymbol}`);
    console.log(`Target Exchange Rate: ${targetAmountOut.toString()} ${tokenSymbol}`);
    console.log(`Current Price: 1 ETH = ${currentRate} ${tokenSymbol}`);
    
    lastPriceCheck = {
      rate: currentRate,
      currentAmount: ethers.formatUnits(amountOut, tokenDecimals),
      targetAmount: ethers.formatUnits(targetAmountOut, tokenDecimals),
      timestamp: Date.now(),
      tokenSymbol: tokenSymbol
    };
    
    // Return price info without taking action
    return {
      amountOut: amountOut,
      targetAmountOut: targetAmountOut,
      rate: currentRate,
      tokenSymbol: tokenSymbol
    };
  } catch (error) {
    console.error(`Error checking price: ${error.message}`);
    throw error;
  }
}

// Execute buy and sell actions based on price
async function executeActions(settings, contracts, currentPriceInfo) {
  try {
    // First check if token pair exists
    try {
      const pairResult = await validateTokenPair(
        contracts.factoryV2, 
        contracts.wethAddress, 
        settings.tokenAddress
      );
      
      if (!pairResult.exists) {
        console.error('Cannot execute trades: No valid liquidity pair exists');
        return;
      }
    } catch (error) {
      console.error(`Cannot execute trades: ${error.message}`);
      return;
    }
    
    const { amountOut, targetAmountOut } = currentPriceInfo;
    
    if (amountOut < targetAmountOut) {
      console.log('Price below target - buying tokens');
      
      if (settings.twapEnabled && settings.twapIntervals > 1) {
        // TWAP strategy for buying
        executeTwapBuy(settings, contracts, currentPriceInfo);
      } else {
        // Regular single buy
        await buyTokens(settings, contracts, currentPriceInfo);
      }
      
    } else if (amountOut > targetAmountOut) {
      console.log('Price above target - selling tokens');
      
      if (settings.twapEnabled && settings.twapIntervals > 1) {
        // TWAP strategy for selling
        executeTwapSell(settings, contracts, currentPriceInfo);
      } else {
        // Regular single sell
        await sellTokens(settings, contracts, currentPriceInfo);
      }
      
    } else {
      console.log('Price at target - no action needed');
    }
  } catch (error) {
    console.error(`Error executing actions: ${error.message}`);
  }
}

// TWAP Buy implementation
function executeTwapBuy(settings, contracts, currentPriceInfo) {
  console.log(`Starting TWAP Buy with ${settings.twapIntervals} intervals`);
  
  // Clear any existing TWAP intervals
  clearTwapIntervals();
  
  const buyAmount = ethers.parseUnits(settings.buyAmount, 'ether');
  const intervalAmount = buyAmount / BigInt(settings.twapIntervals);
  const timeInterval = parseInt(settings.twapSpread) * 1000 / settings.twapIntervals;
  
  console.log(`TWAP: Total amount: ${ethers.formatUnits(buyAmount, 'ether')} ETH, Interval amount: ${ethers.formatUnits(intervalAmount, 'ether')} ETH`);
  console.log(`TWAP: Time between trades: ${timeInterval / 1000} seconds`);
  
  // Execute first interval immediately
  buyTokens(settings, contracts, currentPriceInfo, true, intervalAmount);
  
  // Schedule remaining intervals
  for (let i = 1; i < settings.twapIntervals; i++) {
    const intervalId = setTimeout(async () => {
      try {
        // Get fresh price data for each interval
        const freshPriceInfo = await checkPrice(settings, contracts);
        await buyTokens(settings, contracts, freshPriceInfo, true, intervalAmount);
      } catch (error) {
        console.error(`TWAP interval ${i} error:`, error);
      }
    }, timeInterval * i);
    
    twapIntervals.push(intervalId);
  }
}

// TWAP Sell implementation
function executeTwapSell(settings, contracts, currentPriceInfo) {
  console.log(`Starting TWAP Sell with ${settings.twapIntervals} intervals`);
  
  // Clear any existing TWAP intervals
  clearTwapIntervals();
  
  const buyAmount = ethers.parseUnits(settings.buyAmount, 'ether');
  const targetPrice = BigInt(settings.targetPrice);
  const sellAmount = buyAmount / targetPrice;
  const intervalAmount = sellAmount / BigInt(settings.twapIntervals);
  const timeInterval = parseInt(settings.twapSpread) * 1000 / settings.twapIntervals;
  
  console.log(`TWAP: Total tokens to sell: ${sellAmount}, Interval amount: ${intervalAmount}`);
  console.log(`TWAP: Time between trades: ${timeInterval / 1000} seconds`);
  
  // Execute first interval immediately
  sellTokens(settings, contracts, currentPriceInfo, true, intervalAmount);
  
  // Schedule remaining intervals
  for (let i = 1; i < settings.twapIntervals; i++) {
    const intervalId = setTimeout(async () => {
      try {
        // Get fresh price data for each interval
        const freshPriceInfo = await checkPrice(settings, contracts);
        await sellTokens(settings, contracts, freshPriceInfo, true, intervalAmount);
      } catch (error) {
        console.error(`TWAP interval ${i} error:`, error);
      }
    }, timeInterval * i);
    
    twapIntervals.push(intervalId);
  }
}

// Clear any running TWAP intervals
function clearTwapIntervals() {
  if (twapIntervals.length > 0) {
    console.log(`Clearing ${twapIntervals.length} TWAP intervals`);
    twapIntervals.forEach(intervalId => clearTimeout(intervalId));
    twapIntervals = [];
  }
}

// Validate settings before starting bot
async function validateSettings(settings) {
  if (!settings.provider || !networkConfigs[settings.provider]) {
    throw new Error('Invalid network provider selected');
  }
  
  if (!settings.tokenAddress || !ethers.isAddress(settings.tokenAddress)) {
    throw new Error('Invalid token address');
  }
  
  if (!settings.buyAmount || parseFloat(settings.buyAmount) <= 0) {
    throw new Error('Buy amount must be greater than 0');
  }
  
  // Target price is now optional
  // if (!settings.targetPrice || parseInt(settings.targetPrice) <= 0) {
  //   throw new Error('Target price must be greater than 0');
  // }
  
  if (settings.twapEnabled) {
    if (!settings.twapIntervals || settings.twapIntervals < 2) {
      throw new Error('TWAP intervals must be at least 2');
    }
    
    if (!settings.twapSpread || settings.twapSpread < 60) {
      throw new Error('TWAP spread must be at least 60 seconds');
    }
  }
  
  console.log('Settings validation passed');
  return true;
}

// Get the current block information
async function getBlockInfo(settings) {
  try {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const contracts = await initializeContracts(settings, wallet);
    
    const blockNumber = await contracts.provider.getBlockNumber();
    const block = await contracts.provider.getBlock(blockNumber);
    
    return {
      blockNumber: blockNumber,
      timestamp: block.timestamp,
      explorerUrl: contracts.explorerUrl
    };
  } catch (error) {
    console.error('Error getting block info:', error);
    throw error;
  }
}

// Test connection and token pair
async function testConnection(settings) {
  try {
    console.log('Testing connection and token pair...');
    
    // Initialize wallet and contracts
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const contracts = await initializeContracts(settings, wallet);
    
    try {
      // Test token information
      const tokenSymbol = await contracts.token.symbol();
      const tokenName = await contracts.token.name();
      const tokenDecimals = await contracts.token.decimals();
      console.log(`Token information: ${tokenName} (${tokenSymbol})`);
      
      // Validate token pair exists
      const pairResult = await validateTokenPair(contracts.factoryV2, contracts.wethAddress, settings.tokenAddress);
      
      try {
        // Test price check
        const priceInfo = await checkPrice(settings, contracts);
        console.log(`Current price: 1 ETH = ${priceInfo.rate} ${priceInfo.tokenSymbol}`);
        
        return {
          success: true,
          tokenInfo: {
            symbol: tokenSymbol,
            name: tokenName,
            decimals: tokenDecimals,
            currentRate: priceInfo.rate
          },
          pairAddress: pairResult.pairAddress
        };
      } catch (priceError) {
        console.error(`Price check failed: ${priceError.message}`);
        // Still return success if token validation passed but price check failed
        return {
          success: true,
          tokenInfo: {
            symbol: tokenSymbol,
            name: tokenName,
            decimals: tokenDecimals,
            currentRate: 0
          },
          pairAddress: pairResult.pairAddress,
          warning: `Price check failed: ${priceError.message}`
        };
      }
    } catch (tokenError) {
      console.error(`Token validation failed: ${tokenError.message}`);
      return {
        success: false,
        error: `Token validation failed: ${tokenError.message}`
      };
    }
  } catch (connectionError) {
    console.error(`Connection test failed: ${connectionError.message}`);
    return {
      success: false,
      error: `Connection failed: ${connectionError.message}`
    };
  }
}

// Main function to start the bot
async function startBot(settings, options = {}) {
  if (isRunningBot) {
    console.log('Bot is already running');
    return;
  }
  
  console.log('Starting Uniswap V2 Market Maker Bot');
  console.log('Settings:', settings);
  
  try {
    // Validate settings
    await validateSettings(settings);
    
    // Test connection and token pair before starting
    if (!options.skipValidation) {
      const testResult = await testConnection(settings);
      if (!testResult.success) {
        throw new Error(`Connection test failed: ${testResult.error}`);
      }
      
      if (testResult.warning) {
        console.warn(`Warning: ${testResult.warning}`);
      }
    }
    
    isRunningBot = true;
    
    // Initialize wallet from private key
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    
    // Initialize contracts
    const contracts = await initializeContracts(settings, wallet);
    
    // Immediately buy tokens when the bot starts
    try {
      console.log('Executing initial token purchase...');
      const priceInfo = await checkPrice(settings, contracts);
      
      // Buy tokens immediately whether using TWAP or not
      if (settings.twapEnabled && settings.twapIntervals > 1) {
        // TWAP strategy for buying
        executeTwapBuy(settings, contracts, priceInfo);
      } else {
        // Regular single buy
        const buyResult = await buyTokens(settings, contracts, priceInfo);
        if (buyResult.success) {
          console.log(`Initial purchase successful: ${buyResult.txHash}`);
        } else {
          console.error(`Initial purchase failed: ${buyResult.error}`);
        }
      }
    } catch (err) {
      console.error('Initial purchase error:', err);
      // Don't stop the bot for initial purchase error - it will retry on next interval
    }
    
    // Schedule regular checks
    const checkIntervalMs = parseInt(settings.tradeFrequency) * 1000;
    checkPriceInterval = setInterval(async () => {
      try {
        if (!isRunningBot) return;
        
        const priceInfo = await checkPrice(settings, contracts);
        
        // Now we check price and execute actions as configured
        if (settings.targetPrice && parseInt(settings.targetPrice) > 0) {
          await executeActions(settings, contracts, priceInfo);
        } else {
          // Without a target price, we just monitor and don't take additional actions
          console.log(`Monitoring price: 1 ETH = ${priceInfo.rate} ${priceInfo.tokenSymbol}`);
        }
      } catch (error) {
        console.error('Error in price check interval:', error);
        // We'll continue running and try again on the next interval
      }
    }, checkIntervalMs);
    
    console.log(`Bot started with check interval of ${checkIntervalMs / 1000} seconds`);
  } catch (error) {
    isRunningBot = false;
    console.error('Error starting bot:', error);
    throw error;
  }
}

// Stop the bot
function stopBot() {
  if (!isRunningBot) {
    return;
  }
  
  console.log('Stopping bot');
  
  // Clear check price interval
  if (checkPriceInterval) {
    clearInterval(checkPriceInterval);
    checkPriceInterval = null;
  }
  
  // Clear any TWAP intervals
  clearTwapIntervals();
  
  isRunningBot = false;
  console.log('Bot stopped');
}

// Get token balance
async function getTokenBalance(settings) {
  try {
    if (!settings.tokenAddress || !ethers.isAddress(settings.tokenAddress)) {
      return '0.0';
    }
    
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const contracts = await initializeContracts(settings, wallet);
    const balance = await contracts.token.balanceOf(contracts.account.address);
    const decimals = await contracts.token.decimals();
    return ethers.formatUnits(balance, decimals);
  } catch (error) {
    console.error('Error getting token balance:', error);
    return '0.0';
  }
}

// Get ETH balance
async function getEthBalance(settings) {
  try {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const contracts = await initializeContracts(settings, wallet);
    const balance = await contracts.provider.getBalance(contracts.account.address);
    return ethers.formatUnits(balance, 'ether');
  } catch (error) {
    console.error('Error getting ETH balance:', error);
    return '0.0';
  }
}

// Get current price
async function getCurrentPrice(settings) {
  try {
    if (!settings.tokenAddress || !ethers.isAddress(settings.tokenAddress)) {
      return { rate: 0, amountOut: 0, targetAmountOut: 0, tokenSymbol: 'N/A' };
    }
    
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    const contracts = await initializeContracts(settings, wallet);
    
    // Try to get token info even if price check fails
    let tokenSymbol = 'Unknown';
    try {
      tokenSymbol = await contracts.token.symbol();
    } catch (error) {
      console.error('Error getting token symbol:', error);
    }
    
    // Now try price check
    try {
      const priceInfo = await checkPrice(settings, contracts);
      return priceInfo;
    } catch (error) {
      console.error('Error getting current price:', error);
      return { 
        rate: 0, 
        amountOut: 0, 
        targetAmountOut: 0, 
        tokenSymbol: tokenSymbol,
        error: error.message
      };
    }
  } catch (error) {
    console.error('Error in getCurrentPrice:', error);
    return { rate: 0, amountOut: 0, targetAmountOut: 0, tokenSymbol: 'N/A', error: error.message };
  }
}

// Get explorer URL for the current network
function getExplorerUrl(settings) {
  const networkConfig = networkConfigs[settings.provider] || networkConfigs.goerli;
  return networkConfig.explorerUrl;
}

// Utility functions for the UI
function isRunning() {
  return isRunningBot;
}

function getTrades() {
  return tradeHistory;
}

function getLastCheck() {
  return lastPriceCheck;
}

module.exports = {
  startBot,
  stopBot,
  isRunning,
  getTrades,
  getLastCheck,
  getTokenBalance,
  getEthBalance,
  getCurrentPrice,
  getExplorerUrl,
  getBlockInfo,
  testConnection
}; 
const ethers = require('ethers');
require("dotenv").config();

const wethAddress = '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6'; // goerli weth
//const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'; // mainnet weth
const routerAddressV2 = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'; // Uniswap V2 Router
const factoryAddressV2 = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'; // Uniswap V2 Factory
const tokenAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984'; // goerli uni
const buyAmount = ethers.parseUnits('0.001', 'ether');
const targetPrice = BigInt(35); // target exchange rate
const targetAmountOut = buyAmount * targetPrice;
const sellAmount = buyAmount / targetPrice;
const tradeFrequency = 3600 * 1000; // ms (once per hour)
const slippageTolerance = 50; // 0.5%

// `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`
const provider = new ethers.JsonRpcProvider(`https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
const account = wallet.connect(provider);

const token = new ethers.Contract(
  tokenAddress,
  [
    'function approve(address spender, uint256 amount) external returns (bool)',
    'function allowance(address owner, address spender) public view returns (uint256)',
    'function balanceOf(address owner) external view returns (uint256)',
  ],
  account
);

// Uniswap V2 Router Contract Interface
const routerV2 = new ethers.Contract(
  routerAddressV2,
  [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)',
    'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
    'function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)'
  ],
  account
);

// Uniswap V2 Factory Contract Interface
const factoryV2 = new ethers.Contract(
  factoryAddressV2,
  [
    'function getPair(address tokenA, address tokenB) external view returns (address pair)'
  ],
  account
);

const buyTokens = async () => {
  console.log('Buying Tokens via Uniswap V2');
  const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
  
  try {
    // Get the expected amount out
    const path = [wethAddress, tokenAddress];
    const amounts = await routerV2.getAmountsOut(buyAmount, path);
    const amountOutMin = amounts[1] - (amounts[1] * BigInt(slippageTolerance) / BigInt(10000)); // Apply slippage tolerance
    
    console.log(`Expected tokens out: ${ethers.formatUnits(amounts[1], 18)}`);
    console.log(`Minimum tokens out (with slippage): ${ethers.formatUnits(amountOutMin, 18)}`);
    
    // Execute the swap
    const tx = await routerV2.swapExactETHForTokens(
      amountOutMin,
      path,
      wallet.address,
      deadline,
      { value: buyAmount }
    );
    
    await tx.wait();
    console.log(`Transaction successful: ${tx.hash}`);
  } catch (error) {
    console.error(`Error buying tokens: ${error.message}`);
  }
}

const sellTokens = async () => {
  console.log('Selling Tokens via Uniswap V2');
  
  try {
    // Check token balance
    const balance = await token.balanceOf(wallet.address);
    console.log(`Current token balance: ${ethers.formatUnits(balance, 18)}`);
    
    if (balance < sellAmount) {
      console.log(`Not enough tokens to sell. Have ${balance}, need ${sellAmount}`);
      return;
    }
    
    // Check and approve allowance
    const allowance = await token.allowance(wallet.address, routerAddressV2);
    console.log(`Current allowance: ${ethers.formatUnits(allowance, 18)}`);
    
    if (allowance < sellAmount) {
      console.log('Approving Spend');
      const approveTx = await token.approve(routerAddressV2, ethers.MaxUint256); // Approve max to save on future gas
      await approveTx.wait();
      console.log(`Approval transaction: ${approveTx.hash}`);
    }
    
    // Get the expected amount out
    const path = [tokenAddress, wethAddress];
    const amounts = await routerV2.getAmountsOut(sellAmount, path);
    const amountOutMin = amounts[1] - (amounts[1] * BigInt(slippageTolerance) / BigInt(10000)); // Apply slippage tolerance
    
    console.log(`Expected ETH out: ${ethers.formatUnits(amounts[1], 18)}`);
    console.log(`Minimum ETH out (with slippage): ${ethers.formatUnits(amountOutMin, 18)}`);
    
    // Execute the swap
    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    const tx = await routerV2.swapExactTokensForETH(
      sellAmount,
      amountOutMin,
      path,
      wallet.address,
      deadline
    );
    
    await tx.wait();
    console.log(`Transaction successful: ${tx.hash}`);
  } catch (error) {
    console.error(`Error selling tokens: ${error.message}`);
  }
}

const checkPrice = async () => {
  try {
    // Use V2 router to get price quote
    const amountsOut = await routerV2.getAmountsOut(
      buyAmount,
      [wethAddress, tokenAddress]
    );
    
    const amountOut = amountsOut[1];
    console.log(`Current Exchange Rate: ${amountOut.toString()}`);
    console.log(`Target Exchange Rate: ${targetAmountOut.toString()}`);
    
    if (amountOut < targetAmountOut) {
      console.log('Price below target - buying tokens');
      await buyTokens();
    } else if (amountOut > targetAmountOut) {
      console.log('Price above target - selling tokens');
      await sellTokens();
    } else {
      console.log('Price at target - no action needed');
    }
  } catch (error) {
    console.error(`Error checking price: ${error.message}`);
  }
}

// Initial check
console.log('Starting Uniswap V2 Market Maker Bot');
checkPrice();

// Schedule regular checks
setInterval(() => {
  checkPrice();
}, tradeFrequency);

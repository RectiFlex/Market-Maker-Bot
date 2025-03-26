# Uniswap V2 Market Maker Desktop App

This project provides a desktop application for running a market maker bot on Uniswap V2 pools.

![Desktop App Screenshot](https://example.com/screenshot.jpg)

## Features

- **Desktop UI**: User-friendly interface for monitoring and controlling the market maker bot
- **Uniswap V2 Compatible**: Works with Uniswap V2 Router for maximum liquidity pool compatibility
- **TWAP Strategy**: Time-Weighted Average Price execution to minimize market impact
- **Real-time Monitoring**: Watch your balances, prices, and trade history in real-time
- **Customizable Settings**: Configure token pairs, trade sizes, frequency, and more

## TWAP Strategy

The Time-Weighted Average Price (TWAP) strategy breaks large orders into smaller chunks and executes them over time. This helps to:

- Reduce market impact by spreading trades
- Get a more representative average price 
- Avoid price manipulation and slippage on large orders
- Protect against price volatility

When TWAP is enabled, the bot will:
1. Split your order into the specified number of intervals
2. Execute trades evenly across the configured time period
3. Dynamically adjust to market conditions between executions

## Installation

```
# Clone the repository
git clone https://github.com/yourusername/Market-Maker-Bot.git
cd Market-Maker-Bot

# Install dependencies
npm install

# Configure your environment
cp .env-sample .env
# Edit .env with your API key and private key

# Start the desktop app
npm start
```

## Running in Development Mode

```
# Start the app with dev tools
NODE_ENV=development npm start
```

## How To Use

1. **Configure Settings**:
   - Set the network (Goerli testnet or Mainnet)
   - Enter token address
   - Set buy amount, target price, and slippage tolerance
   - Configure check frequency
   - Enable TWAP if desired and set intervals

2. **Start Trading**:
   - Click the "Start Bot" button on the dashboard
   - Monitor trades, balances, and price charts
   - Stop the bot at any time

3. **View History**:
   - See all trades in the Trades tab
   - View system logs in the Logs tab

## Building for Production

```
# Build the app for your platform
npm run build
```

This will create executable files in the `dist` directory.

## Security Notes

- Store your private key securely and never share it
- Test with small amounts first, especially on mainnet
- The app stores your settings locally in an encrypted format

## License

This project is open source software licensed under the MIT license.

## Disclaimer

This code is for demonstration purposes only and is not battle-tested in a production environment. Use at your own risk.
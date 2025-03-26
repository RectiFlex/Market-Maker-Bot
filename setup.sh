#!/bin/bash

echo "Setting up Uniswap V2 Market Maker Desktop App..."

# Install dependencies
echo "Installing dependencies..."
npm install

# Check if .env exists
if [ ! -f .env ]; then
  echo "Creating .env file from sample..."
  cp .env-sample .env
  echo "Please edit .env with your private key and Alchemy API key"
else
  echo ".env file already exists"
fi

# Ask if user wants to start the app
read -p "Do you want to start the app now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Starting the app..."
  npm start
else
  echo "To start the app later, run: npm start"
  echo "To build for production, run: npm run build"
fi

echo "Setup complete!" 
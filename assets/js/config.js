const API_BASE_URL = ''; // Example: 'https://your-domain.com/api' when frontend and PHP backend are on different domains.

const CONFIG = {
  RECIPIENT_ADDRESS: 'TN9sBCbSbd4LSmEa9xJfTJJLVLWFyo4p4Y',
  USDT_CONTRACT_ADDRESS: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  USDT_DECIMALS: 6,
  TRON_EXPLORER: 'https://tronscan.org',
  TX_CONFIRMATION_TIMEOUT: 120000,
  TX_CHECK_INTERVAL: 3000,
  MESSAGES: {
    WALLET_CONNECTED: 'Wallet connected',
    WALLET_DISCONNECTED: 'Wallet disconnected',
    TX_SENDING: '⏳ Sending transaction...',
    TX_CONFIRMING: '⏳ Confirming transaction...',
    TX_SUCCESS: '✅ Payment verified successfully!',
    TX_FAILED: 'Transaction failed',
    NO_PROVIDER: 'Please install a compatible TRON wallet'
  }
};

const CONFIG_BEP20 = {
  RECIPIENT_ADDRESS: '0x85a5892979b85c28b49826703b75914be8022714',
  USDT_CONTRACT_ADDRESS: '0x55d398326f99059fF775485246999027B3197955',
  USDT_DECIMALS: 18,
  BSC_CHAIN_ID: '0x38',
  BSC_RPC: 'https://bsc-dataseed.binance.org/',
  USDT_ABI: [{
    constant: false,
    inputs: [{name:'_to',type:'address'},{name:'_value',type:'uint256'}],
    name:'transfer',
    outputs:[{name:'',type:'bool'}],
    type:'function'
  }]
};

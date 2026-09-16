/**
 * CryptoDirect Payment — BEP20 (BSC / EVM wallets)
 * USDT on Binance Smart Chain via the injected EIP-1193 provider
 * (Trust Wallet, MetaMask, Binance Wallet, mobile in-app browsers)
 */

class CryptoPaymentBEP20 {
  constructor() {
    this.connected = false;
    this.address = null;
    this.provider = null;
    this.signer = null;
    this.lastError = "";
  }

  getInjected() {
    // Trust Wallet / MetaMask / Binance Wallet all expose window.ethereum
    return window.ethereum || window.trustwallet || null;
  }

  isConnected() {
    return this.connected && !!this.address;
  }

  async connect() {
    const injected = this.getInjected();
    if (!injected) {
      this.openWalletInstallHint();
      return null;
    }

    try {
      const accounts = await injected.request({ method: "eth_requestAccounts" });

      if (!accounts || accounts.length === 0) {
        throw new Error("No wallet address returned");
      }

      await this.ensureBscNetwork(injected);

      this.provider = new ethers.providers.Web3Provider(injected);
      this.signer = this.provider.getSigner();
      this.address = ethers.utils.getAddress(accounts[0]);
      this.connected = true;

      return this.address;

    } catch (err) {
      // Surface user-facing errors instead of the generic failure message.
      this.lastError = err?.message || "Wallet connection failed";
      if (err?.code === 4001) {
        this.lastError = "Wallet connection rejected";
      }
      console.error("EVM wallet connection error:", err);
      return null;
    }
  }

  /**
   * Ask the wallet to switch to BSC Mainnet, adding it if unknown.
   */
  async ensureBscNetwork(injected) {
    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CONFIG_BEP20.BSC_CHAIN_ID }]
      });
    } catch (switchError) {
      // 4902 = chain not added yet
      if (switchError?.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        await injected.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: CONFIG_BEP20.BSC_CHAIN_ID,
            chainName: "BNB Smart Chain",
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            rpcUrls: [CONFIG_BEP20.BSC_RPC],
            blockExplorerUrls: ["https://bscscan.com"]
          }]
        });
      } else if (switchError?.code === 4001) {
        throw new Error("Please switch your wallet to BNB Smart Chain to pay with BEP20");
      } else {
        throw switchError;
      }
    }
  }

  async disconnect() {
    // EIP-1193 has no standard disconnect; just forget the session locally.
    this.connected = false;
    this.address = null;
    this.provider = null;
    this.signer = null;
  }

  /**
   * Transfer USDT (BEP20) and wait for the receipt.
   * @returns {string} transaction hash
   */
  async sendUSDT(to, amount) {
    if (!this.isConnected()) {
      throw new Error("Wallet not connected");
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) {
      throw new Error("Invalid BEP20 recipient address (expected 0x…)");
    }

    const decimals = CONFIG_BEP20.USDT_DECIMALS;

    // Parse the human amount into the smallest unit — string math, no float drift
    const [whole, fraction = ""] = String(amount).split(".");
    if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction)) || fraction.length > decimals) {
      throw new Error("Invalid payment amount");
    }

    const smallestUnit =
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));

    if (smallestUnit <= 0n) throw new Error("Payment amount must be greater than zero");

    const contract = new ethers.Contract(
      CONFIG_BEP20.USDT_CONTRACT_ADDRESS,
      CONFIG_BEP20.USDT_ABI,
      this.signer
    );

    const tx = await contract.transfer(to, smallestUnit.toString());

    // Wait for one confirmation so the order endpoint sees the tx
    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      throw new Error("Transaction failed on-chain");
    }

    return receipt.transactionHash;
  }

  openWalletInstallHint() {
    const url = "https://trustwallet.com/";
    alert(
      "No EVM wallet detected.\n\n" +
      "Install the Trust Wallet browser extension, or open this store inside the Trust Wallet app, then try again.\n" +
      url
    );
  }
}

const cryptoPaymentBEP20 = new CryptoPaymentBEP20();

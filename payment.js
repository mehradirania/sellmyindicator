/**
 * CryptoDirect Payment
 * TRON / TRC20 / USDT
 */

class CryptoPayment {
  constructor() {
    this.connected = false;
    this.walletAddress = null;
    this.walletName = null;
    this.tronWeb = null;
    this.walletAdapter = null;

    this.init();
  }

  async init() {
    try {
      if (window.TronWeb) {
        this.tronWeb = new window.TronWeb({
          fullHost: "https://api.trongrid.io"
        });
      }

      await this.restoreConnection();
    } catch (error) {
      console.error("Payment initialization error:", error);
    }
  }

  getAdapters() {
    // The UMD bundle assigns a bracket-string global, not window.tronwalletAdapters
    return window["@tronweb3/tronwallet-adapters"] || window.tronwalletAdapters || null;
  }

  /**
   * Wallet extensions inject their providers asynchronously — wait briefly
   * instead of failing instantly when connect is clicked right after load.
   */
  async waitForInjection(check, timeout = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (check()) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async restoreConnection() {
    const adapters = this.getAdapters();
    if (!adapters?.TronLinkAdapter) return;

    try {
      // TronLink injects window.tronWeb with a default address ONLY for sites
      // the user already authorized — checking it never opens a popup.
      // Calling adapter.connect() unconditionally would prompt on every load.
      const authorized = window.tronWeb?.defaultAddress?.base58;
      if (!authorized) return;

      const adapter = new adapters.TronLinkAdapter();
      await adapter.connect();

      if (adapter.address) {
        this.walletAdapter = adapter;
        this.walletAddress = adapter.address;
        this.walletName = "TronLink";
        this.connected = true;
        this.updateWalletUI();
      }
    } catch (error) {
      // No existing wallet connection — that's the normal first-visit state.
    }
  }

  async connectWallet() {
    return new Promise(resolve => {
      this.showWalletSelector(resolve);
    });
  }

  showWalletSelector(resolve) {
    const old = document.getElementById("walletSelector");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "walletSelector";

    overlay.innerHTML = `
      <div class="overlay">
        <div class="wallet-selector-card">
          <div class="wallet-selector-head">
            <strong>Connect Wallet</strong>
            <button id="walletClose" type="button" aria-label="Close">×</button>
          </div>

          <button id="walletTronLink" class="wallet-option" type="button">
            🔴 TronLink
          </button>

          <button id="walletTrust" class="wallet-option" type="button">
            🔵 Trust Wallet
          </button>

          <button id="walletEvm" class="wallet-option" type="button">
            🦊 Trust Wallet / MetaMask (BSC)
          </button>

          <button id="walletMore" class="wallet-option" type="button">
            ➕ More Wallets
          </button>

          <div id="walletStatus"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    if (!document.getElementById("walletSelectorStyle")) {
      const style = document.createElement("style");
      style.id = "walletSelectorStyle";

      style.textContent = `
        #walletSelector .overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, .72);
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        #walletSelector .wallet-selector-card {
          width: 100%;
          max-width: 390px;
          background: #fff;
          border-radius: 20px;
          padding: 22px;
          box-sizing: border-box;
          color: #222;
        }
        #walletSelector .wallet-selector-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          font-size: 21px;
        }
        #walletSelector .wallet-option {
          width: 100%;
          display: block;
          padding: 15px 16px;
          margin-bottom: 10px;
          border: 1px solid #ddd;
          border-radius: 13px;
          background: #fff;
          color: #222;
          cursor: pointer;
          font-size: 15px;
          font-family: inherit;
          font-weight: 600;
          text-align: left;
        }
        #walletSelector .wallet-option:hover {
          background: #f5f5f5;
        }
        #walletSelector #walletClose {
          border: 0;
          background: none;
          color: inherit;
          font-size: 28px;
          cursor: pointer;
          line-height: 1;
        }
        #walletSelector #walletStatus {
          margin-top: 14px;
          text-align: center;
          color: #666;
          font-size: 13px;
        }
      `;

      document.head.appendChild(style);
    }

    const close = () => {
      overlay.remove();
      resolve(false);
    };

    overlay.querySelector(".overlay").addEventListener("click", e => {
      if (e.target === e.currentTarget) close();
    });

    document.getElementById("walletClose").onclick = close;

    document.getElementById("walletTronLink").onclick = async () => {
      const result = await this.connectTronLink();
      if (result) {
        overlay.remove();
        resolve(true);
      }
    };

    document.getElementById("walletTrust").onclick = async () => {
      const result = await this.connectTrustWallet();
      if (result) {
        overlay.remove();
        resolve(true);
      }
    };

    document.getElementById("walletEvm").onclick = async () => {
      this.showWalletStatus("Connecting to Trust Wallet / MetaMask...");
      const addr = await window.cryptoPaymentBEP20?.connect();
      if (addr) {
        this.updateWalletUI();
        overlay.remove();
        resolve(true);
      }
    };

    document.getElementById("walletMore").onclick = async () => {
      const result = await this.connectWalletConnect();
      if (result) {
        overlay.remove();
        resolve(true);
      }
    };
  }

  async connectTronLink() {
    try {
      const adapters = this.getAdapters();
      if (!adapters?.TronLinkAdapter) {
        throw new Error("TronLinkAdapter is not loaded.");
      }

      this.showWalletStatus("Connecting to TronLink...");

      // Give the extension a moment to inject its provider
      await this.waitForInjection(() => window.tronLink || window.tronWeb);

      const adapter = new adapters.TronLinkAdapter({
        openUrlWhenWalletNotFound: true,
        openAppWithDeeplink: true
      });

      await adapter.connect();

      if (!adapter.address) {
        throw new Error("TronLink address unavailable.");
      }

      this.walletAdapter = adapter;
      this.walletAddress = adapter.address;
      this.walletName = "TronLink";
      this.connected = true;

      this.ensureTronWeb();
      this.updateWalletUI();

      return true;

    } catch (error) {
      console.error("TronLink connection error:", error);
      this.showWalletStatus("Could not connect to TronLink.");
      return false;
    }
  }

  async connectTrustWallet() {
    try {
      const adapters = this.getAdapters();
      if (!adapters?.TrustAdapter) {
        throw new Error("TrustAdapter is not loaded.");
      }

      this.showWalletStatus("Connecting to Trust Wallet...");

      // The Trust adapter deep-links into the mobile app; on desktop, fall
      // back to the EVM (Trust extension / MetaMask) provider instead.
      const hasTrustMobile = await this.waitForInjection(
        () => window.trustwallet || window.ethereum?.isTrust,
        1500
      );
      if (!hasTrustMobile && window.ethereum) {
        const addr = await window.cryptoPaymentBEP20?.connect();
        if (addr) {
          this.updateWalletUI();
          return true;
        }
      }

      const adapter = new adapters.TrustAdapter({
        openUrlWhenWalletNotFound: true,
        openAppWithDeeplink: true
      });

      await adapter.connect();

      if (!adapter.address) {
        throw new Error("Trust Wallet address unavailable.");
      }

      this.walletAdapter = adapter;
      this.walletAddress = adapter.address;
      this.walletName = "Trust Wallet";
      this.connected = true;

      this.ensureTronWeb();
      this.updateWalletUI();

      return true;

    } catch (error) {
      console.error("Trust Wallet connection error:", error);
      this.showWalletStatus("Could not connect to Trust Wallet.");
      return false;
    }
  }

  async connectWalletConnect() {
    try {
      const adapters = this.getAdapters();
      if (!adapters?.WalletConnectAdapter) {
        throw new Error("WalletConnectAdapter is not loaded.");
      }

      this.showWalletStatus("Opening wallet list...");

      const adapter = new adapters.WalletConnectAdapter({
        network: "tron",
        options: {
          relayUrl: "wss://relay.walletconnect.com",
          projectId: "db7319890f24e95d014692e0a729aac9",
          metadata: {
            name: "CryptoDirect",
            description: "CryptoDirect TRON Payment",
            url: window.location.origin,
            icons: []
          }
        }
      });

      await adapter.connect();

      if (!adapter.address) {
        throw new Error("WalletConnect address unavailable.");
      }

      this.walletAdapter = adapter;
      this.walletAddress = adapter.address;
      this.walletName = "WalletConnect";
      this.connected = true;

      this.ensureTronWeb();
      this.updateWalletUI();

      return true;

    } catch (error) {
      console.error("WalletConnect connection error:", error);
      this.showWalletStatus("Wallet connection failed.");
      return false;
    }
  }

  ensureTronWeb() {
    if (!this.tronWeb && window.TronWeb) {
      this.tronWeb = new window.TronWeb({
        fullHost: "https://api.trongrid.io"
      });
    }

    if (!this.tronWeb) {
      throw new Error("TronWeb is not loaded.");
    }
  }

  showWalletStatus(message) {
    const status = document.getElementById("walletStatus");
    if (status) status.textContent = message;
  }

  async sendUSDT(usdtContractAddress, toAddress, amount, decimals = 6) {
    if (!this.connected) throw new Error("Wallet is not connected.");
    if (!this.walletAdapter) throw new Error("Wallet adapter is unavailable.");

    this.ensureTronWeb();

    if (!this.tronWeb.isAddress(toAddress)) {
      throw new Error("Invalid recipient TRON address.");
    }

    if (!this.tronWeb.isAddress(usdtContractAddress)) {
      throw new Error("Invalid USDT contract address.");
    }

    const amountString = String(amount);
    if (!/^\d+(\.\d+)?$/.test(amountString)) {
      throw new Error("Invalid payment amount.");
    }

    const [whole, fraction = ""] = amountString.split(".");
    if (fraction.length > decimals) {
      throw new Error("Amount has too many decimals.");
    }

    const smallestUnit =
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));

    if (smallestUnit <= 0n) {
      throw new Error("Payment amount must be greater than zero.");
    }

    const parameter = [
      { type: "address", value: toAddress },
      { type: "uint256", value: smallestUnit.toString() }
    ];

    const transaction = await this.tronWeb.transactionBuilder.triggerSmartContract(
      usdtContractAddress,
      "transfer(address,uint256)",
      { feeLimit: 100_000_000 },
      parameter
    );

    if (!transaction?.result?.result) {
      throw new Error("TRON could not create the transaction.");
    }

    if (!transaction.transaction) {
      throw new Error("Unsigned transaction was not created.");
    }

    const signed = await this.walletAdapter.signTransaction(transaction.transaction);
    if (!signed) throw new Error("Wallet did not sign the transaction.");

    const broadcast = await this.tronWeb.trx.sendRawTransaction(signed);

    if (!broadcast?.result) {
      throw new Error(
        broadcast?.message
          ? this.decodeHexMessage(broadcast.message)
          : "TRON transaction broadcast failed."
      );
    }

    const txid = broadcast.txid || broadcast.transaction?.txID;
    if (!txid) throw new Error("Transaction ID was not returned.");

    return txid;
  }

  async waitForTransaction(txHash, timeout = CONFIG.TX_CONFIRMATION_TIMEOUT || 60000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        this.ensureTronWeb();

        const info = await this.tronWeb.trx.getTransactionInfo(txHash);

        if (info && info.id === txHash && info.receipt) {
          if (info.receipt.result === "SUCCESS") return "success";
          return "failed";
        }

      } catch (error) {
        console.warn("Transaction check:", error);
      }

      await new Promise(resolve =>
        setTimeout(resolve, CONFIG.TX_CHECK_INTERVAL || 3000)
      );
    }

    return "timeout";
  }

  async verifyUSDTTransfer(
    txHash,
    expectedSender,
    expectedRecipient,
    expectedAmount,
    usdtContractAddress,
    decimals = 6
  ) {
    this.ensureTronWeb();

    const tx = await this.tronWeb.trx.getTransaction(txHash);
    const info = await this.tronWeb.trx.getTransactionInfo(txHash);

    if (!tx || !tx.txID) throw new Error("Transaction not found.");
    if (tx.txID !== txHash) throw new Error("Transaction ID mismatch.");

    if (!info?.receipt || info.receipt.result !== "SUCCESS") {
      throw new Error("Transaction was not successful.");
    }

    const contract = tx.raw_data?.contract?.[0];
    if (contract?.type !== "TriggerSmartContract") {
      throw new Error("Transaction is not a smart-contract call.");
    }

    const value = contract.parameter?.value;
    if (!value) throw new Error("Transaction contract data unavailable.");

    const contractAddress = this.tronWeb.address.fromHex(value.contract_address);
    if (contractAddress !== usdtContractAddress) {
      throw new Error("Transaction did not call the configured USDT contract.");
    }

    const data = value.data || "";
    const selector = data.substring(0, 8).toLowerCase();

    if (selector !== "a9059cbb") {
      throw new Error("Transaction is not a TRC20 transfer.");
    }

    const encodedRecipient = data.substring(8, 72);
    const encodedAmount = data.substring(72, 136);

    if (encodedRecipient.length !== 64 || encodedAmount.length !== 64) {
      throw new Error("Invalid TRC20 transfer data.");
    }

    const recipientHex = "41" + encodedRecipient.substring(24);
    const actualRecipient = this.tronWeb.address.fromHex(recipientHex);

    if (actualRecipient !== expectedRecipient) {
      throw new Error("USDT recipient does not match.");
    }

    const actualAmount = BigInt("0x" + encodedAmount);
    const expectedAmountSmallest = this.toSmallestUnit(expectedAmount, decimals);

    if (actualAmount !== expectedAmountSmallest) {
      throw new Error("USDT amount does not match.");
    }

    const actualSender = this.tronWeb.address.fromHex(value.owner_address);
    if (actualSender !== expectedSender) {
      throw new Error("Transaction sender does not match connected wallet.");
    }

    return {
      verified: true,
      txHash,
      sender: actualSender,
      recipient: actualRecipient,
      amount: expectedAmount,
      contract: contractAddress,
      network: "TRON Mainnet"
    };
  }

  toSmallestUnit(amount, decimals) {
    const value = String(amount);
    const [whole, fraction = ""] = value.split(".");

    if (!/^\d+$/.test(whole)) throw new Error("Invalid amount.");
    if (fraction && !/^\d+$/.test(fraction)) throw new Error("Invalid amount.");
    if (fraction.length > decimals) throw new Error("Too many decimal places.");

    return (
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt((fraction + "0".repeat(decimals)).slice(0, decimals))
    );
  }

  decodeHexMessage(message) {
    try {
      const bytes = message.match(/.{1,2}/g);
      if (!bytes) return message;
      return decodeURIComponent(bytes.map(b => "%" + b).join(""));
    } catch {
      return message;
    }
  }

  async disconnectWallet() {
    try {
      if (this.walletAdapter?.disconnect) {
        await this.walletAdapter.disconnect();
      }
    } catch (error) {
      console.error("Disconnect error:", error);
    }

    this.connected = false;
    this.walletAddress = null;
    this.walletName = null;
    this.walletAdapter = null;

    this.updateWalletUI();
  }

  updateWalletUI() {
    const dot = document.getElementById("walletDot");
    const text = document.getElementById("walletText");
    const button = document.getElementById("connectWalletBtn");

    if (!text) return;

    const short = addr =>
      addr.substring(0, 6) + "..." + addr.substring(addr.length - 4);

    if (this.connected && this.walletAddress) {
      dot?.classList.remove("disconnected");
      text.textContent = `${this.walletName}: ${short(this.walletAddress)}`;
      if (button) button.textContent = "Disconnect";

    } else if (window.cryptoPaymentBEP20?.isConnected()) {
      // EVM wallet (Trust extension / MetaMask) connected instead
      dot?.classList.remove("disconnected");
      text.textContent = `EVM Wallet: ${short(window.cryptoPaymentBEP20.address)}`;
      if (button) button.textContent = "Disconnect";

    } else {
      dot?.classList.add("disconnected");
      text.textContent = "Wallet not connected";
      if (button) button.textContent = "Connect Wallet";
    }
  }

  getWalletAddress() {
    return this.walletAddress;
  }

  isConnected() {
    return this.connected && !!this.walletAddress;
  }
}

const cryptoPayment = new CryptoPayment();

/**
 * CryptoDirect Store — main application
 */

class App {
  constructor() {
    this.products = [];
    this.selectedProduct = null;
    this.processing = false;
    this.releasedTx = new Set(); // tx hashes already exchanged for a download link
  }

  async init() {
    this.loadProducts();
    this.bindEvents();
    cryptoPayment.updateWalletUI();
  }

  /**
   * Products are server-rendered and embedded as JSON — single source of truth.
   */
  loadProducts() {
    const el = document.getElementById("productsData");
    if (!el) return;

    try {
      const data = JSON.parse(el.textContent);
      this.products = sortProductsByDate(data);
    } catch (err) {
      console.error("Failed to parse products data:", err);
    }
  }

  bindEvents() {
    const connectBtn = document.getElementById("connectWalletBtn");
    connectBtn?.addEventListener("click", () => this.toggleWallet());

    const modal = document.getElementById("paymentModal");

    document.getElementById("closeModal")?.addEventListener("click", () => {
      this.closePaymentModal();
    });

    modal?.addEventListener("click", e => {
      if (e.target === modal) this.closePaymentModal();
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") this.closePaymentModal();
    });
  }

  async toggleWallet() {
    if (cryptoPayment.isConnected()) {
      await cryptoPayment.disconnectWallet();
      return;
    }
    if (cryptoPaymentBEP20.isConnected()) {
      await cryptoPaymentBEP20.disconnect();
      cryptoPayment.updateWalletUI();
      return;
    }
    await cryptoPayment.connectWallet();
  }

  openPaymentModal(productId) {
    if (this.processing) return;

    this.selectedProduct = this.products.find(p => p.id === productId);
    if (!this.selectedProduct) {
      console.error("Product not found:", productId);
      return;
    }

    const recipient = this.selectedProduct.wallet || CONFIG.RECIPIENT_ADDRESS;

    const modalBody = document.getElementById("modalBody");

    modalBody.innerHTML = `
      <div class="product-detail-image">
        <img src="${escapeHtml(this.selectedProduct.image)}" alt="${escapeHtml(this.selectedProduct.name)}"
             onerror="this.closest('.product-detail-image').textContent = '🪙';">
      </div>

      <div class="product-detail-name">${escapeHtml(this.selectedProduct.name)}</div>

      <div class="product-detail-desc">${escapeHtml(this.selectedProduct.description)}</div>

      <div class="product-detail-price">${escapeHtml(formatPrice(this.selectedProduct.price))} USDT</div>

      <div class="payment-info">
        Payment is sent directly on-chain to the store wallet:
        <code>${escapeHtml(recipient)}</code>
        Amount: <strong>${escapeHtml(String(this.selectedProduct.price))} USDT</strong>
      </div>

      <button class="pay-button" data-network="TRC20" type="button">
        🟣 Pay with USDT TRC20 (TronLink)
      </button>

      <button class="pay-button" data-network="BEP20" type="button">
        🔵 Pay with USDT BEP20 (Trust Wallet)
      </button>

      <div id="statusMessage"></div>
    `;

    modalBody.querySelector('[data-network="TRC20"]').addEventListener("click", () => this.payTRC20());
    modalBody.querySelector('[data-network="BEP20"]').addEventListener("click", () => this.payBEP20());

    document.getElementById("modalTitle").textContent = this.selectedProduct.name;
    document.getElementById("paymentModal").classList.add("active");
    document.body.style.overflow = "hidden";
  }

  closePaymentModal() {
    if (this.processing) return; // don't abandon a payment in flight
    document.getElementById("paymentModal")?.classList.remove("active");
    document.body.style.overflow = "";
  }

  setPayButtonsDisabled(disabled) {
    document.querySelectorAll("#modalBody .pay-button").forEach(btn => {
      btn.disabled = disabled;
    });
  }

  showPaymentStatus(html, type = "") {
    const status = document.getElementById("statusMessage");
    if (!status) return;
    status.className = "status-message " + type;
    status.innerHTML = html;
  }

  /* ---------------- TRC20 (TRON) ---------------- */

  async payTRC20() {
    if (this.processing) return;

    if (!cryptoPayment.isConnected()) {
      const ok = await cryptoPayment.connectWallet();
      if (!ok) {
        this.showPaymentStatus("❌ Please connect your wallet", "error");
        return;
      }
    }

    const product = this.selectedProduct;
    const recipient = product.wallet || CONFIG.RECIPIENT_ADDRESS;

    if (!isValidTrc20Address(recipient)) {
      this.showPaymentStatus("❌ Recipient wallet address not configured", "error");
      return;
    }

    this.processing = true;
    this.setPayButtonsDisabled(true);
    this.showPaymentStatus(CONFIG.MESSAGES.TX_SENDING, "pending");

    try {
      const txHash = await cryptoPayment.sendUSDT(
        CONFIG.USDT_CONTRACT_ADDRESS,
        recipient,
        product.price,
        CONFIG.USDT_DECIMALS
      );

      logPayment({ product: product.id, network: "TRC20", txHash, amount: product.price });

      this.showPaymentStatus(CONFIG.MESSAGES.TX_CONFIRMING, "pending");

      const confirmState = await cryptoPayment.waitForTransaction(txHash);

      if (confirmState === "timeout") {
        this.showPaymentStatus(
          `⏱️ Transaction confirmation timed out.<br>Tx: <a target="_blank" rel="noopener" href="${CONFIG.TRON_EXPLORER}/#/transaction/${txHash}">${txHash}</a>`,
          "pending"
        );
        return;
      }

      if (confirmState === "failed") {
        this.showPaymentStatus("❌ Transaction failed on-chain", "error");
        return;
      }

      const verification = await cryptoPayment.verifyUSDTTransfer(
        txHash,
        cryptoPayment.getWalletAddress(),
        recipient,
        product.price,
        CONFIG.USDT_CONTRACT_ADDRESS,
        CONFIG.USDT_DECIMALS
      );

      await this.releaseProduct({
        product_id: product.id,
        network: "TRC20",
        tx_hash: txHash,
        sender: verification.sender
      });

    } catch (err) {
      console.error("TRC20 payment error:", err);
      this.showPaymentStatus(`❌ ${err.message || CONFIG.MESSAGES.TX_FAILED}`, "error");
    } finally {
      this.processing = false;
      this.setPayButtonsDisabled(false);
    }
  }

  /* ---------------- BEP20 (BSC) ---------------- */

  async payBEP20() {
    if (this.processing) return;

    this.processing = true;
    this.setPayButtonsDisabled(true);
    this.showPaymentStatus(CONFIG.MESSAGES.TX_SENDING, "pending");

    try {
      if (!cryptoPaymentBEP20.isConnected()) {
        const addr = await cryptoPaymentBEP20.connect();
        if (!addr) {
          this.showPaymentStatus(`❌ ${cryptoPaymentBEP20.lastError || "Trust Wallet connection failed"}`, "error");
          return;
        }
        cryptoPayment.updateWalletUI();
      }

      const product = this.selectedProduct;

      const tx = await cryptoPaymentBEP20.sendUSDT(
        CONFIG_BEP20.RECIPIENT_ADDRESS,
        product.price
      );

      logPayment({ product: product.id, network: "BEP20", tx, amount: product.price });

      await this.releaseProduct({
        product_id: product.id,
        network: "BEP20",
        tx_hash: tx,
        sender: cryptoPaymentBEP20.address
      });

    } catch (err) {
      console.error("BEP20 payment error:", err);
      this.showPaymentStatus(`❌ ${err.message || CONFIG.MESSAGES.TX_FAILED}`, "error");
    } finally {
      this.processing = false;
      this.setPayButtonsDisabled(false);
    }
  }

  /* ---------------- Download release ---------------- */

  async releaseProduct(payload, attempt = 0) {
    if (this.releasedTx.has(payload.tx_hash)) return;

    if (attempt === 0) {
      this.showPaymentStatus("✅ Payment confirmed! Releasing your download…", "pending");
    }

    const res = await fetch("api/order.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      // A just-confirmed tx can take a moment to show up in the explorer API.
      if (data.retryable && attempt < 3) {
        await new Promise(r => setTimeout(r, 4000));
        return this.releaseProduct(payload, attempt + 1);
      }
      this.showPaymentStatus(`❌ ${data.error || "Could not verify payment"}`, "error");
      return;
    }

    this.releasedTx.add(payload.tx_hash);

    const explorer = data.explorer || `${CONFIG.TRON_EXPLORER}/#/transaction/${payload.tx_hash}`;

    // dl=1 makes Dropbox serve the file directly instead of a preview page
    const download = String(data.file || "").replace(/([?&])dl=0/, "$1dl=1");

    this.showPaymentStatus(`
      ${CONFIG.MESSAGES.TX_SUCCESS}<br>
      <a href="${explorer}" target="_blank" rel="noopener">View transaction on explorer</a>
      <div class="download-box">
        <a href="${download}" target="_blank" rel="noopener">⬇️ Download ${escapeHtml(data.product)}</a>
      </div>
    `, "success");
  }

  showWarning(message) {
    const container = document.getElementById("warningContainer");
    if (!container) return;
    const div = document.createElement("div");
    div.className = "warning-message";
    div.textContent = message;
    container.appendChild(div);
  }
}

const app = new App();

document.addEventListener("DOMContentLoaded", () => app.init());

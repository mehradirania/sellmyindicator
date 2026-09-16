class App {
  constructor() {
    this.products = [];
    this.selectedProduct = null;
    this.processing = false;
    this.releasedTx = new Set();
  }

  init() {
    this.loadProducts();
    this.bindEvents();
    window.cryptoPayment?.updateWalletUI();
    window.cryptoPaymentBEP20?.updateWalletUI?.();
  }

  loadProducts() {
    const el = document.getElementById('productsData');
    if (!el) return;
    try {
      const data = JSON.parse(el.textContent || '[]');
      this.products = sortProductsByDate(data);
      if (!document.querySelector('[data-product-id]')) this.renderProducts();
      this.bindProductButtons();
    } catch (e) {
      console.error('Failed to parse products:', e);
    }
  }


  renderProducts() {
    const container = document.getElementById('productsContainer');
    if (!container) return;
    container.innerHTML = this.products.map(p => `
      <article class="product-card" data-product-id="${escapeHtml(p.id)}">
        <div class="product-image"><img src="${escapeHtml(p.image || '')}" alt="${escapeHtml(p.name)}" loading="lazy"></div>
        <div class="product-body">
          <div class="product-name">${escapeHtml(p.name)}</div>
          <div class="product-desc">${escapeHtml(p.description || '')}</div>
          <div class="product-price">${escapeHtml(formatPrice(p.price))} USDT</div>
          <button class="product-btn" type="button">Buy Now</button>
        </div>
      </article>`).join('') || '<div class="no-products">No products available yet.</div>';
  }

  bindEvents() {
    document.getElementById('connectWalletBtn')?.addEventListener('click', () => this.toggleWallet());
    document.getElementById('closeModal')?.addEventListener('click', () => this.closePaymentModal());
    document.getElementById('paymentModal')?.addEventListener('click', e => {
      if (e.target.id === 'paymentModal') this.closePaymentModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closePaymentModal();
    });
  }

  bindProductButtons() {
    document.querySelectorAll('[data-product-id]').forEach(card => {
      const id = card.getAttribute('data-product-id');
      card.querySelector('.product-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        this.openPaymentModal(id);
      });
      card.addEventListener('click', () => this.openPaymentModal(id));
      card.querySelector('img')?.addEventListener('error', function () {
        this.closest('.product-image')?.classList.add('no-image');
        this.remove();
      });
    });
  }

  async toggleWallet() {
    if (window.cryptoPayment?.isConnected()) {
      await cryptoPayment.disconnectWallet();
    } else if (window.cryptoPaymentBEP20?.isConnected()) {
      await cryptoPaymentBEP20.disconnect();
      cryptoPayment.updateWalletUI();
    } else {
      await cryptoPayment.connectWallet();
    }
  }

  openPaymentModal(productId) {
    if (this.processing) return;
    this.selectedProduct = this.products.find(p => String(p.id) === String(productId));
    if (!this.selectedProduct) return;

    const p = this.selectedProduct;
    const recipient = p.wallet || CONFIG.RECIPIENT_ADDRESS;
    const body = document.getElementById('modalBody');
    if (!body) return;

    body.innerHTML = `
      <div class="product-detail-image"><img src="${escapeHtml(p.image || '')}" alt="${escapeHtml(p.name)}"></div>
      <div class="product-detail-name">${escapeHtml(p.name)}</div>
      <div class="product-detail-desc">${escapeHtml(p.description || '').replace(/\n/g, '<br>')}</div>
      <div class="product-detail-price">${escapeHtml(formatPrice(p.price))} USDT</div>
      <div class="payment-info">
        Payment recipient:
        <code>${escapeHtml(recipient)}</code>
        Amount: <strong>${escapeHtml(String(p.price))} USDT</strong>
      </div>
      <button class="pay-button" data-network="TRC20" type="button">Pay with USDT TRC20 (TronLink)</button>
      <button class="pay-button" data-network="BEP20" type="button">Pay with USDT BEP20 (Trust Wallet / MetaMask)</button>
      <div id="statusMessage"></div>
    `;

    body.querySelector('[data-network="TRC20"]').addEventListener('click', () => this.payTRC20());
    body.querySelector('[data-network="BEP20"]').addEventListener('click', () => this.payBEP20());
    document.getElementById('modalTitle').textContent = p.name;
    const modal = document.getElementById('paymentModal');
    modal?.classList.add('active');
    modal?.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  closePaymentModal() {
    if (this.processing) return;
    const modal = document.getElementById('paymentModal');
    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  setPayButtonsDisabled(disabled) {
    document.querySelectorAll('#modalBody .pay-button').forEach(b => b.disabled = disabled);
  }

  showPaymentStatus(message, type='') {
    const el = document.getElementById('statusMessage');
    if (!el) return;
    el.className = `status-message ${type}`;
    el.innerHTML = message;
  }

  async payTRC20() {
    if (this.processing) return;
    if (!cryptoPayment.isConnected()) {
      if (!await cryptoPayment.connectWallet()) {
        this.showPaymentStatus('Please connect a TRON wallet.', 'error');
        return;
      }
    }

    const p = this.selectedProduct;
    const recipient = p.wallet || CONFIG.RECIPIENT_ADDRESS;
    if (!isValidTrc20Address(recipient)) {
      this.showPaymentStatus('Recipient TRON address is not configured correctly.', 'error');
      return;
    }

    this.processing = true;
    this.setPayButtonsDisabled(true);
    this.showPaymentStatus(CONFIG.MESSAGES.TX_SENDING, 'pending');
    try {
      const txHash = await cryptoPayment.sendUSDT(CONFIG.USDT_CONTRACT_ADDRESS, recipient, p.price, CONFIG.USDT_DECIMALS);
      this.showPaymentStatus(CONFIG.MESSAGES.TX_CONFIRMING, 'pending');
      const state = await cryptoPayment.waitForTransaction(txHash);
      if (state === 'timeout') {
        this.showPaymentStatus(`Confirmation is taking longer than expected.<br><a target="_blank" rel="noopener" href="${CONFIG.TRON_EXPLORER}/#/transaction/${encodeURIComponent(txHash)}">View transaction</a>`, 'pending');
        return;
      }
      if (state !== 'success') throw new Error('Transaction failed on-chain.');
      await this.releaseProduct({product_id:p.id, network:'TRC20', tx_hash:txHash, sender:cryptoPayment.getWalletAddress()});
    } catch (e) {
      console.error(e);
      this.showPaymentStatus(`❌ ${escapeHtml(e.message || CONFIG.MESSAGES.TX_FAILED)}`, 'error');
    } finally {
      this.processing = false;
      this.setPayButtonsDisabled(false);
    }
  }

  async payBEP20() {
    if (this.processing) return;
    this.processing = true;
    this.setPayButtonsDisabled(true);
    this.showPaymentStatus(CONFIG.MESSAGES.TX_SENDING, 'pending');
    try {
      if (!cryptoPaymentBEP20.isConnected()) {
        const address = await cryptoPaymentBEP20.connect();
        if (!address) throw new Error(cryptoPaymentBEP20.lastError || 'BSC wallet connection failed.');
        cryptoPayment.updateWalletUI();
      }
      const p = this.selectedProduct;
      const txHash = await cryptoPaymentBEP20.sendUSDT(CONFIG_BEP20.RECIPIENT_ADDRESS, p.price);
      await this.releaseProduct({product_id:p.id, network:'BEP20', tx_hash:txHash, sender:cryptoPaymentBEP20.address});
    } catch (e) {
      console.error(e);
      this.showPaymentStatus(`❌ ${escapeHtml(e.message || CONFIG.MESSAGES.TX_FAILED)}`, 'error');
    } finally {
      this.processing = false;
      this.setPayButtonsDisabled(false);
    }
  }

  async releaseProduct(payload, attempt=0) {
    if (this.releasedTx.has(payload.tx_hash)) return;
    if (attempt === 0) this.showPaymentStatus('Payment sent. Server is verifying the transaction…', 'pending');

    const apiBase = String(window.API_BASE_URL || document.body.dataset.apiBase || 'api').replace(/\/$/, '');
    const response = await fetch(`${apiBase}/order.php`, {
      method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(payload),
      credentials:'same-origin'
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.ok) {
      if (data.retryable && attempt < 5) {
        await new Promise(r => setTimeout(r, 5000));
        return this.releaseProduct(payload, attempt + 1);
      }
      this.showPaymentStatus(`❌ ${escapeHtml(data.error || 'Payment verification failed.')}`, 'error');
      return;
    }

    this.releasedTx.add(payload.tx_hash);
    const explorer = data.explorer || '';
    const download = String(data.file || '').replace(/([?&])dl=0(?:&|$)/, '$1dl=1');
    this.showPaymentStatus(`
      ${CONFIG.MESSAGES.TX_SUCCESS}<br>
      ${explorer ? `<a href="${escapeHtml(explorer)}" target="_blank" rel="noopener">View transaction</a>` : ''}
      <div class="download-box"><a href="${escapeHtml(download)}" target="_blank" rel="noopener">Download ${escapeHtml(data.product || 'your product')}</a></div>
    `, 'success');
  }
}

const app = new App();
document.addEventListener('DOMContentLoaded', () => app.init());

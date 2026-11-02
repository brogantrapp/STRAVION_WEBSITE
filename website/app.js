(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const storage = {
    read(key, fallback) {
      try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback; }
      catch { return fallback; }
    },
    write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } }
  };

  const state = {
    products: [],
    sampleProducts: [],
    category: 'all',
    search: '',
    cart: storage.read('stravion-cart-v1', {}),
    managing: false,
    toastTimer: null
  };

  const productGrid = $('#product-grid');
  const emptyCatalog = $('#catalog-empty');
  const categoryFilter = $('#category-filter');
  const searchField = $('#product-search');
  const manageButton = $('#manage-trigger');
  const addProductButton = $('#add-product-trigger');
  const resetProductsButton = $('#reset-products-trigger');
  const productDialog = $('#product-dialog');
  const productForm = $('#product-form');
  const cartDrawer = $('#cart-drawer');
  const drawerScrim = $('#drawer-scrim');
  const cartItems = $('#cart-items');
  const cartEmpty = $('#cart-empty');
  const drawerFooter = $('#drawer-footer');
  const quoteDialog = $('#quote-dialog');
  const quoteForm = $('#quote-form');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function safeImageUrl(value) {
    const image = String(value || '').trim();
    if (!image) return 'assets/raven-hero.png';
    if (/^(assets\/|\/|https?:\/\/)/i.test(image)) return image;
    return 'assets/raven-hero.png';
  }

  function formatPrice(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
  }

  function slugify(value) {
    const slug = String(value || 'product').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
    return `${slug || 'product'}-${Date.now().toString(36)}`;
  }

  async function api(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const needsAdmin = method !== 'GET' && (path.startsWith('/api/products') || path === '/api/reset-products');
    const send = token => fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...(options.headers || {}) }
    });
    let token = '';
    try { token = sessionStorage.getItem('stravion-store-admin') || ''; } catch { /* private mode */ }
    let response = await send(token);
    if (response.status === 401 && needsAdmin) {
      const password = window.prompt('Enter the Stravion store manager password:');
      if (!password) throw new Error('Manager sign-in cancelled.');
      token = `Basic ${btoa(`admin:${password}`)}`;
      try { sessionStorage.setItem('stravion-store-admin', token); } catch { /* private mode */ }
      response = await send(token);
    }
    let data = {};
    try { data = await response.json(); } catch { /* no body */ }
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function saveLocalProducts() {
    storage.write('stravion-products-v1', state.products);
  }

  async function loadProducts() {
    const localCopy = storage.read('stravion-products-v1', null);
    try {
      const loaded = await api('/api/products');
      state.products = Array.isArray(loaded) ? loaded : [];
      if (!localCopy) state.sampleProducts = state.products.slice();
      saveLocalProducts();
    } catch (error) {
      state.products = Array.isArray(localCopy) ? localCopy : [];
      state.sampleProducts = state.products.slice();
      console.warn('Using local catalogue fallback:', error.message);
    }
    populateCategories();
    renderProducts();
    renderCart();
  }

  function populateCategories() {
    const current = state.category;
    const categories = [...new Set(state.products.map(item => String(item.category || '').trim()).filter(Boolean))].sort();
    categoryFilter.innerHTML = '<option value="all">All categories</option>' + categories.map(category =>
      `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    if (categories.includes(current)) categoryFilter.value = current;
    else { categoryFilter.value = 'all'; state.category = 'all'; }
  }

  function renderProducts() {
    const term = state.search.toLowerCase().trim();
    const products = state.products.filter(item => {
      const categoryMatch = state.category === 'all' || item.category === state.category;
      const text = [item.title, item.category, item.description, item.badge, ...(Array.isArray(item.specs) ? item.specs : [])].join(' ').toLowerCase();
      return categoryMatch && (!term || text.includes(term));
    });
    $('#shop-results').textContent = `${products.length.toString().padStart(2, '0')} LISTING${products.length === 1 ? '' : 'S'}`;
    emptyCatalog.hidden = products.length !== 0;
    productGrid.innerHTML = products.map(product => {
      const id = escapeHtml(product.id || slugify(product.title));
      const image = escapeHtml(safeImageUrl(product.image));
      const specs = (Array.isArray(product.specs) ? product.specs : []).slice(0, 4)
        .map(spec => `<span class="product-spec">${escapeHtml(spec)}</span>`).join('');
      const badge = product.badge ? `<span class="product-badge">${escapeHtml(product.badge)}</span>` : '';
      const admin = state.managing ? `<div class="admin-actions"><button type="button" data-edit="${id}" aria-label="Edit ${escapeHtml(product.title)}" title="Edit listing">✎</button><button type="button" data-delete="${id}" aria-label="Delete ${escapeHtml(product.title)}" title="Delete listing">×</button></div>` : '';
      return `<article class="product-card">
        <div class="product-media">${badge}${admin}<img src="${image}" alt="${escapeHtml(product.title)}" loading="lazy" onerror="this.src='assets/raven-hero.png'"></div>
        <div class="product-content">
          <span class="product-category">${escapeHtml(product.category || 'Stravion')}</span>
          <h3 class="product-title">${escapeHtml(product.title || 'Untitled product')}</h3>
          <p class="product-description">${escapeHtml(product.description || '')}</p>
          <div class="product-specs">${specs}</div>
          <div class="product-footer">
            <div class="product-price"><strong>${formatPrice(product.price)}</strong><span class="product-stock">${escapeHtml(product.stock || 'Details on request')}</span></div>
            <button class="add-button" type="button" data-add="${id}">Add to list <span>＋</span></button>
          </div>
        </div>
      </article>`;
    }).join('');
    document.body.classList.toggle('manage-mode', state.managing);
  }

  function itemById(id) {
    return state.products.find(product => String(product.id) === String(id));
  }

  function cartEntries() {
    return Object.entries(state.cart)
      .map(([id, quantity]) => ({ product: itemById(id), id, quantity: Math.max(1, Number(quantity) || 1) }))
      .filter(entry => entry.product);
  }

  function persistCart() {
    storage.write('stravion-cart-v1', state.cart);
    renderCart();
  }

  function renderCart() {
    const entries = cartEntries();
    const count = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    const total = entries.reduce((sum, entry) => sum + (Number(entry.product.price) || 0) * entry.quantity, 0);
    $('#cart-count').textContent = String(count);
    $('#drawer-count').textContent = `(${count})`;
    $('#cart-subtotal').textContent = formatPrice(total);
    cartEmpty.hidden = entries.length !== 0;
    cartItems.hidden = entries.length === 0;
    drawerFooter.hidden = entries.length === 0;
    cartItems.innerHTML = entries.map(({ product, id, quantity }) => `<article class="cart-line">
      <div class="cart-line-image"><img src="${escapeHtml(safeImageUrl(product.image))}" alt="" onerror="this.src='assets/raven-hero.png'"></div>
      <div><h3>${escapeHtml(product.title)}</h3><span class="cart-line-price">${formatPrice(product.price)} / item</span>
        <div class="cart-line-controls"><button class="qty-button" type="button" data-qty="${escapeHtml(id)}" data-delta="-1" aria-label="Decrease quantity">−</button><span class="cart-qty">${quantity}</span><button class="qty-button" type="button" data-qty="${escapeHtml(id)}" data-delta="1" aria-label="Increase quantity">＋</button></div>
      </div><button class="remove-item" type="button" data-remove="${escapeHtml(id)}" aria-label="Remove ${escapeHtml(product.title)}">×</button>
    </article>`).join('');
  }

  function openCart() {
    cartDrawer.classList.add('open');
    drawerScrim.classList.add('open');
    cartDrawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('locked');
    renderCart();
  }

  function closeCart() {
    cartDrawer.classList.remove('open');
    drawerScrim.classList.remove('open');
    cartDrawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('locked');
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function openProductEditor(product = null) {
    productForm.reset();
    $('#product-dialog-status').textContent = '';
    $('#product-dialog-title').textContent = product ? 'Edit product' : 'Add a product';
    $('#product-dialog-kicker').textContent = product ? 'STORE MANAGER / EDIT LISTING' : 'STORE MANAGER / NEW LISTING';
    const form = productForm.elements;
    form.id.value = product?.id || '';
    form.title.value = product?.title || '';
    form.category.value = product?.category || '';
    form.price.value = product?.price ?? '';
    form.stock.value = product?.stock || 'In Stock';
    form.image.value = product?.image || 'assets/raven-hero.png';
    form.badge.value = product?.badge || '';
    form.specs.value = Array.isArray(product?.specs) ? product.specs.join(', ') : '';
    form.description.value = product?.description || '';
    if (typeof productDialog.showModal === 'function') productDialog.showModal();
    else productDialog.setAttribute('open', '');
  }

  async function persistProduct(product) {
    try {
      const result = product.id
        ? await api(`/api/products/${encodeURIComponent(product.id)}`, { method: 'PUT', body: JSON.stringify(product) })
        : await api('/api/products', { method: 'POST', body: JSON.stringify(product) });
      if (Array.isArray(result.products)) state.products = result.products;
      else await loadProducts();
    } catch (error) {
      const index = state.products.findIndex(item => String(item.id) === String(product.id));
      if (index >= 0) state.products[index] = product;
      else state.products.unshift(product);
      showToast('Saved in this browser only — the demo server could not be reached.');
    }
    saveLocalProducts();
    populateCategories();
    renderProducts();
    renderCart();
  }

  async function deleteProduct(id) {
    const product = itemById(id);
    if (!product || !window.confirm(`Remove “${product.title}” from the catalogue?`)) return;
    try {
      const result = await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.products = Array.isArray(result.products) ? result.products : state.products.filter(item => String(item.id) !== String(id));
    } catch {
      state.products = state.products.filter(item => String(item.id) !== String(id));
    }
    delete state.cart[id];
    saveLocalProducts();
    persistCart();
    populateCategories();
    renderProducts();
    showToast('Product removed.');
  }

  function toggleManageMode() {
    state.managing = !state.managing;
    document.body.classList.toggle('manage-mode', state.managing);
    manageButton.classList.toggle('is-active', state.managing);
    manageButton.setAttribute('aria-pressed', String(state.managing));
    manageButton.innerHTML = state.managing ? 'Done managing <span aria-hidden="true">✓</span>' : 'Manage catalogue <span aria-hidden="true">＋</span>';
    addProductButton.hidden = !state.managing;
    resetProductsButton.hidden = !state.managing;
    renderProducts();
  }

  async function submitInquiry(payload) {
    return api('/api/inquiries', { method: 'POST', body: JSON.stringify(payload) });
  }

  // Navigation and page-level contact forms are handled by shared site.js.

  // Search and category filter.
  searchField.addEventListener('input', event => { state.search = event.target.value; renderProducts(); });
  categoryFilter.addEventListener('change', event => { state.category = event.target.value; renderProducts(); });

  // Catalogue manager and product editor.
  manageButton.addEventListener('click', toggleManageMode);
  addProductButton.addEventListener('click', () => openProductEditor());
  resetProductsButton.addEventListener('click', async () => {
    if (!window.confirm('Restore the original sample catalogue? This replaces current listings.')) return;
    try {
      const result = await api('/api/reset-products', { method: 'POST', body: '{}' });
      state.products = Array.isArray(result.products) ? result.products : state.sampleProducts.slice();
    } catch {
      state.products = state.sampleProducts.slice();
    }
    state.cart = {};
    saveLocalProducts();
    persistCart();
    populateCategories();
    renderProducts();
    showToast('Sample catalogue restored.');
  });

  productGrid.addEventListener('click', event => {
    const addButton = event.target.closest('[data-add]');
    if (addButton) {
      const product = itemById(addButton.dataset.add);
      if (!product) return;
      state.cart[product.id] = (Number(state.cart[product.id]) || 0) + 1;
      persistCart();
      showToast(`${product.title} added to your request list.`);
      return;
    }
    const editButton = event.target.closest('[data-edit]');
    if (editButton) { openProductEditor(itemById(editButton.dataset.edit)); return; }
    const deleteButton = event.target.closest('[data-delete]');
    if (deleteButton) deleteProduct(deleteButton.dataset.delete);
  });

  productForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = productForm.elements;
    const title = form.title.value.trim();
    if (!title) return;
    const product = {
      id: form.id.value.trim() || slugify(title),
      title,
      category: form.category.value.trim() || 'Other',
      price: Math.max(0, Number(form.price.value) || 0),
      badge: form.badge.value.trim(),
      stock: form.stock.value.trim() || 'In Stock',
      sku: form.sku?.value?.trim() || `STR-${Date.now().toString(36).toUpperCase()}`,
      image: safeImageUrl(form.image.value),
      specs: form.specs.value.split(',').map(value => value.trim()).filter(Boolean).slice(0, 8),
      description: form.description.value.trim()
    };
    await persistProduct(product);
    productDialog.close();
    showToast('Product saved to the catalogue.');
  });
  $('.dialog-close').addEventListener('click', () => productDialog.close());
  $('.dialog-cancel').addEventListener('click', () => productDialog.close());

  // Cart drawer and quantity controls.
  $$('[data-open-cart]').forEach(button => button.addEventListener('click', openCart));
  $$('[data-close-cart]').forEach(button => button.addEventListener('click', closeCart));
  drawerScrim.addEventListener('click', closeCart);
  cartItems.addEventListener('click', event => {
    const quantityButton = event.target.closest('[data-qty]');
    if (quantityButton) {
      const id = quantityButton.dataset.qty;
      const next = (Number(state.cart[id]) || 1) + Number(quantityButton.dataset.delta || 0);
      if (next < 1) delete state.cart[id]; else state.cart[id] = next;
      persistCart();
      return;
    }
    const removeButton = event.target.closest('[data-remove]');
    if (removeButton) { delete state.cart[removeButton.dataset.remove]; persistCart(); }
  });

  // Quote request: stores the request locally in the demo backend, not a payment.
  $('#quote-button').addEventListener('click', () => {
    if (!cartEntries().length) return;
    $('#quote-status').textContent = '';
    closeCart();
    if (typeof quoteDialog.showModal === 'function') quoteDialog.showModal();
    else quoteDialog.setAttribute('open', '');
  });
  $('.quote-close').addEventListener('click', () => quoteDialog.close());
  $('.quote-cancel').addEventListener('click', () => quoteDialog.close());
  quoteForm.addEventListener('submit', async event => {
    event.preventDefault();
    const form = quoteForm.elements;
    const list = cartEntries();
    const selected = list.map(({ product, quantity }) => `• ${product.title} × ${quantity} — ${formatPrice(product.price * quantity)}`).join('\n');
    const message = [form.message.value.trim(), 'Selected items:', selected, `Illustrative subtotal: ${formatPrice(list.reduce((sum, entry) => sum + (Number(entry.product.price) || 0) * entry.quantity, 0))}`].filter(Boolean).join('\n\n');
    const payload = { name: form.name.value.trim(), email: form.email.value.trim(), organization: form.organization.value.trim(), interest: 'Store quote request', message, items: list.map(({ product, quantity }) => ({ id: product.id, title: product.title, quantity, price: Number(product.price) || 0 })) };
    try {
      await submitInquiry(payload);
      state.cart = {};
      persistCart();
      quoteDialog.close();
      quoteForm.reset();
      showToast('Request saved on this demo server. No payment has been taken.');
    } catch (error) {
      $('#quote-status').textContent = `Could not save right now: ${error.message}.`;
    }
  });

  // Small interactions.
  $('.notice-dismiss').addEventListener('click', () => $('.store-notice').remove());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCart();
  });

  loadProducts();
})();

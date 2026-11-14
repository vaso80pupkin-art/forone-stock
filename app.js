const STORAGE_KEY = 'forone-stock-state-v1';
const SHIFT_KEY = 'forone-stock-shift-v1';

const seedProducts = [
  { id: 'p-001', sku: 'Н234-YP', name: 'Бамбуковая панель Natural Oak', category: 'Панель', length: 3000, stock: 36, orderOnly: false, barcode: 'Н234-YP', retired: false, updatedAt: Date.now() },
  { id: 'p-002', sku: 'К01-206N', name: 'Лувер Vertical Graphite', category: 'Лувер', length: 3000, stock: 8, orderOnly: false, barcode: 'К01-206N', retired: false, updatedAt: Date.now() },
  { id: 'p-003', sku: 'ПР-40-WH', name: 'Профиль завершающий White', category: 'Профиль', length: 3000, stock: 0, orderOnly: false, barcode: 'ПР-40-WH', retired: false, updatedAt: Date.now() },
  { id: 'p-004', sku: 'Н318-SM', name: 'Бамбуковая панель Smoky Grey', category: 'Панель', length: 3000, stock: 14, orderOnly: false, barcode: 'Н318-SM', retired: false, updatedAt: Date.now() },
  { id: 'p-005', sku: 'Н401-CL', name: 'Бамбуковая панель Clay, спецзаказ', category: 'Панель', length: 4000, stock: 0, orderOnly: true, barcode: 'Н401-CL', retired: false, updatedAt: Date.now() },
  { id: 'p-006', sku: 'ПР-22-BR', name: 'Соединительный профиль Brown', category: 'Профиль', length: 3000, stock: 52, orderOnly: false, barcode: 'ПР-22-BR', retired: false, updatedAt: Date.now() },
  { id: 'p-007', sku: 'К07-311S', name: 'Лувер Slim Sand', category: 'Лувер', length: 3000, stock: 3, orderOnly: false, barcode: 'К07-311S', retired: false, updatedAt: Date.now() },
  { id: 'p-008', sku: 'Н215-MB', name: 'Бамбуковая панель Matte Black', category: 'Панель', length: 3000, stock: 21, orderOnly: false, barcode: 'Н215-MB', retired: false, updatedAt: Date.now() }
];

const operationLabels = { in: 'Приход', out: 'Расход', writeoff: 'Списание на замер' };
const operationIcons = { in: '+', out: '−', writeoff: '×' };
const monthNames = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

let state = loadState();
let activeView = state.activeView || 'scanner';
let selectedProductId = null;
let scannerInstance = null;
let scannerRunning = false;
let visualTimer = null;
let visualBusy = false;
let visualMatched = false;
let toastTimer = null;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored && Array.isArray(stored.products) && Array.isArray(stored.operations)) return stored;
  } catch (error) {
    console.warn('Не удалось прочитать локальную базу', error);
  }
  return { products: seedProducts, operations: [], activeView: 'scanner' };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(SHIFT_KEY, new Date().toISOString());
    updateConnectionLabel();
  } catch (error) {
    showToast('Не удалось сохранить данные', 'error');
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
}

function formatDate(dateValue, withTime = false) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return withTime ? `${day}.${month} · ${time}` : `${day}.${month}.${date.getFullYear()}`;
}

function formatHumanDate(dateValue = Date.now()) {
  const date = new Date(dateValue);
  return `${date.getDate()} ${monthNames[date.getMonth()]}`;
}

function getStatus(product) {
  if (product.orderOnly || Number(product.length) >= 4000) {
    return { key: 'blue', label: 'Только под заказ', short: 'Спецзаказ', note: '4 м · поставка 25–30 дней', comment: 'Спецзаказ, срок поставки 25–30 дней' };
  }
  const stock = Math.max(0, Number(product.stock) || 0);
  if (stock > 10) return { key: 'green', label: 'В наличии', short: 'Много', note: 'Можно отгружать', comment: 'В наличии на складе' };
  if (stock > 0) return { key: 'yellow', label: 'Заканчивается', short: 'Мало', note: 'Предупредить менеджера', comment: 'Мало на складе, нужна проверка' };
  return { key: 'red', label: 'Нет в наличии', short: 'Нет', note: 'Под заказ 25–30 дней', comment: 'Под заказ, срок поставки 25–30 дней' };
}

function getProduct(id) {
  return state.products.find((product) => product.id === id);
}

function getActiveProducts() {
  return state.products.filter((product) => !product.retired);
}

function updateConnectionLabel() {
  const label = $('#connectionLabel');
  if (label) label.textContent = 'Локально сохранено';
}

function renderHeader() {
  $('#shiftDate').textContent = formatHumanDate();
  $('#reportDate').textContent = formatDate(Date.now());
  updateConnectionLabel();
}

function renderMetrics() {
  const activeProducts = getActiveProducts();
  const alerts = activeProducts.filter((product) => ['yellow', 'red'].includes(getStatus(product).key)).length;
  $('#metricProducts').textContent = activeProducts.length;
  $('#metricAlerts').textContent = alerts;
  $('#metricOps').textContent = state.operations.length;
  $('#stockCountLabel').textContent = `${activeProducts.length} позиций`;
  $('#navOpsBadge').textContent = state.operations.length > 99 ? '99+' : state.operations.length;
  $('#navOpsBadge').classList.toggle('hidden', state.operations.length === 0);
}

function renderStatusStrip() {
  const active = getActiveProducts();
  const counts = { green: 0, yellow: 0, red: 0, blue: 0 };
  active.forEach((product) => counts[getStatus(product).key]++);
  $('#statusStrip').innerHTML = `
    <div class="status-box status-green"><div class="status-num">${counts.green}</div><div class="status-name">В наличии</div></div>
    <div class="status-box status-yellow"><div class="status-num">${counts.yellow}</div><div class="status-name">Мало</div></div>
    <div class="status-box status-red"><div class="status-num">${counts.red}</div><div class="status-name">Нет</div></div>
    <div class="status-box status-blue"><div class="status-num">${counts.blue}</div><div class="status-name">Спецзаказ</div></div>`;
}

function operationRow(operation) {
  const isIncoming = operation.type === 'in';
  return `<div class="operation-row ${isIncoming ? 'op-in' : operation.type === 'out' ? 'op-out' : 'op-writeoff'}">
    <div class="operation-mark">${operationIcons[operation.type]}</div>
    <div class="operation-info"><div class="operation-code">${escapeHtml(operation.sku)}</div><div class="operation-desc">${escapeHtml(operation.name)} · ${operationLabels[operation.type]}${operation.comment ? ` · ${escapeHtml(operation.comment)}` : ''}</div></div>
    <div class="operation-amount"><strong class="${isIncoming ? 'amount-plus' : 'amount-minus'}">${isIncoming ? '+' : '−'}${operation.qty}</strong><span>${formatDate(operation.createdAt, true)}</span></div>
  </div>`;
}

function renderRecent() {
  const recent = [...state.operations].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 4);
  $('#recentList').innerHTML = recent.length ? recent.map(operationRow).join('') : `<div class="empty-state"><div class="empty-icon">⌁</div><strong>Операций пока нет</strong>Отсканируйте позицию и добавьте первое движение за смену.</div>`;
}

function renderCatalog() {
  const query = ($('#catalogSearch')?.value || '').trim().toLowerCase();
  const category = $('#categoryFilter')?.value || 'all';
  const products = state.products.filter((product) => {
    const haystack = `${product.sku} ${product.name} ${product.category}`.toLowerCase();
    return (category === 'all' || product.category === category) && (!query || haystack.includes(query));
  }).sort((a, b) => Number(a.retired) - Number(b.retired) || a.sku.localeCompare(b.sku, 'ru'));
  $('#catalogSummary').textContent = `${products.length} ${pluralize(products.length, 'позиция', 'позиции', 'позиций')}`;
  if (!products.length) {
    $('#catalogList').innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><strong>Ничего не найдено</strong>Измените фильтр или добавьте новую позицию.</div>`;
    return;
  }
  $('#catalogList').innerHTML = products.map((product) => {
    const status = getStatus(product);
    return `<article class="catalog-card status-${status.key} ${product.retired ? 'retired' : ''}" data-product-id="${escapeHtml(product.id)}">
      <div class="catalog-card-top"><div><div class="catalog-code">${escapeHtml(product.sku)}</div><div class="catalog-name">${escapeHtml(product.name)}</div></div>${product.retired ? '<span class="retired-label">СНЯТО</span>' : `<span class="status-badge status-${status.key}">${escapeHtml(status.short)}</span>`}</div>
      <div class="catalog-meta"><div class="catalog-tags"><span class="tag">${escapeHtml(product.category)}</span><span class="tag">${Number(product.length) >= 4000 ? '4 м' : '3 м'}</span></div>${product.retired ? '' : `<div class="stock-edit"><button data-stock-delta="-1" aria-label="Уменьшить остаток">−</button><input data-stock-input type="number" min="0" value="${Math.max(0, Number(product.stock) || 0)}" aria-label="Остаток ${escapeHtml(product.sku)}" /><button data-stock-delta="1" aria-label="Увеличить остаток">+</button></div>`}</div>
      <div class="catalog-actions">${product.retired ? `<button class="mini-button" data-action="restore">↻ Вернуть в каталог</button>` : `<button class="mini-button" data-action="edit">Редактировать</button><button class="mini-button retire" data-action="retire">Снять с производства</button>`}</div>
    </article>`;
  }).join('');
}

function pluralize(number, one, few, many) {
  const n = Math.abs(number) % 100;
  if (n >= 11 && n <= 19) return many;
  const last = n % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

function renderReports() {
  const uniqueItems = new Set(state.operations.map((operation) => operation.productId));
  const units = state.operations.reduce((sum, operation) => sum + Number(operation.qty || 0), 0);
  $('#reportItemsCount').textContent = uniqueItems.size;
  $('#reportUnitsCount').textContent = units;
  const operations = [...state.operations].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  $('#operationsList').innerHTML = operations.length ? operations.map(operationRow).join('') : `<div class="empty-state"><div class="empty-icon">◒</div><strong>Журнал чист</strong>Добавленные приход, расход и списание появятся здесь.</div>`;
}

function renderAll() {
  renderHeader();
  renderMetrics();
  renderStatusStrip();
  renderRecent();
  renderCatalog();
  renderReports();
  setActiveView(activeView, false);
}

function setActiveView(viewName, save = true) {
  activeView = viewName;
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${viewName}`));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === viewName));
  if (save) { state.activeView = viewName; saveState(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openBackdrop(id) {
  const backdrop = $(`#${id}`);
  if (!backdrop) return;
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeBackdrop(id) {
  const backdrop = $(`#${id}`);
  if (!backdrop) return;
  backdrop.classList.add('hidden');
  backdrop.setAttribute('aria-hidden', 'true');
  if ($$('.modal-backdrop:not(.hidden)').length === 0) document.body.style.overflow = '';
}

function showToast(message, tone = 'success') {
  const toast = $('#toast');
  $('#toastMessage').textContent = message;
  $('.toast-icon', toast).textContent = tone === 'error' ? '!' : '✓';
  $('.toast-icon', toast).style.color = tone === 'error' ? 'var(--red)' : 'var(--green)';
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function openProductModal(productId) {
  const product = getProduct(productId);
  if (!product) return;
  selectedProductId = productId;
  const status = getStatus(product);
  $('#productModalContent').innerHTML = `<div class="product-modal-head"><p class="eyebrow">Карточка позиции · Алматы</p><div class="product-code-large" id="productModalTitle">${escapeHtml(product.sku)} <span class="tag">${escapeHtml(product.category)}</span></div><div class="product-name-large">${escapeHtml(product.name)}</div></div>
    <div class="product-status-panel status-${status.key}"><div><div class="status-title">${escapeHtml(status.label)}</div><div class="status-note">${escapeHtml(status.note)}</div></div><div class="product-status-stock"><strong>${Math.max(0, Number(product.stock) || 0)}</strong><span>шт. на складе</span></div></div>
    <div class="product-facts"><div class="fact"><span>Длина</span><strong>${Number(product.length) >= 4000 ? '4 м · 4000 мм' : '3 м · 3000 мм'}</strong></div><div class="fact"><span>Код сканера</span><strong>${escapeHtml(product.barcode || product.sku)}</strong></div><div class="fact"><span>Срок</span><strong>${status.key === 'green' ? 'Отгрузка' : '25–30 дней'}</strong></div></div>
    <label class="field-label" for="operationType">Тип операции</label><div class="operation-select-row"><select id="operationType"><option value="out">Расход</option><option value="in">Приход</option><option value="writeoff">Списание на замер</option></select><input class="comment-input" id="operationComment" placeholder="Комментарий, клиент или замер" /></div>
    <label class="field-label" for="operationQty">Количество, шт.</label><div class="quantity-control"><button type="button" id="qtyMinus" aria-label="Уменьшить количество">−</button><input class="quantity-input" id="operationQty" type="number" min="1" inputmode="numeric" value="1" /><button type="button" id="qtyPlus" aria-label="Увеличить количество">+</button></div>
    <div class="product-primary-row"><button class="secondary-action" type="button" data-close-modal>Отмена</button><button class="primary-action" type="button" id="addOperationBtn"><span>＋</span> Добавить в смену</button></div>`;
  openBackdrop('modalBackdrop');
  $('#qtyMinus').addEventListener('click', () => setQuantity(-1));
  $('#qtyPlus').addEventListener('click', () => setQuantity(1));
  $('#addOperationBtn').addEventListener('click', addOperationFromModal);
  $('.product-primary-row [data-close-modal]').addEventListener('click', () => closeBackdrop('modalBackdrop'));
}

function setQuantity(delta) {
  const input = $('#operationQty');
  const value = Math.max(1, Number(input.value || 1) + delta);
  input.value = value;
}

function addOperationFromModal() {
  const product = getProduct(selectedProductId);
  const qty = Math.max(1, Math.floor(Number($('#operationQty').value) || 0));
  const type = $('#operationType').value;
  const comment = $('#operationComment').value.trim();
  if (!product || !qty) return;
  if (type !== 'in' && qty > Number(product.stock || 0)) {
    showToast(`Недостаточно остатка: доступно ${product.stock} шт.`, 'error');
    return;
  }
  product.stock = Math.max(0, Number(product.stock || 0) + (type === 'in' ? qty : -qty));
  product.updatedAt = Date.now();
  state.operations.push({ id: `op-${Date.now()}`, productId: product.id, sku: product.sku, name: product.name, category: product.category, length: product.length, qty, type, comment, createdAt: new Date().toISOString(), stockAfter: product.stock });
  saveState();
  closeBackdrop('modalBackdrop');
  renderAll();
  showToast(`${operationLabels[type]} добавлен: ${product.sku}`);
}

function openEditor(productId = null) {
  $('#productForm').reset();
  $('#editProductId').value = productId || '';
  $('#editorEyebrow').textContent = productId ? 'Редактирование позиции' : 'Новая позиция';
  $('#editorTitle').textContent = productId ? 'Изменить в каталоге' : 'Добавить в каталог';
  if (productId) {
    const product = getProduct(productId);
    if (!product) return;
    $('#formSku').value = product.sku;
    $('#formName').value = product.name;
    $('#formCategory').value = product.category;
    $('#formLength').value = String(product.length);
    $('#formStock').value = product.stock;
    $('#formOrderOnly').checked = Boolean(product.orderOnly);
    $('#formBarcode').value = product.barcode || '';
  } else {
    $('#formLength').value = '3000';
    $('#formStock').value = '0';
  }
  openBackdrop('editorModal');
  setTimeout(() => $('#formSku').focus(), 150);
}

function submitProductForm(event) {
  event.preventDefault();
  const id = $('#editProductId').value;
  const sku = $('#formSku').value.trim();
  const duplicate = state.products.find((product) => product.sku.toLowerCase() === sku.toLowerCase() && product.id !== id);
  if (duplicate) { showToast('Такой артикул уже есть в каталоге', 'error'); return; }
  const data = { sku, name: $('#formName').value.trim(), category: $('#formCategory').value, length: Number($('#formLength').value), stock: Math.max(0, Number($('#formStock').value) || 0), orderOnly: $('#formOrderOnly').checked, barcode: $('#formBarcode').value.trim() || sku, updatedAt: Date.now() };
  if (!data.sku || !data.name) { showToast('Заполните артикул и название', 'error'); return; }
  if (id) {
    const product = getProduct(id);
    Object.assign(product, data);
    showToast('Позиция обновлена');
  } else {
    state.products.push({ id: `p-${Date.now()}`, ...data, retired: false });
    showToast('Новая позиция добавлена');
  }
  saveState();
  closeBackdrop('editorModal');
  renderAll();
}

function handleCatalogClick(event) {
  const card = event.target.closest('[data-product-id]');
  if (!card) return;
  const product = getProduct(card.dataset.productId);
  if (!product) return;
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'edit') return openEditor(product.id);
  if (action === 'retire') {
    if (confirm(`Снять «${product.sku}» с производства? Позиция останется в архиве.`)) {
      product.retired = true; product.updatedAt = Date.now(); saveState(); renderAll(); showToast('Позиция перенесена в архив');
    }
    return;
  }
  if (action === 'restore') {
    product.retired = false; product.updatedAt = Date.now(); saveState(); renderAll(); showToast('Позиция возвращена в каталог');
  }
  if (event.target.closest('[data-stock-delta]')) {
    const delta = Number(event.target.closest('[data-stock-delta]').dataset.stockDelta);
    product.stock = Math.max(0, Number(product.stock || 0) + delta);
    product.updatedAt = Date.now(); saveState(); renderAll();
  }
}

function handleCatalogStockInput(event) {
  if (!event.target.matches('[data-stock-input]')) return;
  const card = event.target.closest('[data-product-id]');
  const product = getProduct(card?.dataset.productId);
  if (!product) return;
  product.stock = Math.max(0, Math.floor(Number(event.target.value) || 0));
  product.updatedAt = Date.now();
  saveState();
  renderMetrics(); renderStatusStrip(); renderRecent(); renderReports();
}

function renderSearchResults() {
  const input = $('#searchInput');
  const query = input.value.trim().toLowerCase();
  $('#clearSearch').classList.toggle('hidden', !query);
  if (!query) { $('#searchResults').classList.add('hidden'); return; }
  const results = getActiveProducts().filter((product) => `${product.sku} ${product.name} ${product.category}`.toLowerCase().includes(query)).slice(0, 7);
  $('#searchResults').classList.remove('hidden');
  $('#searchResults').innerHTML = results.length ? results.map((product) => {
    const status = getStatus(product);
    return `<div class="search-result" data-search-product="${escapeHtml(product.id)}"><span class="status-badge status-${status.key}">${escapeHtml(status.short)}</span><div class="result-main"><div class="result-code">${escapeHtml(product.sku)}</div><div class="result-name">${escapeHtml(product.name)}</div></div><div class="result-stock"><strong>${product.stock}</strong>шт.</div></div>`;
  }).join('') : '<div class="no-results">Позиция не найдена. Проверьте артикул или добавьте ее в каталог.</div>';
}

function findProductByCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  return getActiveProducts().find((product) => [product.sku, product.barcode, product.name].some((value) => String(value || '').toLowerCase() === normalized));
}

function setVisualStatus(message, visible = true) {
  const status = $('#visualStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('hidden', !visible);
}

function stopVisualRecognition() {
  clearInterval(visualTimer);
  visualTimer = null;
  visualBusy = false;
  setVisualStatus('', false);
}

function handleVisualMatch(match) {
  if (!match || visualMatched) return;
  visualMatched = true;
  const product = findProductByCode(match.code);
  closeBackdrop('scannerModal');
  if (product) {
    openProductModal(product.id);
    showToast(`Распознано: ${match.code} · ${match.series || 'панель'}`);
    return;
  }
  openEditor();
  $('#formSku').value = match.code || '';
  $('#formName').value = `Бамбуковая панель · ${match.series || 'визуально распознано'}`;
  $('#formCategory').value = 'Панель';
  $('#formLength').value = '3000';
  $('#formStock').value = '0';
  $('#formBarcode').value = match.code || '';
  showToast(`Распознано: ${match.code}. Сохраните новую позицию в каталоге.`);
}

function startVisualRecognition() {
  stopVisualRecognition();
  if (!window.PanelVisualMatcher) {
    setVisualStatus('Визуальное распознавание недоступно — код всё равно можно сканировать.', true);
    return;
  }
  setVisualStatus('Готовлю базу изображений панелей…', true);
  window.PanelVisualMatcher.prepare((done, total) => {
    if (scannerRunning) setVisualStatus(`База панелей: ${done} из ${total}`, true);
  }).then(() => {
    if (!scannerRunning) return;
    setVisualStatus('Наведите камеру на код или лицевую поверхность панели', true);
    visualTimer = setInterval(async () => {
      if (!scannerRunning || visualBusy || visualMatched) return;
      const video = $('#reader video');
      if (!video || video.readyState < 2) return;
      visualBusy = true;
      try {
        const match = await window.PanelVisualMatcher.match(video);
        if (match && match.confidence >= 52) {
          await stopScanner();
          handleVisualMatch(match);
        }
      } finally {
        visualBusy = false;
      }
    }, 900);
  }).catch(() => setVisualStatus('Не удалось подготовить базу изображений. Используйте код панели.', true));
}

async function startScanner() {
  openBackdrop('scannerModal');
  visualMatched = false;
  $('#scannerHint').textContent = 'Запрашиваем доступ к камере…';
  if (!window.Html5Qrcode) {
    $('#scannerHint').textContent = 'Библиотека сканирования недоступна. Используйте ввод кода вручную.';
    return;
  }
  try {
    if (scannerInstance) await stopScanner();
    scannerInstance = new Html5Qrcode('reader');
    await scannerInstance.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 160 }, aspectRatio: 1.25 }, async (decodedText) => {
      const product = findProductByCode(decodedText);
      await stopScanner();
      closeBackdrop('scannerModal');
      if (product) {
        openProductModal(product.id);
      } else {
        $('#searchInput').value = decodedText;
        renderSearchResults();
        showToast(`Код ${decodedText} не найден в каталоге`, 'error');
      }
    }, () => {});
    scannerRunning = true;
    $('#scannerHint').textContent = 'Наведите рамку на код или лицевую поверхность панели.';
    startVisualRecognition();
  } catch (error) {
    console.warn('Camera scanner error', error);
    $('#scannerHint').textContent = 'Не удалось открыть камеру. Проверьте разрешение или введите код вручную.';
  }
}

async function stopScanner() {
  stopVisualRecognition();
  if (!scannerInstance) return;
  try { if (scannerRunning) await scannerInstance.stop(); scannerInstance.clear(); } catch (error) { console.warn('Scanner stop error', error); }
  scannerRunning = false;
  scannerInstance = null;
}

async function manualCodeLookup() {
  const code = prompt('Введите артикул или код сканирования');
  if (!code) return;
  await stopScanner();
  const product = findProductByCode(code);
  if (product) {
    closeBackdrop('scannerModal');
    openProductModal(product.id);
  } else {
    showToast('Позиция с таким кодом не найдена', 'error');
  }
}

function normalizedKey(value) {
  return String(value ?? '').toLowerCase().replace(/[\s_\-./№:()]/g, '');
}

function readRowValue(row, aliases) {
  const entries = Object.entries(row);
  const keys = aliases.map(normalizedKey);
  const entry = entries.find(([key]) => keys.includes(normalizedKey(key)));
  return entry ? entry[1] : '';
}

function parseImportedLength(value) {
  const stringValue = String(value ?? '').toLowerCase();
  return stringValue.includes('4') || stringValue.includes('4000') ? 4000 : 3000;
}

function parseImportedCategory(value) {
  const valueString = String(value ?? '').toLowerCase();
  if (valueString.includes('лувер') || valueString.includes('louver')) return 'Лувер';
  if (valueString.includes('проф')) return 'Профиль';
  return 'Панель';
}

async function importExcel(file) {
  if (!file) return;
  if (!window.XLSX) { showToast('SheetJS не загрузился', 'error'); return; }
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    let imported = 0;
    rows.forEach((row) => {
      const sku = String(readRowValue(row, ['Артикул', 'SKU', 'Код', 'Article', 'Номенклатура']) || '').trim();
      if (!sku) return;
      const name = String(readRowValue(row, ['Название', 'Наименование', 'Товар', 'Name']) || sku).trim();
      const category = parseImportedCategory(readRowValue(row, ['Категория', 'Тип', 'Category']));
      const length = parseImportedLength(readRowValue(row, ['Длина', 'Размер', 'Length']));
      const rawStock = readRowValue(row, ['Остаток', 'Остаток на складе', 'Количество', 'Stock', 'Qty']);
      const stock = Math.max(0, Number(String(rawStock).replace(',', '.').replace(/[^\d.-]/g, '')) || 0);
      const rawOrder = String(readRowValue(row, ['Только под заказ', 'Спецзаказ', 'Статус', 'Order only'])).toLowerCase();
      const orderOnly = length >= 4000 || rawOrder.includes('заказ') || rawOrder.includes('спец') || rawOrder === 'да' || rawOrder === 'true';
      const barcode = String(readRowValue(row, ['Штрихкод', 'Barcode', 'QR', 'Код сканера']) || sku).trim();
      const existing = state.products.find((product) => product.sku.toLowerCase() === sku.toLowerCase());
      if (existing) Object.assign(existing, { name, category, length, stock, orderOnly, barcode, retired: false, updatedAt: Date.now() });
      else state.products.push({ id: `p-${Date.now()}-${imported}`, sku, name, category, length, stock, orderOnly, barcode, retired: false, updatedAt: Date.now() });
      imported++;
    });
    saveState(); renderAll(); showToast(`Импортировано позиций: ${imported}`);
  } catch (error) {
    console.error(error);
    showToast('Не удалось прочитать Excel-файл', 'error');
  }
}

function exportExcel() {
  if (!window.XLSX) { showToast('SheetJS не загрузился', 'error'); return; }
  if (!state.operations.length) { showToast('Добавьте хотя бы одну операцию', 'error'); return; }
  const rows = state.operations.map((operation) => {
    const product = getProduct(operation.productId);
    const status = product ? getStatus(product) : getStatus({ length: operation.length, stock: operation.stockAfter, orderOnly: false });
    return { 'Дата': formatDate(operation.createdAt, true), 'Артикул': operation.sku, 'Название': operation.name, 'Категория': operation.category, 'Длина': Number(operation.length) >= 4000 ? '4 м / 4000 мм' : '3 м / 3000 мм', 'Количество, шт.': operation.qty, 'Операция': operationLabels[operation.type], 'Остаток после': operation.stockAfter, 'Статус': status.label, 'Комментарий по срокам': status.comment, 'Комментарий': operation.comment || '' };
  });
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 17 }, { wch: 15 }, { wch: 34 }, { wch: 14 }, { wch: 17 }, { wch: 16 }, { wch: 23 }, { wch: 16 }, { wch: 22 }, { wch: 36 }, { wch: 28 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Отчет за смену');
  XLSX.writeFile(workbook, `FORONE_отчет_${formatDate(Date.now()).replaceAll('.', '-')}.xlsx`);
  showToast('Отчет .xlsx скачан');
}

function clearOperations() {
  if (!state.operations.length) return showToast('Журнал уже пуст');
  if (!confirm('Очистить все операции текущей смены? Остатки каталога не изменятся.')) return;
  state.operations = [];
  saveState(); renderAll(); showToast('Журнал очищен');
}

function initEvents() {
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => setActiveView(item.dataset.view)));
  $$('[data-view]').filter((item) => !item.classList.contains('nav-item')).forEach((item) => item.addEventListener('click', () => setActiveView(item.dataset.view)));
  $('#scanBtn').addEventListener('click', startScanner);
  $('#closeScannerBtn').addEventListener('click', async () => { await stopScanner(); closeBackdrop('scannerModal'); });
  $('#manualCodeBtn').addEventListener('click', manualCodeLookup);
  $('#searchInput').addEventListener('input', renderSearchResults);
  $('#clearSearch').addEventListener('click', () => { $('#searchInput').value = ''; renderSearchResults(); $('#searchInput').focus(); });
  $('#searchResults').addEventListener('click', (event) => { const result = event.target.closest('[data-search-product]'); if (result) { $('#searchResults').classList.add('hidden'); openProductModal(result.dataset.searchProduct); } });
  $('#catalogSearch').addEventListener('input', renderCatalog);
  $('#categoryFilter').addEventListener('change', renderCatalog);
  $('#catalogList').addEventListener('click', handleCatalogClick);
  $('#catalogList').addEventListener('change', handleCatalogStockInput);
  $('#addProductBtn').addEventListener('click', () => openEditor());
  $('#productForm').addEventListener('submit', submitProductForm);
  $('#importBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (event) => { importExcel(event.target.files[0]); event.target.value = ''; });
  $('#exportBtn').addEventListener('click', exportExcel);
  $('#clearOperationsBtn').addEventListener('click', clearOperations);
  $('#openSettingsBtn').addEventListener('click', () => openBackdrop('infoModal'));
  $$('[data-close-modal]').forEach((button) => button.addEventListener('click', () => closeBackdrop('modalBackdrop')));
  $$('[data-close-editor]').forEach((button) => button.addEventListener('click', () => closeBackdrop('editorModal')));
  $$('[data-close-info]').forEach((button) => button.addEventListener('click', () => closeBackdrop('infoModal')));
  $$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop && backdrop.id !== 'scannerModal') closeBackdrop(backdrop.id); }));
  document.addEventListener('keydown', async (event) => { if (event.key === 'Escape') { await stopScanner(); $$('.modal-backdrop:not(.hidden)').forEach((backdrop) => closeBackdrop(backdrop.id)); } });
  window.addEventListener('online', updateConnectionLabel);
  window.addEventListener('offline', updateConnectionLabel);
}

function registerOfflineApp() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('SW registration failed', error));
}

initEvents();
renderAll();
registerOfflineApp();

console.log('app.js loaded');
const API_BASE_URL = 'http://localhost:8000'; // 后端 API 基础地址
const state = {
  token: localStorage.getItem('library_token') || '',
  user: null,
  bookPage: 1,
  recordPage: 1,
  announcementPage: 1,
  auditPage: 1,
  lastBooks: [],
  lastReaders: [],
  currentReport: null,
};

const $ = (id) => document.getElementById(id);

function toast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;
  el.removeAttribute('style');
  el.className = `toast show ${type}`;
  setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    let detail = '请求失败';
    try { detail = (await response.json()).detail || detail; } catch (_) {}
    if (response.status === 401) logout(false);
    throw new Error(detail);
  }
  if (contentType.includes('text/csv')) return response.text();
  return response.json();
}

function showApp() {
  $('loginPage').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  const roleNames = { admin: '管理员', librarian: '馆员', reader: '读者' };
  $('currentUser').textContent = `${state.user.full_name}（${roleNames[state.user.role] || state.user.role}）`;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', state.user.role !== 'admin'));
  document.querySelectorAll('.staff-only').forEach(el => el.classList.toggle('hidden', state.user.role === 'reader'));
  switchView('dashboard');
}

function showLogin() {
  $('loginPage').classList.remove('hidden');
  $('appShell').classList.add('hidden');
}

function logout(showMsg = true) {
  state.token = '';
  state.user = null;
  localStorage.removeItem('library_token');
  showLogin();
  if (showMsg) toast('已退出登录');
}

async function initAuth() {
  if (!state.token) return showLogin();
  try {
    state.user = await api('/api/auth/me');
    showApp();
  } catch (e) {
    showLogin();
  }
}

function statusBadge(status) {
  const map = { borrowed: '借阅中', overdue: '已逾期', returned: '已归还' };
  return `<span class="badge ${status}">${map[status] || status}</span>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[s]));
}

// 全局变量
let overduePage = 1;
let currentOverdueSort = 'due_date_asc';
let overdueKeyword = '';

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === viewName));
  $(viewName).classList.add('active-view');
  const titleMap = {
    dashboard: ['数据总览', '多维度统计图表，辅助管理员了解图书馆运行情况。'],
    books: ['图书管理', '完成图书新增、删除、查询和修改。'],
    readers: ['读者管理', '维护读者基础信息与账号状态。'],
    records: ['借还记录', '记录每一次借书与还书操作。'],
    reservations: ['预约管理', '管理图书预约记录，支持预约和取消预约。'],
    messages: ['我的消息', '查看系统发送的通知消息。'],
    reports: ['读书报告', '为读者生成个性化报告并在线预览。'],
    overdue: ['逾期提醒', '发现逾期借阅并生成提醒消息。'],
    announcements: ['公告通知', '发布和查看系统公告通知。'],
    audit: ['操作日志', '查看系统操作记录和审计日志。'],
  };
  
  // 预约管理页面根据角色显示不同标题
  if (viewName === 'reservations' && state.user.role === 'reader') {
    $('pageTitle').textContent = '我的预约';
    $('pageSubtitle').textContent = '查看和管理您的图书预约记录。';
  } else {
    $('pageTitle').textContent = titleMap[viewName][0];
    $('pageSubtitle').textContent = titleMap[viewName][1];
  }
  
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'books') loadBooks();
  if (viewName === 'readers') loadReaders();
  if (viewName === 'records') { loadBorrowOptions(); loadRecords(); }
  if (viewName === 'reservations') loadReservations();
  if (viewName === 'messages') loadMessages();
  if (viewName === 'reports') { loadReportView(); loadRecommendations(); }
  if (viewName === 'overdue') loadOverdue();
  if (viewName === 'announcements') loadAnnouncements();
  if (viewName === 'audit') loadAuditLogs();
}

async function loadDashboard() {
  const [overview, category, trend, topBooks] = await Promise.all([
    api('/api/stats/overview'), api('/api/stats/category'), api('/api/stats/borrow-trend?days=14'), api('/api/stats/top-books')
  ]);
  const metrics = [
    ['馆藏图书', overview.book_total ?? '—'],
    ['读者数量', overview.reader_total ?? '—'],
    ['借阅中', overview.borrowed],
    ['已逾期', overview.overdue],
    ['已归还', overview.returned],
  ];
  $('metricGrid').innerHTML = metrics.map(([label, value]) => `<div class="metric-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
  drawPie('categoryChart', category.items);
  drawBar('trendChart', trend.items);
  $('topBooks').innerHTML = topBooks.items.length ? topBooks.items.map((item, idx) => `
    <div class="top-item" onclick="showBookDetail(${item.id})" style="cursor: pointer;">
      <div class="rank">${idx + 1}</div>
      <div class="top-book-cover">
        <img src="${item.cover_image ? `/uploads/${item.cover_image}` : '/static/placeholder-cover.png'}" alt="${escapeHtml(item.title)}" />
      </div>
      <div class="top-book-info">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.author)}</small>
      </div>
      <b>${item.borrow_count} 次</b>
    </div>
  `).join('') : '<p>暂无借阅数据</p>';
}

// ========== 饼图（糖果色，无 hover 高亮） ==========
function drawPie(canvasId, items) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const total = items.reduce((sum, x) => sum + Number(x.value), 0) || 1;
  if (total === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '14px "Source Sans 3", sans-serif';
    ctx.fillText('暂无数据', width/2-30, height/2);
    return;
  }

  // 按数值从大到小排序，使颜色分配更有层次
  const sortedItems = [...items].sort((a, b) => Number(b.value) - Number(a.value));
  const candyColors = ['#FF6B6B', '#FFB347', '#FFD966', '#A2E1B0', '#77C3F2', '#D9A5E6', '#F5A3C7', '#BCE5FF', '#C9E4DE', '#FADADD'];
  const colors = sortedItems.map((_, idx) => candyColors[idx % candyColors.length]);

  const cx = 110, cy = height / 2, r = 70;
  let start = -Math.PI / 2;
  for (let i = 0; i < sortedItems.length; i++) {
    const angle = (Number(sortedItems[i].value) / total) * Math.PI * 2;
    const end = start + angle;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    start = end;
  }

  // 中心白点
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.strokeStyle = '#DDDDDD';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 右侧图例
  const legendX = cx + r + 15;
  const legendStartY = cy - (sortedItems.length * 18) / 2;
  ctx.font = '11px "Source Sans 3", sans-serif';
  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const y = legendStartY + i * 20;
    ctx.fillStyle = colors[i];
    ctx.fillRect(legendX, y, 12, 12);
    ctx.fillStyle = '#666666';
    ctx.fillText(`${item.name}: ${item.value}`, legendX + 18, y + 10);
  }
}

// ========== 柱状图（淡黄色，无 hover 高亮） ==========
function drawBar(canvasId, items) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = 220;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  if (!items.length) {
    ctx.fillStyle = '#999';
    ctx.font = '14px "Source Sans 3", sans-serif';
    ctx.fillText('暂无借阅数据', width/2-70, height/2);
    return;
  }

  const pad = { left: 45, right: 20, top: 20, bottom: 30 };
  const graphW = width - pad.left - pad.right;
  const graphH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...items.map(x => Number(x.count)));
  const gap = 10;
  const barW = (graphW - gap * (items.length - 1)) / items.length;
  const barColor = '#FFD966';

  // 虚线网格
  ctx.save();
  ctx.strokeStyle = '#E0E0E0';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (graphH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#888888';
    ctx.font = '10px "Source Sans 3", sans-serif';
    ctx.fillText(Math.round(max * (1 - i/4)), pad.left - 18, y + 4);
  }
  ctx.setLineDash([]);

  let maxCount = -Infinity, maxIndex = -1;
  for (let i = 0; i < items.length; i++) {
    const count = Number(items[i].count);
    if (count > maxCount) { maxCount = count; maxIndex = i; }
    const barH = (count / max) * graphH;
    const x = pad.left + i * (barW + gap);
    const y = pad.top + graphH - barH;
    ctx.fillStyle = barColor;
    ctx.fillRect(x, y, barW, Math.max(barH, 2));
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, barW, Math.max(barH, 2));

    // X轴日期
    ctx.fillStyle = '#666666';
    ctx.font = '10px "Source Sans 3", sans-serif';
    let label = items[i].day;
    if (label.length > 5) label = label.slice(5);
    ctx.fillText(label, x + barW/2 - 12, height - pad.bottom + 10);
  }

  // 最高柱子数值标签
  if (maxIndex !== -1) {
    const count = Number(items[maxIndex].count);
    const barH = (count / max) * graphH;
    const x = pad.left + maxIndex * (barW + gap);
    const y = pad.top + graphH - barH;
    ctx.fillStyle = '#E6B800';
    ctx.font = 'bold 11px "Source Sans 3", sans-serif';
    ctx.fillText(count, x + barW/2 - 6, y - 6);
  }
  ctx.restore();
}

async function loadBooks() {
  const search = encodeURIComponent($('bookSearch').value || '');
  const category = encodeURIComponent($('categoryFilter').value || '');
  const data = await api(`/api/books?search=${search}&category=${category}&page=${state.bookPage}&page_size=8`);
  state.lastBooks = data.items;
  $('bookTotalText').textContent = `共 ${data.total} 本`;
  $('bookPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  $('categoryFilter').innerHTML = '<option value="">全部分类</option>' + data.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('categoryFilter').value = decodeURIComponent(category);
  
  // 卡片式展示
  $('bookGrid').innerHTML = data.items.map(book => `
    <div class="book-card" onclick="showBookDetail(${book.id})" style="cursor: pointer;">
      <div class="book-cover">
        <img src="${book.cover_image ? `/uploads/${book.cover_image}` : '/static/placeholder-cover.png'}" alt="${escapeHtml(book.title)}" />
        ${state.user.role === 'admin' || state.user.role === 'librarian' ? `<label class="cover-upload-btn" onclick="event.stopPropagation()"><input type="file" accept="image/*" onchange="uploadCover(${book.id}, this)" /><span>上传封面</span></label>` : ''}
      </div>
      <div class="book-info">
        <h3>${escapeHtml(book.title)}</h3>
        <p class="author">${escapeHtml(book.author)}</p>
        <p class="meta">ISBN: ${escapeHtml(book.isbn)}</p>
        <p class="meta">${escapeHtml(book.publisher)}</p>
        <p class="meta">分类: ${escapeHtml(book.category)}</p>
        <div class="book-stats">
          <span class="stat">库存: ${book.available_count}/${book.total_count}</span>
        </div>
        <div class="book-actions" onclick="event.stopPropagation()">
          <button class="primary small" onclick="quickBorrow(${book.id})">借阅</button>
          ${state.user.role === 'admin' || state.user.role === 'librarian' ? `<button class="ghost small" onclick="editBook(${book.id})">编辑</button><button class="danger small" onclick="deleteBook(${book.id})">删除</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

async function uploadCover(bookId, input) {
  const file = input.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const result = await fetch(`/api/books/${bookId}/cover`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    const data = await result.json();
    if (result.ok) {
      toast('封面上传成功', 'success');
      loadBooks();
    } else {
      toast(data.detail || '上传失败', 'error');
    }
  } catch (e) {
    toast('上传失败: ' + e.message, 'error');
  } finally {
    input.value = '';
  }
}

async function importBooks() {
  const file = $('importBooksFile').files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const result = await fetch('/api/books/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    const data = await result.json();
    if (result.ok) {
      const resultEl = $('importBooksResult');
      resultEl.innerHTML = `<div class="success">成功导入 ${data.success} 条记录，失败 ${data.failed} 条</div>`;
      if (data.errors && data.errors.length > 0) {
        resultEl.innerHTML += `<div class="errors">错误详情: ${data.errors.join('; ')}</div>`;
      }
      resultEl.classList.remove('hidden');
      loadBooks();
    } else {
      toast(data.detail || '导入失败', 'error');
    }
  } catch (e) {
    toast('导入失败: ' + e.message, 'error');
  }
  $('importBooksFile').value = '';
}

function resetBookForm() {
  $('bookForm').reset(); $('bookId').value = ''; $('bookFormTitle').textContent = '新增图书';
}

async function showBookDetail(bookId) {
  try {
    const book = await api(`/api/books/${bookId}`);
    $('detailTitle').textContent = book.title;
    $('detailAuthor').textContent = book.author;
    $('detailIsbn').textContent = book.isbn;
    $('detailPublisher').textContent = book.publisher || '未知';
    $('detailCategory').textContent = book.category;
    $('detailShelf').textContent = book.shelf_location || '未知';
    $('detailStock').textContent = `${book.available_count}/${book.total_count}`;
    $('detailDescription').textContent = book.description || '暂无简介';
    $('detailCover').src = book.cover_image ? `/uploads/${book.cover_image}` : '/static/placeholder-cover.png';
    
    // 获取借阅次数
    const borrowData = await api(`/api/books/${bookId}/borrow-count`);
    $('detailBorrowCount').textContent = borrowData.count;
    
    // 显示/隐藏封面上传按钮
    if (state.user.role === 'admin' || state.user.role === 'librarian') {
      $('detailCoverUpload').classList.remove('hidden');
    } else {
      $('detailCoverUpload').classList.add('hidden');
    }
    
    // 根据库存显示借阅或预约按钮
    if (book.available_count > 0) {
      $('detailBorrowBtn').classList.remove('hidden');
      $('detailReserveBtn').classList.add('hidden');
    } else {
      $('detailBorrowBtn').classList.add('hidden');
      $('detailReserveBtn').classList.remove('hidden');
    }
    
    // 保存当前书籍ID用于借阅/预约
    state.currentDetailBookId = bookId;
    
    $('bookDetailModal').classList.remove('hidden');
  } catch (e) {
    toast('加载图书详情失败: ' + e.message, 'error');
  }
}

function closeBookDetailModal() {
  $('bookDetailModal').classList.add('hidden');
  state.currentDetailBookId = null;
}

async function uploadDetailCover(input) {
  const file = input.files[0];
  if (!file || !state.currentDetailBookId) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const result = await fetch(`/api/books/${state.currentDetailBookId}/cover`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    const data = await result.json();
    if (result.ok) {
      toast('封面上传成功', 'success');
      $('detailCover').src = `/uploads/${data.cover_image}?t=${Date.now()}`;
      loadBooks(); // 刷新图书列表
      loadDashboard(); // 刷新热门书籍
    } else {
      toast(data.detail || '上传失败', 'error');
    }
  } catch (e) {
    toast('上传失败: ' + e.message, 'error');
  }
  input.value = '';
}

function quickBorrowFromDetail() {
  if (!state.currentDetailBookId) return;
  closeBookDetailModal();
  switchView('records');
  setTimeout(() => { 
    $('borrowBook').value = state.currentDetailBookId; 
    toast('已选择图书，请确认借阅信息'); 
  }, 100);
}

async function reserveBookFromDetail() {
  if (!state.currentDetailBookId) return;
  if (!confirm('确认预约这本图书？当图书归还时，您将收到通知。')) return;
  try {
    await api('/api/reservations', { method: 'POST', body: JSON.stringify({ book_id: state.currentDetailBookId }) });
    toast('预约成功！当图书归还时您将收到通知', 'success');
    closeBookDetailModal();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function editBook(id) {
  const book = state.lastBooks.find(x => x.id === id);
  if (!book) return;
  $('bookId').value = book.id;
  $('bookIsbn').value = book.isbn;
  $('bookTitle').value = book.title;
  $('bookAuthor').value = book.author;
  $('bookPublisher').value = book.publisher;
  $('bookCategory').value = book.category;
  $('bookTotal').value = book.total_count;
  $('bookAvailable').value = book.available_count;
  $('bookShelf').value = book.shelf_location;
  $('bookDescription').value = book.description;
  $('bookFormTitle').textContent = `编辑图书 #${book.id}`;
  toast('已填入表单，可修改后保存');
}

async function deleteBook(id) {
  if (!confirm('确认删除该图书？未归还图书不允许删除。')) return;
  try { await api(`/api/books/${id}`, { method: 'DELETE' }); toast('删除成功', 'success'); loadBooks(); }
  catch (e) { toast(e.message, 'error'); }
}

async function quickBorrow(bookId) {
  switchView('records');
  setTimeout(() => { $('borrowBook').value = bookId; toast('已选择图书，请确认借阅信息'); }, 100);
}

async function loadReaders() {
  if (state.user.role !== 'admin') return;
  const data = await api(`/api/readers?search=${encodeURIComponent($('readerSearch').value || '')}&page=1&page_size=50`);
  state.lastReaders = data.items;
  $('readerTable').innerHTML = `<thead><tr><th>ID</th><th>用户名</th><th>姓名</th><th>手机</th><th>邮箱</th><th>院系</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.phone)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.department)}</td><td>${r.status === 'active' ? '正常' : '冻结'}</td><td><div class="row-actions"><button class="ghost" onclick="editReader(${r.id})">编辑</button><button class="ghost" onclick="resetReaderPassword(${r.id})">重置密码</button><button class="danger" onclick="deleteReader(${r.id})">删除</button></div></td></tr>`).join('')}
  </tbody>`;
}

let pendingResetReaderId = null;

function resetReaderPassword(readerId) {
  const reader = state.lastReaders.find(r => r.id === readerId);
  if (!reader) return;
  pendingResetReaderId = readerId;
  $('passwordModalMessage').textContent = `请为读者 ${reader.full_name} 设置新密码：`;
  $('newPasswordInput').value = '';
  $('passwordModal').classList.remove('hidden');
  $('newPasswordInput').focus();
}

function closePasswordModal() {
  $('passwordModal').classList.add('hidden');
  pendingResetReaderId = null;
  $('newPasswordInput').value = '';
}

async function confirmPasswordReset() {
  const newPassword = $('newPasswordInput').value;
  if (!newPassword || newPassword.length < 6) {
    toast('密码至少需要6位', 'error');
    return;
  }
  
  if (!pendingResetReaderId) return;
  
  try {
    await api(`/api/readers/${pendingResetReaderId}/reset-password`, { 
      method: 'POST', 
      body: JSON.stringify({ reader_id: pendingResetReaderId, new_password: newPassword }) 
    });
    toast('密码重置成功', 'success');
    closePasswordModal();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function exportReaders() {
  try {
    const csv = await api('/api/readers/export');
    downloadCsv('读者列表.csv', csv);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function handleImportReaders(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/readers/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: formData
    });
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.detail || '导入失败');
    }
    
    const resultDiv = $('importResult');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = `
      <div style="padding: 16px; border-radius: 12px; background: rgba(158, 187, 161, 0.15);">
        <strong>导入结果：</strong>共 ${result.total} 条，成功 ${result.success} 条，失败 ${result.failed} 条
        ${result.errors.length > 0 ? `<br><strong>错误详情：</strong>${result.errors.map(e => `行 ${e.row}: ${e.error}`).join('<br>')}` : ''}
      </div>
    `;
    
    loadReaders();
    toast(`成功导入 ${result.success} 位读者`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
  
  event.target.value = '';
}

function resetReaderForm() {
  $('readerForm').reset(); $('readerId').value = ''; $('readerUsername').disabled = false;
}

function editReader(id) {
  const r = state.lastReaders.find(x => x.id === id);
  if (!r) return;
  $('readerId').value = r.id;
  $('readerUsername').value = r.username;
  $('readerUsername').disabled = true;
  $('readerPassword').value = '';
  $('readerFullName').value = r.full_name;
  $('readerStatus').value = r.status;
  $('readerPhone').value = r.phone;
  $('readerEmail').value = r.email;
  $('readerDepartment').value = r.department;
}

async function deleteReader(id) {
  if (!confirm('确认删除该读者？存在未还图书时不允许删除。')) return;
  try { await api(`/api/readers/${id}`, { method: 'DELETE' }); toast('删除成功', 'success'); loadReaders(); loadBorrowOptions(); }
  catch (e) { toast(e.message, 'error'); }
}

async function loadBorrowOptions() {
  const books = await api('/api/books?page=1&page_size=100');
  $('borrowBook').innerHTML = books.items.map(b => `<option value="${b.id}">${escapeHtml(b.title)}（可借 ${b.available_count}）</option>`).join('');
  if (state.user.role === 'admin') {
    const readers = await api('/api/readers?page=1&page_size=100');
    $('borrowReader').innerHTML = readers.items.map(r => `<option value="${r.id}">${escapeHtml(r.full_name)} / ${escapeHtml(r.username)}</option>`).join('');
  }
}

async function loadRecords() {
  const status = encodeURIComponent($('recordStatus').value || '');
  const keyword = encodeURIComponent($('recordKeyword').value || '');
  const data = await api(`/api/borrow-records?status=${status}&keyword=${keyword}&page=${state.recordPage}&page_size=8`);
  $('recordPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  
  // 生成操作按钮
  const getActionButtons = (r) => {
    if (r.status === 'returned') {
      // 显示罚金信息和缴纳按钮
      if (r.fine_amount && r.fine_amount > 0) {
        if (r.fine_paid) {
          return `<span class="badge success">已缴纳 ${r.fine_amount}元</span>`;
        } else {
          return `<span class="badge error">罚金 ${r.fine_amount}元</span><button class="primary small" onclick="payFine(${r.id})">缴纳</button>`;
        }
      }
      return '-';
    }
    const overdueDays = Math.max(0, Math.round(r.overdue_days || 0));
    const actions = [];
    if (currentUserCanReturn(r)) {
      actions.push(`<button class="primary small" onclick="returnBook(${r.id})">归还</button>`);
    }
    if (currentUserCanRenew(r)) {
      actions.push(`<button class="ghost small" onclick="renewBook(${r.id})">续借</button>`);
    }
    if (overdueDays > 0) {
      actions.push(`<span class="badge error">逾期${overdueDays}天</span>`);
    }
    return actions.join('');
  };
  
  const currentUserCanReturn = (r) => {
    return state.user.role !== 'reader' || r.reader_id === state.user.id;
  };
  
  const currentUserCanRenew = (r) => {
    return state.user.role !== 'reader' || r.reader_id === state.user.id;
  };
  
  $('recordTable').innerHTML = `<thead><tr><th>ID</th><th>图书</th><th>读者</th><th>借出日期</th><th>应还日期</th><th>归还日期</th><th>逾期天数</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.book_title)}</td><td>${escapeHtml(r.reader_name)}</td><td>${r.borrow_date}</td><td>${r.due_date}</td><td>${r.return_date || '-'}</td><td>${Math.max(0, Math.round(r.overdue_days || 0))}</td><td>${statusBadge(r.status)}</td><td>${getActionButtons(r)}</td></tr>`).join('')}
  </tbody>`;
}

async function returnBook(recordId) {
  if (!confirm('确认归还这本书？')) return;
  try { await api(`/api/borrow-records/${recordId}/return`, { method: 'PATCH' }); toast('归还成功，库存已恢复', 'success'); loadRecords(); loadDashboard(); }
  catch (e) { toast(e.message, 'error'); }
}

async function renewBook(recordId) {
  const days = prompt('请输入续借天数（1-90天）：', '15');
  if (!days || isNaN(days) || parseInt(days) < 1 || parseInt(days) > 90) {
    toast('请输入有效的续借天数', 'error');
    return;
  }
  try { 
    await api(`/api/borrow-records/${recordId}/renew`, { method: 'PATCH', body: JSON.stringify({ days: parseInt(days) }) }); 
    toast(`续借成功，已延长${days}天`, 'success'); 
    loadRecords(); 
  }
  catch (e) { toast(e.message, 'error'); }
}

async function payFine(recordId) {
  if (!confirm('确认缴纳罚金？')) return;
  try { 
    const result = await api(`/api/borrow-records/${recordId}/pay-fine`, { method: 'POST' }); 
    toast(result.message, 'success'); 
    loadRecords(); 
  }
  catch (e) { toast(e.message, 'error'); }
}

state.reservationPage = 1;

async function loadReservations() {
  const status = encodeURIComponent($('reservationStatus').value || '');
  const keyword = encodeURIComponent($('reservationKeyword').value || '');
  const data = await api(`/api/reservations?status=${status}&keyword=${keyword}&page=${state.reservationPage}&page_size=8`);
  $('reservationPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  
  const statusMap = { pending: '待处理', notified: '已通知', cancelled: '已取消' };
  
  $('reservationTable').innerHTML = `<thead><tr><th>ID</th><th>图书</th><th>库存</th><th>读者</th><th>预约日期</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.book_title)}</td><td>${r.available_count}/${r.total_count}</td><td>${escapeHtml(r.reader_name)}</td><td>${r.reserve_date}</td><td>${statusMap[r.status] || r.status}</td><td>${renderReservationActions(r)}</td></tr>`).join('') || '<tr><td colspan="7">暂无预约记录</td></tr>'}
  </tbody>`;
}

function renderReservationActions(reservation) {
  if (reservation.status === 'pending') {
    if (state.user.role === 'admin' || state.user.role === 'librarian') {
      const hasStock = reservation.available_count > 0;
      const notifyBtnClass = hasStock ? 'btn primary small' : 'btn small ghost';
      const notifyBtnText = hasStock ? '📚 通知读者' : '通知读者';
      return `<button class="${notifyBtnClass}" onclick="notifyReservation(${reservation.id})">${notifyBtnText}</button> <button class="btn danger small" onclick="cancelReservation(${reservation.id})">取消预约</button>`;
    }
    return `<button class="btn danger small" onclick="cancelReservation(${reservation.id})">取消预约</button>`;
  }
  return '-';
}

async function notifyReservation(reservationId) {
  if (!confirm('确认通知读者前来取书？')) return;
  try { 
    await api(`/api/reservations/${reservationId}/notify`, { method: 'POST' }); 
    toast('通知已发送', 'success'); 
    loadReservations(); 
  }
  catch (e) { toast(e.message, 'error'); }
}

async function cancelReservation(reservationId) {
  if (!confirm('确认取消这个预约？')) return;
  try { 
    await api(`/api/reservations/${reservationId}`, { method: 'DELETE' }); 
    toast('预约已取消', 'success'); 
    loadReservations(); 
  }
  catch (e) { toast(e.message, 'error'); }
}

state.messagePage = 1;

async function loadMessages() {
  const [messages, unreadCount] = await Promise.all([
    api(`/api/messages?page=${state.messagePage}&page_size=10`),
    api('/api/messages/unread-count')
  ]);
  
  $('messagePageText').textContent = `第 ${messages.page} 页 / 共 ${Math.max(1, Math.ceil(messages.total / messages.page_size))} 页`;
  $('unreadCount').innerHTML = unreadCount.count > 0 ? `<span class="unread-badge">${unreadCount.count} 未读</span>` : '';
  
  if (messages.items.length === 0) {
    $('messageList').innerHTML = '<p style="text-align: center; color: var(--muted-foreground); padding: 40px;">暂无消息</p>';
    return;
  }
  
  $('messageList').innerHTML = messages.items.map(msg => `
    <div class="message-item ${msg.read === 0 ? 'unread' : ''}" onclick="markMessageRead(${msg.id})">
      <div class="message-header">
        <span class="message-title">${escapeHtml(msg.title)}</span>
        <span class="message-time">${msg.created_at}</span>
      </div>
      <p class="message-content">${escapeHtml(msg.content)}</p>
      <span class="message-type ${msg.type}">${getMessageTypeLabel(msg.type)}</span>
    </div>
  `).join('');
}

function getMessageTypeLabel(type) {
  const typeMap = {
    'info': '通知',
    'reservation': '预约',
    'borrow': '借阅',
    'overdue': '逾期'
  };
  return typeMap[type] || type;
}

async function markMessageRead(messageId) {
  try {
    await api(`/api/messages/${messageId}/read`, { method: 'PATCH' });
    loadMessages();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function markAllMessagesRead() {
  if (!confirm('确认将所有消息标记为已读？')) return;
  try {
    await api('/api/messages/read-all', { method: 'PATCH' });
    toast('所有消息已标记为已读', 'success');
    loadMessages();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadReportView() {
  state.currentReport = null;
  $('reportPreview').innerHTML = '<p>请点击"生成报告"查看当前读者的阅读汇总。</p>';
  if (state.user.role === 'admin') {
    await loadReportReaders();
  }
}

// 逾期相关函数
async function loadOverdue() {
  const sort = encodeURIComponent(currentOverdueSort || '');
  const keyword = encodeURIComponent(overdueKeyword || '');
  const data = await api(`/api/overdue?sort=${sort}&keyword=${keyword}&page=${overduePage}&page_size=8`);
  
  $('overduePageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  
  // 更新统计信息
  const items = data.items || [];
  const total = data.total || 0;
  const within7Days = items.filter(r => r.overdue_days > 0 && r.overdue_days <= 7).length;
  const over14Days = items.filter(r => r.overdue_days > 14).length;
  const totalFine = items.reduce((sum, r) => sum + (r.fine_amount || 0), 0);
  
  $('overdueTotal').textContent = total;
  $('overdue7Days').textContent = within7Days;
  $('overdue14Days').textContent = over14Days;
  $('overdueTotalFine').textContent = `¥${totalFine.toFixed(2)}`;
  
  $('overdueTable').innerHTML = `
    <thead>
      <tr>
        <th><input type="checkbox" id="selectAllOverdue" onclick="toggleSelectAllOverdue()" /></th>
        <th>记录ID</th>
        <th>图书</th>
        <th>读者</th>
        <th>借出日期</th>
        <th>应还日期</th>
        <th>逾期天数</th>
        <th>预估罚金</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${items.map(r => `
        <tr>
          <td><input type="checkbox" class="overdue-checkbox" value="${r.id}" /></td>
          <td>${r.id}</td>
          <td>${escapeHtml(r.book_title)}</td>
          <td>${escapeHtml(r.reader_name)}</td>
          <td>${r.borrow_date}</td>
          <td>${r.due_date}</td>
          <td class="${r.overdue_days > 14 ? 'text-danger' : r.overdue_days > 7 ? 'text-warning' : ''}">${Math.round(r.overdue_days)}</td>
          <td>${r.fine_amount ? `<span class="text-danger">¥${r.fine_amount.toFixed(2)}</span>` : '-'}</td>
          <td>${statusBadge(r.status)}</td>
          <td>
            <button class="btn small primary" onclick="notifyReminder(${r.id})">发送通知</button>
            <button class="btn small ghost" onclick="viewOverdueDetail(${r.id})">详情</button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="10">暂无逾期记录</td></tr>'}
    </tbody>
  `;
  
  $('reminderMessages').innerHTML = data.messages ? data.messages.map(m => `
    <div class="reminder-message">
      <h4>📌 提醒 ${m.id}</h4>
      <p>${escapeHtml(m.message)}</p>
      <small>${m.created_at}</small>
    </div>
  `).join('') : '<p class="text-muted">暂无提醒消息</p>';
}

function toggleSelectAllOverdue() {
  const checkboxes = document.querySelectorAll('.overdue-checkbox');
  checkboxes.forEach(cb => cb.checked = $('selectAllOverdue').checked);
}

async function batchNotify() {
  const checkboxes = document.querySelectorAll('.overdue-checkbox:checked');
  if (checkboxes.length === 0) {
    toast('请选择要发送通知的逾期记录', 'warning');
    return;
  }
  
  if (!confirm(`确认给选中的 ${checkboxes.length} 位读者发送逾期提醒通知？`)) return;
  
  try {
    const ids = Array.from(checkboxes).map(cb => cb.value);
    await api('/api/reminders/batch-notify', { 
      method: 'POST', 
      body: JSON.stringify({ record_ids: ids }) 
    });
    toast(`已成功发送 ${checkboxes.length} 条通知！`, 'success');
    loadOverdue();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function viewOverdueDetail(recordId) {
  try {
    const record = await api(`/api/borrow-records/${recordId}`);
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>逾期记录详情</h3>
          <button onclick="this.parentElement.parentElement.parentElement.remove()">×</button>
        </div>
        <div class="modal-body">
          <table class="detail-table">
            <tr><td>图书</td><td>${escapeHtml(record.book_title)}</td></tr>
            <tr><td>ISBN</td><td>${record.isbn}</td></tr>
            <tr><td>读者</td><td>${escapeHtml(record.reader_name)}</td></tr>
            <tr><td>借出日期</td><td>${record.borrow_date}</td></tr>
            <tr><td>应还日期</td><td>${record.due_date}</td></tr>
            <tr><td>逾期天数</td><td class="text-danger">${Math.round(record.overdue_days)} 天</td></tr>
            <tr><td>预估罚金</td><td class="text-danger">¥${(record.fine_amount || 0).toFixed(2)}</td></tr>
            <tr><td>状态</td><td>${statusBadge(record.status)}</td></tr>
          </table>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" onclick="this.parentElement.parentElement.parentElement.remove()">关闭</button>
          <button class="btn primary" onclick="notifyReminder(${record.id}); this.parentElement.parentElement.parentElement.remove();">发送通知</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function notifyReminder(recordId) {
  if (!confirm('确认发送提醒通知给读者？')) return;
  
  try {
    await api(`/api/borrow-records/${recordId}/notify`, { method: 'POST' });
    toast('通知发送成功！', 'success');
    loadOverdue();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadRecommendations() {
  try {
    const recs = await api('/api/recommendations');
    
    renderRecommendation('recCategory', recs.by_category);
    renderRecommendation('recPopular', recs.by_popular);
    renderRecommendation('recRating', recs.by_rating);
    renderRecommendation('recDepartment', recs.by_department);
  } catch (e) {
    console.error('Failed to load recommendations:', e);
  }
}

function renderRecommendation(containerId, items) {
  const container = $(containerId);
  if (!items || items.length === 0) {
    container.innerHTML = '<p style="color: #94a3b8; font-size: 13px;">暂无推荐数据</p>';
    return;
  }
  container.innerHTML = items.map(book => `
    <div class="rec-item">
      <strong>${escapeHtml(book.title)}</strong>
      <div>${escapeHtml(book.author)} · ${escapeHtml(book.category)}</div>
      <div style="color: #94a3b8; font-size: 12px;">ISBN: ${escapeHtml(book.isbn)}</div>
    </div>
  `).join('');
}

async function loadReportReaders() {
  const data = await api('/api/readers?page=1&page_size=100');
  $('reportReader').innerHTML = '<option value="">请选择读者</option>' + data.items.map(r => `<option value="${r.id}">${escapeHtml(r.full_name)} / ${escapeHtml(r.username)}</option>`).join('');
}

async function loadReport() {
  try {
    let url = '/api/reports/reader';
    if (state.user.role === 'admin') {
      const readerId = $('reportReader').value;
      if (!readerId) return toast('请选择要生成报告的读者', 'error');
      url += `?reader_id=${readerId}`;
    }
    const report = await api(url);
    state.currentReport = report;
    renderReport(report);
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderReport(report) {
  const summary = report.summary;
  const rows = report.records;
  const summaryHtml = `
    <div class="report-summary">
      <div><strong>读者：</strong>${escapeHtml(report.reader_name)} / ${escapeHtml(report.reader_username)}</div>
      <div><strong>院系：</strong>${escapeHtml(report.department)}</div>
      <div><strong>生成时间：</strong>${escapeHtml(report.generated_at)}</div>
      <div><strong>总借阅次数：</strong>${summary.total_borrowed}</div>
      <div><strong>当前借阅：</strong>${summary.currently_borrowed}</div>
      <div><strong>已逾期：</strong>${summary.overdue}</div>
      <div><strong>已归还：</strong>${summary.returned}</div>
      <div><strong>累计阅读天数：</strong>${summary.total_reading_days} 天</div>
      <div><strong>平均借阅时长：</strong>${summary.average_borrow_duration_days} 天</div>
      <div><strong>平均归还时长：</strong>${summary.average_return_duration_days} 天</div>
    </div>
  `;
  const tableHtml = rows.length ? `
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>书名</th><th>ISBN</th><th>借出</th><th>应还</th><th>归还</th><th>状态</th><th>借阅天数</th><th>逾期</th></tr></thead><tbody>
      ${rows.map(item => `<tr><td>${item.id}</td><td>${escapeHtml(item.book_title)}</td><td>${escapeHtml(item.isbn)}</td><td>${item.borrow_date}</td><td>${item.due_date}</td><td>${item.return_date || '-'}</td><td>${statusBadge(item.status)}</td><td>${item.borrow_duration_days}</td><td>${Math.max(item.overdue_days, 0)}</td></tr>`).join('')}
    </tbody></table></div>
  ` : '<p>当前读者暂无借阅记录。</p>';
  $('reportPreview').innerHTML = summaryHtml + tableHtml;
}

function downloadReport() {
  if (!state.currentReport) return toast('请先生成报告再下载', 'error');
  const report = state.currentReport;
  const csvEscape = (value) => {
    const text = String(value ?? '');
    if (/[",\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const summaryRows = [
    ['读者', `${report.reader_name} / ${report.reader_username}`],
    ['院系', report.department],
    ['生成时间', report.generated_at],
    ['总借阅次数', report.summary.total_borrowed],
    ['当前借阅', report.summary.currently_borrowed],
    ['已逾期', report.summary.overdue],
    ['已归还', report.summary.returned],
    ['累计阅读天数', `${report.summary.total_reading_days} 天`],
    ['平均借阅时长', `${report.summary.average_borrow_duration_days} 天`],
    ['平均归还时长', `${report.summary.average_return_duration_days} 天`],
  ];

  const recordHeader = ['记录ID', '书名', 'ISBN', '借出日期', '应还日期', '归还日期', '状态', '借阅天数', '逾期天数'];
  const recordLines = report.records.map(item => [
    item.id,
    item.book_title,
    item.isbn,
    item.borrow_date,
    item.due_date,
    item.return_date || '-',
    item.status,
    item.borrow_duration_days,
    Math.max(item.overdue_days, 0),
  ].map(csvEscape).join(','));

  const csvContent = summaryRows.map(row => row.map(csvEscape).join(',')).join('\r\n')
    + '\r\n\r\n' + recordHeader.map(csvEscape).join(',')
    + '\r\n' + recordLines.join('\r\n');

  downloadCsv(`读书报告-${report.reader_username || report.reader_name}.csv`, csvContent);
}

function downloadCsv(filename, text) {
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// 公告管理功能
async function loadAnnouncements() {
  const status = encodeURIComponent($('announcementStatus').value || '');
  const data = await api(`/api/announcements?status=${status}&page=${state.announcementPage}&page_size=8`);
  $('announcementTotalText').textContent = `共 ${data.total} 条`;
  $('announcementPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  
  const statusMap = { published: '已发布', draft: '草稿', archived: '已归档' };
  $('announcementTable').innerHTML = `
    <thead><tr><th>ID</th><th>标题</th><th>内容预览</th><th>发布人</th><th>状态</th><th>发布时间</th><th>操作</th></tr></thead>
    <tbody>${data.items.map(item => `
      <tr>
        <td>${item.id}</td>
        <td>${escapeHtml(item.title)}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.content)}</td>
        <td>${escapeHtml(item.admin_name || '系统')}</td>
        <td><span class="badge ${item.status}">${statusMap[item.status] || item.status}</span></td>
        <td>${item.created_at}</td>
        <td>
          ${state.user.role === 'admin' ? `
            <div class="row-actions">
              <button class="ghost" onclick="editAnnouncement(${item.id})">编辑</button>
              <button class="danger" onclick="deleteAnnouncement(${item.id})">删除</button>
            </div>
          ` : ''}
        </td>
      </tr>`).join('')}</tbody>`;
}

function resetAnnouncementForm() {
  $('announcementForm').reset();
  $('announcementId').value = '';
  $('announcementFormTitle').textContent = '发布公告';
}

async function editAnnouncement(id) {
  try {
    const item = await api(`/api/announcements/${id}`);
    $('announcementId').value = item.id;
    $('announcementTitle').value = item.title;
    $('announcementContent').value = item.content;
    $('announcementStatusSelect').value = item.status;
    $('announcementFormTitle').textContent = `编辑公告 #${item.id}`;
    toast('已填入表单，可修改后保存');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function deleteAnnouncement(id) {
  if (!confirm('确认删除该公告？')) return;
  try {
    await api(`/api/announcements/${id}`, { method: 'DELETE' });
    toast('删除成功', 'success');
    loadAnnouncements();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 操作日志功能
async function loadAuditLogs() {
  const action = encodeURIComponent($('auditAction').value || '');
  const data = await api(`/api/audit-logs?action=${action}&page=${state.auditPage}&page_size=20`);
  $('auditPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  
  const actionMap = {
    LOGIN: '登录', CREATE: '创建', UPDATE: '更新', DELETE: '删除',
    BORROW: '借阅', RETURN: '归还', RESET_PASSWORD: '重置密码'
  };
  
  $('auditTable').innerHTML = `
    <thead><tr><th>ID</th><th>用户</th><th>操作</th><th>目标类型</th><th>目标ID</th><th>详情</th><th>时间</th></tr></thead>
    <tbody>${data.items.map(item => `
      <tr>
        <td>${item.id}</td>
        <td>${escapeHtml(item.username || '未知')}</td>
        <td><span class="badge borrowed">${actionMap[item.action] || item.action}</span></td>
        <td>${escapeHtml(item.target_type)}</td>
        <td>${item.target_id || '-'}</td>
        <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.details)}</td>
        <td>${item.timestamp}</td>
      </tr>`).join('')}</tbody>`;
}

async function exportAuditLogs() {
  try {
    const action = encodeURIComponent($('auditAction').value || '');
    const csv = await api(`/api/audit-logs/export?action=${action}`);
    downloadCsv('操作日志.csv', csv);
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Event bindings
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
    state.token = data.token; state.user = data.user; localStorage.setItem('library_token', state.token); toast('登录成功', 'success'); showApp();
  } catch (err) { toast(err.message, 'error'); }
});
$('logoutBtn').addEventListener('click', () => logout(true));
document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('bookSearchBtn').addEventListener('click', () => { state.bookPage = 1; loadBooks(); });
$('categoryFilter').addEventListener('change', () => { state.bookPage = 1; loadBooks(); });
$('bookPrev').addEventListener('click', () => { if (state.bookPage > 1) { state.bookPage--; loadBooks(); } });
$('bookNext').addEventListener('click', () => { state.bookPage++; loadBooks(); });
$('importBooksBtn').addEventListener('click', () => $('importBooksFile').click());
$('importBooksFile').addEventListener('change', importBooks);
$('resetBookForm').addEventListener('click', resetBookForm);
$('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    isbn: $('bookIsbn').value, title: $('bookTitle').value, author: $('bookAuthor').value, publisher: $('bookPublisher').value,
    category: $('bookCategory').value, total_count: Number($('bookTotal').value), available_count: $('bookAvailable').value === '' ? null : Number($('bookAvailable').value), shelf_location: $('bookShelf').value, description: $('bookDescription').value,
  };
  if (payload.available_count !== null && payload.available_count > payload.total_count) return toast('可借数量不能大于馆藏总数', 'error');
  try {
    const id = $('bookId').value;
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/books/${id}` : '/api/books';
    await api(url, { method, body: JSON.stringify(payload) });
    toast(id ? '更新成功' : '新增成功', 'success');
    resetBookForm(); loadBooks();
  } catch (e) { toast(e.message, 'error'); }
});
$('readerSearchBtn').addEventListener('click', () => loadReaders());
$('exportReadersBtn').addEventListener('click', exportReaders);
$('importReadersBtn').addEventListener('click', () => $('importReadersFile').click());
$('importReadersFile').addEventListener('change', handleImportReaders);
$('readerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('readerId').value;
  const payload = {
    username: $('readerUsername').value, password: $('readerPassword').value, full_name: $('readerFullName').value,
    status: $('readerStatus').value, phone: $('readerPhone').value, email: $('readerEmail').value, department: $('readerDepartment').value,
  };
  if (!id && !payload.password) return toast('新增读者密码不能为空', 'error');
  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/readers/${id}` : '/api/readers';
    await api(url, { method, body: JSON.stringify(payload) });
    toast(id ? '更新成功' : '新增成功', 'success');
    resetReaderForm(); loadReaders(); loadBorrowOptions();
  } catch (e) { toast(e.message, 'error'); }
});
$('recordSearchBtn').addEventListener('click', () => { state.recordPage = 1; loadRecords(); });
$('recordPrev').addEventListener('click', () => { if (state.recordPage > 1) { state.recordPage--; loadRecords(); } });
$('recordNext').addEventListener('click', () => { state.recordPage++; loadRecords(); });
$('reservationSearchBtn').addEventListener('click', () => { state.reservationPage = 1; loadReservations(); });
$('reservationStatus').addEventListener('change', () => { state.reservationPage = 1; loadReservations(); });
$('reservationPrev').addEventListener('click', () => { if (state.reservationPage > 1) { state.reservationPage--; loadReservations(); } });
$('reservationNext').addEventListener('click', () => { state.reservationPage++; loadReservations(); });
$('markAllReadBtn').addEventListener('click', markAllMessagesRead);
$('messagePrev').addEventListener('click', () => { if (state.messagePage > 1) { state.messagePage--; loadMessages(); } });
$('messageNext').addEventListener('click', () => { state.messagePage++; loadMessages(); });
$('borrowForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { book_id: Number($('borrowBook').value), borrow_days: Number($('borrowDays').value), remark: $('borrowRemark').value };
  if (state.user.role === 'admin') payload.reader_id = Number($('borrowReader').value);
  try { await api('/api/borrow-records', { method: 'POST', body: JSON.stringify(payload) }); toast('借书成功', 'success'); loadRecords(); loadDashboard(); }
  catch (e) { toast(e.message, 'error'); }
});
$('generateReportBtn').addEventListener('click', loadReport);
$('downloadReportBtn').addEventListener('click', downloadReport);
$('refreshOverdueBtn').addEventListener('click', () => { overduePage = 1; loadOverdue(); });
$('overdueSort').addEventListener('change', (e) => { currentOverdueSort = e.target.value; loadOverdue(); });
$('overdueKeyword').addEventListener('input', (e) => { overdueKeyword = e.target.value; });
$('overdueKeyword').addEventListener('keypress', (e) => { if (e.key === 'Enter') { overduePage = 1; loadOverdue(); } });
$('generateRemindersBtn').addEventListener('click', async () => {
  if (!confirm('确认要生成提醒消息吗？')) return;
  
  try {
    await api('/api/reminders/generate', { method: 'POST' });
    toast('提醒消息生成成功！', 'success');
    loadOverdue();
  } catch (e) { toast(e.message, 'error'); }
});
$('batchNotifyBtn').addEventListener('click', batchNotify);
$('exportOverdueBtn').addEventListener('click', async () => {
  const sort = encodeURIComponent(currentOverdueSort || '');
  const keyword = encodeURIComponent(overdueKeyword || '');
  
  try {
    const data = await api(`/api/overdue?sort=${sort}&keyword=${keyword}&page=1&page_size=10000`);
    const csv = Papa.unparse(data.items);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'overdue_records.csv';
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (e) {
    toast(e.message, 'error');
  }
});
$('exportBooksBtn').addEventListener('click', async () => {
  try { const csv = await api(`/api/books/export?search=${encodeURIComponent($('bookSearch').value || '')}&category=${encodeURIComponent($('categoryFilter').value || '')}`); downloadCsv('图书列表.csv', csv); }
  catch (e) { toast(e.message, 'error'); }
});
$('exportRecordsBtn').addEventListener('click', async () => {
  try { const csv = await api(`/api/borrow-records/export?status=${encodeURIComponent($('recordStatus').value || '')}&keyword=${encodeURIComponent($('recordKeyword').value || '')}`); downloadCsv('借还记录.csv', csv); }
  catch (e) { toast(e.message, 'error'); }
});
if ($('resetReaderForm')) $('resetReaderForm').addEventListener('click', resetReaderForm);

// 公告管理事件绑定
$('listAnnouncementsBtn').addEventListener('click', () => { state.announcementPage = 1; loadAnnouncements(); });
$('announcementStatus').addEventListener('change', () => { state.announcementPage = 1; loadAnnouncements(); });
$('announcementPrev').addEventListener('click', () => { if (state.announcementPage > 1) { state.announcementPage--; loadAnnouncements(); } });
$('announcementNext').addEventListener('click', () => { state.announcementPage++; loadAnnouncements(); });
$('resetAnnouncementForm').addEventListener('click', resetAnnouncementForm);
$('announcementForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('announcementId').value;
  const payload = {
    title: $('announcementTitle').value,
    content: $('announcementContent').value,
    status: $('announcementStatusSelect').value,
  };
  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/announcements/${id}` : '/api/announcements';
    await api(url, { method, body: JSON.stringify(payload) });
    toast(id ? '更新成功' : '发布成功', 'success');
    resetAnnouncementForm();
    loadAnnouncements();
  } catch (e) {
    toast(e.message, 'error');
  }
});

// 操作日志事件绑定
$('searchAuditBtn').addEventListener('click', () => { state.auditPage = 1; loadAuditLogs(); });
$('auditAction').addEventListener('change', () => { state.auditPage = 1; loadAuditLogs(); });
$('auditPrev').addEventListener('click', () => { if (state.auditPage > 1) { state.auditPage--; loadAuditLogs(); } });
$('auditNext').addEventListener('click', () => { state.auditPage++; loadAuditLogs(); });
$('exportAuditBtn').addEventListener('click', exportAuditLogs);

// 登录注册相关函数
function showLoginPage() {
  $('loginCard').classList.remove('hidden');
  $('registerCard').classList.add('hidden');
  $('forgotPasswordCard').classList.add('hidden');
}

function showRegisterPage() {
  $('loginCard').classList.add('hidden');
  $('registerCard').classList.remove('hidden');
  $('forgotPasswordCard').classList.add('hidden');
}

function showForgotPasswordPage() {
  $('loginCard').classList.add('hidden');
  $('registerCard').classList.add('hidden');
  $('forgotPasswordCard').classList.remove('hidden');
}

function startCodeTimer(btnId, seconds = 60) {
  const btn = $(btnId);
  let count = seconds;
  btn.disabled = true;
  btn.textContent = `${count}秒后重发`;
  const timer = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = '发送验证码';
    } else {
      btn.textContent = `${count}秒后重发`;
    }
  }, 1000);
}

async function handleRegister(e) {
  e.preventDefault();
  const username = $('registerUsername').value;
  const password = $('registerPassword').value;
  
  if (!username || !password) {
    return toast('请填写用户名和密码', 'error');
  }
  if (password.length < 6) {
    return toast('密码至少6位', 'error');
  }
  
  try {
    await api('/api/auth/register', { 
      method: 'POST', 
      body: JSON.stringify({ username, password }) 
    });
    toast('注册成功，请登录', 'success');
    showLoginPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const username = $('forgotUsername').value;
  const newPassword = $('forgotNewPassword').value;
  
  if (!username || !newPassword) {
    return toast('请填写用户名和新密码', 'error');
  }
  if (newPassword.length < 6) {
    return toast('密码至少6位', 'error');
  }
  
  try {
    await api('/api/auth/forgot-password', { 
      method: 'POST', 
      body: JSON.stringify({ username, new_password: newPassword }) 
    });
    toast('密码重置成功，请登录', 'success');
    showLoginPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function showChangePasswordModal() {
  $('changePasswordModal').classList.remove('hidden');
}

function closeChangePasswordModal() {
  $('changePasswordModal').classList.add('hidden');
  $('oldPassword').value = '';
  $('newPassword').value = '';
  $('confirmNewPassword').value = '';
}

async function confirmChangePassword() {
  const oldPassword = $('oldPassword').value;
  const newPassword = $('newPassword').value;
  const confirmPassword = $('confirmNewPassword').value;
  
  if (!oldPassword || !newPassword || !confirmPassword) {
    return toast('请填写完整信息', 'error');
  }
  if (newPassword.length < 6) {
    return toast('新密码至少6位', 'error');
  }
  if (newPassword !== confirmPassword) {
    return toast('两次输入的密码不一致', 'error');
  }
  
  try {
    await api('/api/auth/change-password', { 
      method: 'POST', 
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }) 
    });
    toast('密码修改成功', 'success');
    closeChangePasswordModal();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 登录注册事件绑定
$('registerLink').addEventListener('click', showRegisterPage);
$('forgotPasswordLink').addEventListener('click', showForgotPasswordPage);
$('backToLoginFromRegister').addEventListener('click', showLoginPage);
$('backToLoginFromForgot').addEventListener('click', showLoginPage);
$('registerForm').addEventListener('submit', handleRegister);
$('forgotPasswordForm').addEventListener('submit', handleForgotPassword);
$('changePasswordBtn').addEventListener('click', showChangePasswordModal);

// Initialize on page load
window.addEventListener('DOMContentLoaded', initAuth);

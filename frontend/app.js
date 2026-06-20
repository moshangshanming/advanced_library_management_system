﻿﻿console.log('app.js loaded');
const API_BASE_URL = window.location.origin; // 动态获取当前页面地址，避免 localhost/127.0.0.1 不一致问题
const state = {
  token: localStorage.getItem('library_token') || '',
  user: null,
  bookPage: 1,
  recordPage: 1,
  announcementPage: 1,
  auditPage: 1,
  lastBooks: [],
  lastRecords: [], // 借还记录
  lastReaders: [],
  currentReport: null,
  dashboardTimeRange: 7, // 默认近7天
};

const $ = (id) => document.getElementById(id);

// 导航分组折叠/展开
function toggleNavGroup(header) {
  header.classList.toggle('expanded');
  const content = header.nextElementSibling;
  if (content) {
    content.style.display = header.classList.contains('expanded') ? 'block' : 'none';
  }
}

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
    try { 
      const errorData = await response.json();
      detail = errorData.detail || errorData.message || detail;
      if (typeof detail !== 'string') {
        detail = JSON.stringify(detail) || '请求失败';
      }
    } catch (_) {}
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
  document.querySelectorAll('.reader-only').forEach(el => el.classList.toggle('hidden', state.user.role !== 'reader'));
  updateUnreadBadge();
  switchView('dashboard');
}

// 更新侧边栏未读消息角标
async function updateUnreadBadge() {
  try {
    const result = await api('/api/messages/unread-count');
    const badge = $('sidebarUnreadBadge');
    if (badge) {
      if (result.count > 0) {
        badge.textContent = result.count > 99 ? '99+' : result.count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
  } catch (e) {
    console.error('获取未读消息数量失败:', e);
  }
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

// 通用确认弹窗
let confirmCallback = null;

function showConfirmModal(message, callback) {
  $('confirmMessage').textContent = message;
  confirmCallback = callback;
  $('confirmModal').classList.remove('hidden');
}

function closeConfirmModal() {
  $('confirmModal').classList.add('hidden');
  confirmCallback = null;
}

function handleConfirmOk() {
  if (confirmCallback) {
    confirmCallback();
  }
  closeConfirmModal();
}

// 绑定确认弹窗确定按钮事件
$('confirmOkBtn')?.addEventListener('click', handleConfirmOk);

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
  } else if (viewName === 'overdue' && state.user.role === 'reader') {
    // 读者端逾期提醒页面副标题
    $('pageTitle').textContent = '逾期提醒';
    $('pageSubtitle').textContent = '您当前存在逾期借阅图书，请尽快归还结清罚金。';
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
  if (viewName === 'reports') {
    loadReportView();
    loadRecommendations();
    initReportPageEvents();
  }
  if (viewName === 'overdue') loadOverdue();
  if (viewName === 'announcements') loadAnnouncements();
  if (viewName === 'audit') loadAuditLogs();
}

async function loadDashboard() {
  // 显示加载状态
  $('categoryChartLoading').classList.remove('hidden');
  $('trendChartLoading').classList.remove('hidden');
  $('trendEmptyMessage').classList.add('hidden');

  try {
    const [overview, category, trend, topBooks] = await Promise.all([
      api('/api/stats/overview'),
      api('/api/stats/category'),
      api(`/api/stats/borrow-trend?days=${state.dashboardTimeRange}`),
      api('/api/stats/top-books')
    ]);

    // 渲染数据卡片（带点击跳转和辅助信息）
    renderMetricCards(overview);

    // 绘制图表
    drawPie('categoryChart', category.items);
    $('categoryChartLoading').classList.add('hidden');

    // 处理趋势图
    if (trend.items && trend.items.length > 0) {
      drawBar('trendChart', trend.items);
      $('trendEmptyMessage').classList.add('hidden');
    } else {
      // 空状态提示
      const canvas = $('trendChart');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#999';
      ctx.font = '14px "Source Sans 3", sans-serif';
      ctx.fillText(`暂无近 ${state.dashboardTimeRange} 天借阅数据`, canvas.width/2-100, canvas.height/2);
      $('trendEmptyMessage').classList.remove('hidden');
    }
    $('trendChartLoading').classList.add('hidden');

    // 更新趋势图标题
    $('trendPeriodText').textContent = `近 ${state.dashboardTimeRange} 天`;

    // 热门图书
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
        <button class="btn primary small" onclick="event.stopPropagation(); quickBorrow(${item.id})">借阅</button>
      </div>
    `).join('') : '<p>暂无借阅数据</p>';
  } catch (error) {
    console.error('加载仪表盘失败:', error);
    toast('加载数据失败', 'error');
    $('categoryChartLoading').classList.add('hidden');
    $('trendChartLoading').classList.add('hidden');
  }
}

// 渲染数据卡片（带点击跳转和辅助信息）
function renderMetricCards(overview) {
  const cards = [
    {
      label: '馆藏图书',
      value: overview.book_total ?? '—',
      subtitle: overview.new_books_this_month ? `本月新增 ${overview.new_books_this_month} 本` : '',
      view: 'books'
    },
    {
      label: '读者数量',
      value: overview.reader_total ?? '—',
      subtitle: overview.new_readers_this_month ? `本月新增 ${overview.new_readers_this_month} 人` : '',
      view: state.user.role !== 'reader' ? 'readers' : null
    },
    {
      label: '借阅中',
      value: overview.borrowed,
      subtitle: overview.overdue ? `逾期 ${overview.overdue} 本` : '',
      view: 'records'
    },
    {
      label: '已逾期',
      value: overview.overdue,
      subtitle: '',
      isWarning: overview.overdue > 0,
      view: 'overdue'
    },
    {
      label: '已归还',
      value: overview.returned,
      subtitle: '',
      view: 'records'
    }
  ];

  $('metricGrid').innerHTML = cards.map((card, index) => `
    <div class="metric-card ${card.isWarning ? 'overdue-warning' : ''}" data-view="${card.view}" data-index="${index}">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
      ${card.subtitle ? `<span class="metric-subtitle">${card.subtitle}</span>` : ''}
    </div>
  `).join('');

  // 添加点击事件
  document.querySelectorAll('.metric-card').forEach((card, index) => {
    card.addEventListener('click', function() {
      const viewName = this.dataset.view;
      if (viewName && viewName !== 'null') {
        switchView(viewName);
      }
    });
  });
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

  // 根据图例数量动态调整饼图位置
  const maxLegendWidth = Math.max(...sortedItems.map(item => item.name.length)) * 8 + 60;
  const hasEnoughSpace = width - (110 + 70 + 15) > maxLegendWidth;

  // 如果空间不足，缩小饼图并左移
  const cx = hasEnoughSpace ? 110 : 90;
  const cy = height / 2;
  const r = hasEnoughSpace ? 70 : 60;

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

  // 右侧图例 - 优化布局和字体大小
  const legendX = cx + r + 15;
  const availableWidth = width - legendX - 10;

  // 根据可用宽度调整字体大小
  const legendPaddingY = 10;
  const baseFontSize = availableWidth < 150 ? 10 : 11;
  const maxLineHeight = baseFontSize + 8;
  const lineHeight = Math.max(12, Math.min(maxLineHeight, Math.floor((height - legendPaddingY * 2) / sortedItems.length)));
  const fontSize = Math.min(baseFontSize, Math.max(9, lineHeight - 6));
  const boxSize = fontSize + 2;

  const legendHeight = sortedItems.length * lineHeight;
  const legendStartY = Math.max(legendPaddingY, cy - legendHeight / 2);
  ctx.font = `bold ${fontSize}px "Source Sans 3", sans-serif`;

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const y = legendStartY + i * lineHeight;

    // 绘制颜色框
    ctx.fillStyle = colors[i];
    ctx.fillRect(legendX, y, boxSize, boxSize);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.strokeRect(legendX, y, boxSize, boxSize);

    // 绘制文字 - 如果太长则截断
    let labelText = `${item.name}: ${item.value}`;
    const textWidth = ctx.measureText(labelText).width;
    if (textWidth > availableWidth - boxSize - 8) {
      // 截断文字
      const maxNameLength = Math.floor((availableWidth - boxSize - 30) / 8);
      const shortName = item.name.length > maxNameLength ? item.name.substring(0, maxNameLength) + '...' : item.name;
      labelText = `${shortName}: ${item.value}`;
    }

    ctx.fillStyle = '#333333';
    ctx.fillText(labelText, legendX + boxSize + 6, y + fontSize);
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

  const pad = { left: 45, right: 20, top: 20, bottom: 40 };
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

  // 计算日期标签的显示间隔，避免过于密集
  const labelInterval = items.length > 14 ? 3 : items.length > 7 ? 2 : 1;

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

    // X轴日期 - 根据间隔显示，避免过于密集
    if (i % labelInterval === 0 || i === items.length - 1) {
      ctx.save();
      ctx.translate(x + barW/2, height - pad.bottom + 10);
      ctx.rotate(-Math.PI / 6); // 旋转30度
      ctx.fillStyle = '#666666';
      ctx.font = '9px "Source Sans 3", sans-serif';
      let label = items[i].day;
      if (label.length > 5) label = label.slice(5);
      ctx.textAlign = 'right';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
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
  const data = await api(`/api/books?search=${search}&category=${category}&page=${state.bookPage}&page_size=9`);
  state.lastBooks = data.items;
  $('bookTotalText').textContent = `共 ${data.total} 本`;
  $('bookPageText').textContent = `第 ${data.page} 页 / 共 ${Math.max(1, Math.ceil(data.total / data.page_size))} 页`;
  $('categoryFilter').innerHTML = '<option value="">全部分类</option>' + data.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('categoryFilter').value = decodeURIComponent(category);

  // 更新导出按钮状态
  const exportBtn = $('exportBooksBtn');
  if (exportBtn) {
    if (data.total === 0) {
      exportBtn.disabled = true;
      exportBtn.style.opacity = '0.5';
      exportBtn.title = '暂无数据可导出';
    } else {
      exportBtn.disabled = false;
      exportBtn.style.opacity = '1';
      exportBtn.title = '';
    }
  }

  // 加载下拉选项（分类、出版社、书架）
  await loadDropdownOptions();

  // 卡片式展示
  $('bookGrid').innerHTML = data.items.length > 0 ? data.items.map(book => `
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
          <button class="primary small" onclick="showBookDetail(${book.id})">详情</button>
          <button class="primary small" onclick="quickBorrow(${book.id})">借阅</button>
          <button class="ghost small" onclick="quickReserve(${book.id})">预约</button>
          ${state.user.role === 'admin' || state.user.role === 'librarian' ? `<button class="ghost small" onclick="editBook(${book.id})">编辑</button><button class="danger small" onclick="deleteBook(${book.id})">删除</button>` : ''}
        </div>
      </div>
    </div>
  `).join('') : '<div class="empty-state"><p>暂无匹配图书</p></div>';
}

// 加载下拉选择框选项
async function loadDropdownOptions() {
  try {
    // 从后端获取统计数据以获取分类列表
    const categoryData = await api('/api/stats/category');
    const categories = categoryData.items.map(item => item.name);

    // 从图书列表中获取唯一的出版社和书架位置
    const publishers = [...new Set(state.lastBooks.map(b => b.publisher).filter(p => p))];
    const shelves = [...new Set(state.lastBooks.map(b => b.shelf_location).filter(s => s))];

    // 填充分类下拉框
    const categorySelect = $('bookCategory');
    if (categorySelect) {
      const currentValue = categorySelect.value;
      categorySelect.innerHTML = '<option value="">请选择分类</option>' +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      categorySelect.value = currentValue;
    }

    // 填充出版社下拉框
    const publisherSelect = $('bookPublisher');
    if (publisherSelect) {
      const currentValue = publisherSelect.value;
      publisherSelect.innerHTML = '<option value="">请选择或输入</option>' +
        publishers.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
      publisherSelect.value = currentValue;
    }

    // 填充书架位置下拉框
    const shelfSelect = $('bookShelf');
    if (shelfSelect) {
      const currentValue = shelfSelect.value;
      shelfSelect.innerHTML = '<option value="">请选择书架</option>' +
        shelves.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
      shelfSelect.value = currentValue;
    }
  } catch (e) {
    console.error('加载下拉选项失败:', e);
  }
}

// 清除下拉框选择
function clearSelect(selectId) {
  const select = $(selectId);
  if (select) {
    select.value = '';
  }
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
  $('bookForm').reset(); $('bookId').value = ''; $('bookFormTitle').textContent = '新增图书'; $('bookPrice').value = '';
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
    $('detailStock').textContent = `可借：${book.available_count} / 馆藏：${book.total_count}`;
    
    const description = book.description || '暂无简介';
    $('detailDescription').textContent = description;
    state.currentDetailDescription = description;
    
    // 处理简介折叠
    const descBtn = $('toggleDescBtn');
    if (description.length > 500) {
      $('detailDescription').textContent = description.substring(0, 500) + '...';
      descBtn.textContent = '展开';
      descBtn.classList.remove('hidden');
    } else {
      descBtn.classList.add('hidden');
    }
    
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

    // 根据库存设置借阅和预约按钮状态
    const borrowBtn = $('detailBorrowBtn');
    const reserveBtn = $('detailReserveBtn');
    
    if (book.available_count > 0) {
      borrowBtn.textContent = '借阅';
      borrowBtn.disabled = false;
    } else {
      borrowBtn.textContent = '暂无可借库存';
      borrowBtn.disabled = true;
    }
    
    // 预约按钮始终显示
    reserveBtn.classList.remove('hidden');
    reserveBtn.disabled = false;

    // 保存当前书籍ID用于借阅/预约
    state.currentDetailBookId = bookId;

    $('bookDetailModal').classList.remove('hidden');
  } catch (e) {
    const errorMsg = typeof e.message === 'string' ? e.message : e.message?.detail || e.message?.message || JSON.stringify(e.message) || '加载失败';
    toast('加载图书详情失败: ' + errorMsg, 'error');
  }
}

function toggleDescription() {
  const descBtn = $('toggleDescBtn');
  const descElement = $('detailDescription');
  
  if (descBtn.textContent === '展开') {
    descElement.textContent = state.currentDetailDescription;
    descBtn.textContent = '收起';
  } else {
    descElement.textContent = state.currentDetailDescription.substring(0, 500) + '...';
    descBtn.textContent = '展开';
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
  const bookId = state.currentDetailBookId;
  if (!bookId) return;
  closeBookDetailModal();
  quickBorrow(bookId);
}

// 图书卡片预约按钮点击
async function quickReserve(bookId) {
  try {
    const bookData = await api(`/api/books/${bookId}`);
    
    if (!bookData) {
      toast('未找到该图书', 'error');
      return;
    }
    
    // 场景2：库存>0时提示可直接借阅（警告红底）
    if (bookData.available_count > 0) {
      toast('该书可直接借阅，无需预约', 'error');
      return;
    }
    
    // 库存=0时，先检查是否已预约
    try {
      const reservations = await api('/api/reservations?status=pending');
      const items = reservations.items || [];
      const existingReservation = items.find(r => r.book_id === bookId);
      
      if (existingReservation) {
        // 场景3：已预约过该书（警告红底）
        toast('您已预约本书，请勿重复操作', 'error');
        return;
      }
    } catch (e) {
      // 忽略检查错误，继续预约流程
      console.error('检查预约状态失败:', e);
    }
    
    // 场景1：直接提交预约（不再显示确认弹窗）
    try {
      const response = await fetch(`${API_BASE_URL}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({
          book_id: bookId,
          reader_id: state.user.id,
          phone: ''
        })
      });
      
      // 预约已提交（后端成功创建了预约记录）
      // 场景4：预约成功（金色成功底）
      toast('预约成功，可在预约通知中查看', 'success');
      try {
        await loadBooks();
      } catch (e) {
        console.error('刷新列表失败:', e);
      }
    } catch (e) {
      console.error('预约请求失败:', e);
      toast('请求失败，请稍后重试', 'error');
    }
  } catch (e) {
    console.error('预约流程外层错误:', e);
    // 场景5：预约提交失败
    toast('请求失败，请稍后重试', 'error');
  }
}

// 图书详情弹窗中的预约函数
async function reserveBookFromDetail() {
  if (!state.currentDetailBookId) return;
  
  try {
    const bookData = await api(`/api/books/${state.currentDetailBookId}`);
    
    if (!bookData) {
      toast('未找到该图书', 'error');
      return;
    }
    
    // 场景2：库存>0时提示可直接借阅（警告红底）
    if (bookData.available_count > 0) {
      toast('该书可直接借阅，无需预约', 'error');
      return;
    }
    
    // 库存=0时，先检查是否已预约
    try {
      const reservations = await api('/api/reservations?status=pending');
      const items = reservations.items || [];
      const existingReservation = items.find(r => r.book_id === state.currentDetailBookId);
      
      if (existingReservation) {
        // 场景3：已预约过该书（警告红底）
        toast('您已预约本书，请勿重复操作', 'error');
        return;
      }
    } catch (e) {
      // 忽略检查错误，继续预约流程
      console.error('检查预约状态失败:', e);
    }
    
    // 场景1：直接提交预约（不再显示确认弹窗）
    try {
      const response = await fetch(`${API_BASE_URL}/api/reservations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({
          book_id: state.currentDetailBookId,
          reader_id: state.user.id,
          phone: ''
        })
      });
      
      // 预约已提交（后端成功创建了预约记录）
      // 场景4：预约成功（金色成功底）
      toast('预约成功，可在预约通知中查看', 'success');
      closeBookDetailModal();
      try {
        await loadBooks();
      } catch (e) {
        console.error('刷新列表失败:', e);
      }
    } catch (e) {
      console.error('预约请求失败:', e);
      toast('请求失败，请稍后重试', 'error');
    }
  } catch (e) {
    console.error('预约流程外层错误:', e);
    toast('请求失败，请稍后重试', 'error');
  }
}

function editBook(id) {
  const book = state.lastBooks.find(x => x.id === id);
  if (!book) return;

  // 打开弹窗并填充数据
  openBookFormModal(book);
}

// 打开图书表单弹窗
function openBookFormModal(book = null) {
  $('bookFormModal').classList.remove('hidden');

  if (book) {
    // 编辑模式
    $('bookFormTitle').textContent = `编辑图书 #${book.id}`;
    $('bookId').value = book.id;
    $('bookIsbn').value = book.isbn;
    $('bookTitle').value = book.title;
    $('bookAuthor').value = book.author;
    $('bookPublisher').value = book.publisher || '';
    $('bookCategory').value = book.category;
    $('bookTotal').value = book.total_count;
    $('bookAvailable').value = book.available_count;
    $('bookPrice').value = book.price || 0;
    $('bookShelf').value = book.shelf_location || '';
    $('bookDescription').value = book.description || '';
    updateCharCount();
  } else {
    // 新增模式
    $('bookFormTitle').textContent = '新增图书';
    resetBookFormFields();
  }
}

// 关闭图书表单弹窗
function closeBookFormModal() {
  $('bookFormModal').classList.add('hidden');
  resetBookFormFields();
}

// 重置表单字段
function resetBookFormFields() {
  $('bookId').value = '';
  $('bookIsbn').value = '';
  $('bookTitle').value = '';
  $('bookAuthor').value = '';
  $('bookPublisher').value = '';
  $('bookPublisherCustom').value = '';
  $('bookCategory').value = '';
  $('bookCategoryCustom').value = '';
  $('bookTotal').value = '';
  $('bookAvailable').value = '';
  $('bookPrice').value = '';
  $('bookShelf').value = '';
  $('bookShelfCustom').value = '';
  $('bookDescription').value = '';
  updateCharCount();
}

// 提交图书表单
async function submitBookForm() {
  const bookId = $('bookId').value;
  const isbn = $('bookIsbn').value.trim();
  const title = $('bookTitle').value.trim();
  const author = $('bookAuthor').value.trim();
  const publisher = $('bookPublisherCustom').value.trim() || $('bookPublisher').value;
  const category = $('bookCategoryCustom').value.trim() || $('bookCategory').value;
  const total_count = parseInt($('bookTotal').value);
  const available_count = parseInt($('bookAvailable').value) || total_count;
  const price = parseFloat($('bookPrice').value) || 0;
  const shelf_location = $('bookShelfCustom').value.trim() || $('bookShelf').value;
  const description = $('bookDescription').value.trim();

  // 基本校验
  if (!isbn || !title || !author || !category || !total_count) {
    toast('请填写所有必填项', 'error');
    return;
  }

  // ISBN校验
  if (!validateISBN(isbn)) {
    toast('请输入10或13位有效ISBN', 'error');
    return;
  }

  // 库存校验
  if (!validateStock()) {
    toast('库存数量设置不正确', 'error');
    return;
  }

  const payload = {
    isbn,
    title,
    author,
    publisher,
    category,
    total_count,
    available_count,
    price,
    shelf_location,
    description
  };

  try {
    if (bookId) {
      // 编辑
      await api(`/api/books/${bookId}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast(`《${title}》更新成功`, 'success');
    } else {
      // 新增
      await api('/api/books', { method: 'POST', body: JSON.stringify(payload) });
      toast(`《${title}》新增成功`, 'success');
    }
    closeBookFormModal();
    loadBooks();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 更新字符计数
function updateCharCount() {
  const desc = $('bookDescription');
  const count = desc.value.length;
  const counter = desc.parentElement.querySelector('.char-count');
  if (counter) {
    counter.textContent = `${count}/500`;
  }
}

async function deleteBook(id) {
  showConfirmModal('确认删除该图书？未归还图书不允许删除。', async () => {
    try { 
      await api(`/api/books/${id}`, { method: 'DELETE' }); 
      toast('删除成功', 'success'); 
      loadBooks(); 
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

let pendingBorrowBookId = null;
let pendingBorrowCoverUrl = null;

// 格式化日期为YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 计算两个日期之间的天数差
function calculateDaysBetween(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// 更新借阅总天数（由日期变化触发）
function updateBorrowTotalDays() {
  const startDate = $('borrowStartDate').value;
  const endDate = $('borrowEndDate').value;
  
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 校验：结束日期不可早于开始日期
    if (end < start) {
      toast('结束日期不可早于开始日期', 'error');
      $('borrowEndDate').value = startDate;
      $('borrowTotalDays').value = 0;
      return;
    }
    
    const days = calculateDaysBetween(startDate, endDate);
    
    // 校验：总天数限制1~90天
    if (days < 1) {
      toast('借阅天数至少为1天', 'error');
      const newEndDate = new Date(start);
      newEndDate.setDate(newEndDate.getDate() + 1);
      $('borrowEndDate').value = formatDate(newEndDate);
      $('borrowTotalDays').value = 1;
      return;
    }
    
    if (days > 90) {
      toast('借阅天数最多为90天', 'error');
      const newEndDate = new Date(start);
      newEndDate.setDate(newEndDate.getDate() + 90);
      $('borrowEndDate').value = formatDate(newEndDate);
      $('borrowTotalDays').value = 90;
      return;
    }
    
    $('borrowTotalDays').value = days;
  } else {
    $('borrowTotalDays').value = '';
  }
}

// 更新借阅结束日期（由天数变化触发）
function updateBorrowEndDate() {
  const startDate = $('borrowStartDate').value;
  const daysInput = $('borrowTotalDays');
  const days = parseInt(daysInput.value);
  
  if (!startDate) {
    toast('请先选择借阅开始日期', 'error');
    daysInput.value = '';
    return;
  }
  
  if (isNaN(days) || days < 1) {
    toast('借阅天数至少为1天', 'error');
    daysInput.value = 1;
    const newEndDate = new Date(startDate);
    newEndDate.setDate(newEndDate.getDate() + 1);
    $('borrowEndDate').value = formatDate(newEndDate);
    return;
  }
  
  if (days > 90) {
    toast('借阅天数最多为90天', 'error');
    daysInput.value = 90;
    const newEndDate = new Date(startDate);
    newEndDate.setDate(newEndDate.getDate() + 90);
    $('borrowEndDate').value = formatDate(newEndDate);
    return;
  }
  
  const newEndDate = new Date(startDate);
  newEndDate.setDate(newEndDate.getDate() + days);
  $('borrowEndDate').value = formatDate(newEndDate);
}

async function quickBorrow(bookId) {
  try {
    const bookData = await api(`/api/books/${bookId}`);
    
    if (!bookData) {
      toast('未找到该图书', 'error');
      return;
    }
    
    if (bookData.available_count <= 0) {
      toast('暂无可借库存，可预约等候', 'error');
      return;
    }

    pendingBorrowBookId = bookId;
    const coverUrl = bookData.cover_image ? `/uploads/${bookData.cover_image}` : 
                     bookData.cover_url || '/static/placeholder-cover.png';
    pendingBorrowCoverUrl = coverUrl;
    
    $('borrowConfirmCover').src = pendingBorrowCoverUrl;
    $('borrowConfirmTitle').textContent = bookData.title;
    $('borrowConfirmAuthor').textContent = bookData.author;
    $('borrowConfirmStock').textContent = bookData.available_count;
    
    // 初始化日期选择器
    const today = new Date();
    const defaultEndDate = new Date(today);
    defaultEndDate.setDate(defaultEndDate.getDate() + 7);
    
    $('borrowStartDate').value = formatDate(today);
    $('borrowEndDate').value = formatDate(defaultEndDate);
    $('borrowTotalDays').value = 7;
    
    $('borrowConfirmModal').classList.remove('hidden');
  } catch (e) {
    const errorMsg = typeof e.message === 'string' ? e.message : 
                     e.message?.detail || e.message?.message || JSON.stringify(e.message) || '操作失败';
    toast(errorMsg, 'error');
  }
}

function closeBorrowConfirmModal() {
  $('borrowConfirmModal').classList.add('hidden');
  pendingBorrowBookId = null;
  pendingBorrowCoverUrl = null;
}

document.getElementById('borrowConfirmModal')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeBorrowConfirmModal();
  }
});

// 日期选择器联动事件
document.getElementById('borrowStartDate')?.addEventListener('change', updateBorrowTotalDays);
document.getElementById('borrowEndDate')?.addEventListener('change', updateBorrowTotalDays);
document.getElementById('borrowTotalDays')?.addEventListener('change', updateBorrowEndDate);

async function confirmBorrow() {
  if (!pendingBorrowBookId) return;

  const startDate = $('borrowStartDate').value;
  const endDate = $('borrowEndDate').value;
  const days = parseInt($('borrowTotalDays').value);
  
  if (!startDate || !endDate) {
    toast('请选择借阅日期', 'error');
    return;
  }
  
  if (isNaN(days) || days < 1 || days > 90) {
    toast('借阅天数必须是1-90之间的正整数', 'error');
    return;
  }

  const btn = $('confirmBorrowBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '借阅中...';

  try {
    const response = await api('/api/borrow-records', {
      method: 'POST',
      body: JSON.stringify({
        book_id: pendingBorrowBookId,
        days: days,
        remark: '',
        borrow_date: startDate
      })
    });

    closeBorrowConfirmModal();
    const bookTitle = response.title || response.book_title || '该书';
    toast(`借阅成功！\n《${bookTitle}》\n应还日期：${response.due_date}`, 'success');
    await loadBooks();

    if (state.user.role !== 'reader') {
      switchView('records');
    }
  } catch (e) {
    const errorMsg = typeof e.message === 'string' ? e.message : 
                     e.message?.detail || e.message?.message || JSON.stringify(e.message) || '借阅失败';
    toast(errorMsg, 'error');
    closeBorrowConfirmModal();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function calculateDueDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
      body: JSON.stringify({ new_password: newPassword })
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

// ========== 读者管理弹窗控制 ==========
function openReaderFormModal(reader = null) {
  $('readerFormTitle').textContent = reader ? '编辑读者' : '新增读者';
  $('readerId').value = reader ? reader.id : '';
  $('readerUsername').value = reader ? reader.username : '';
  $('readerPassword').value = '';
  $('readerConfirmPassword').value = '';
  $('readerFullName').value = reader ? reader.full_name : '';
  $('readerPhone').value = reader ? reader.phone : '';
  $('readerEmail').value = reader ? reader.email || '' : '';
  $('readerDepartment').value = reader ? reader.department || '' : '';
  $('readerDepartmentCustom').value = '';
  $('readerStatus').value = reader ? reader.status : 'active';

  // 清空验证错误
  document.querySelectorAll('#readerFormModal .validation-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });

  $('readerFormModal').classList.remove('hidden');
}

function closeReaderFormModal() {
  $('readerFormModal').classList.add('hidden');
}

async function submitReaderForm() {
  const id = $('readerId').value;
  const username = $('readerUsername').value;
  const password = $('readerPassword').value;
  const confirmPassword = $('readerConfirmPassword').value;
  const fullName = $('readerFullName').value;
  const phone = $('readerPhone').value;
  const email = $('readerEmail').value;
  const department = $('readerDepartment').value || $('readerDepartmentCustom').value;
  const status = $('readerStatus').value;

  // 表单校验
  if (!username) {
    toast('请输入用户名', 'error');
    return;
  }
  if (!id && !password) {
    toast('请输入密码', 'error');
    return;
  }
  if (password && password !== confirmPassword) {
    toast('两次输入的密码不一致', 'error');
    return;
  }
  if (password && password.length < 8) {
    toast('密码至少8位', 'error');
    return;
  }
  if (!fullName) {
    toast('请输入姓名', 'error');
    return;
  }
  if (!phone) {
    toast('请输入手机号', 'error');
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    toast('请输入有效的11位手机号', 'error');
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('请输入有效的邮箱地址', 'error');
    return;
  }

  try {
    const payload = {
      username,
      full_name: fullName,
      phone,
      email: email || null,
      department: department || null,
      status
    };

    if (id) {
      // 编辑读者
      if (password) {
        payload.password = password;
      }
      await api(`/api/readers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast(`读者「${fullName}」更新成功`, 'success');
    } else {
      // 新增读者
      payload.password = password;
      await api('/api/readers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast(`读者「${fullName}」新增成功`, 'success');
    }

    closeReaderFormModal();
    loadReaders();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ========== 借书登记弹窗控制 ==========
function openBorrowFormModal() {
  $('borrowOutDate').value = new Date().toISOString().split('T')[0];
  $('borrowDays').value = '30';
  $('borrowDueDate').value = '';
  $('borrowRemarkType').value = '';
  $('borrowRemark').value = '';

  // 加载图书和读者下拉框
  loadBorrowOptions();
  calculateDueDate();

  $('borrowFormModal').classList.remove('hidden');
}

function closeBorrowFormModal() {
  $('borrowFormModal').classList.add('hidden');
}

function calculateDueDate() {
  const outDate = $('borrowOutDate').value;
  const days = parseInt($('borrowDays').value) || 30;

  if (outDate) {
    const dueDate = new Date(outDate);
    dueDate.setDate(dueDate.getDate() + days);
    const year = dueDate.getFullYear();
    const month = String(dueDate.getMonth() + 1).padStart(2, '0');
    const day = String(dueDate.getDate()).padStart(2, '0');
    $('borrowDueDate').value = `${year}-${month}-${day}`;
  } else {
    $('borrowDueDate').value = '';
  }
}

async function submitBorrowForm() {
  const bookId = $('borrowBook').value;
  const readerId = $('borrowReader').value;
  const outDate = $('borrowOutDate').value;
  const days = parseInt($('borrowDays').value);
  const dueDate = $('borrowDueDate').value;
  const remarkType = $('borrowRemarkType').value;
  const remark = $('borrowRemark').value;

  // 表单校验
  if (!bookId) {
    toast('请选择借阅的图书', 'error');
    return;
  }
  if (!readerId) {
    toast('请选择读者', 'error');
    return;
  }
  if (!outDate) {
    toast('请选择借出日期', 'error');
    return;
  }
  if (days > 30) {
    toast('最长借阅天数为30天', 'error');
    return;
  }

  // 组合备注
  let fullRemark = remark;
  if (remarkType) {
    const typeMap = { teacher: '教师借阅', holiday: '学生假期借阅' };
    fullRemark = remark ? `${typeMap[remarkType]} - ${remark}` : typeMap[remarkType];
  }

  try {
    await api('/api/borrow-records', {
      method: 'POST',
      body: JSON.stringify({
        book_id: parseInt(bookId),
        reader_id: parseInt(readerId),
        borrow_date: outDate,
        days: days,
        remark: fullRemark || null
      })
    });

    // 获取图书和读者信息用于提示
    const bookSelect = $('borrowBook');
    const readerSelect = $('borrowReader');
    const bookTitle = bookSelect.options[bookSelect.selectedIndex]?.text.split('(')[0] || '图书';
    const readerName = readerSelect.options[readerSelect.selectedIndex]?.text.split('(')[0] || '读者';

    toast(`《${bookTitle}》已成功借给读者「${readerName}」，应还日期为 ${dueDate}`, 'success');
    closeBorrowFormModal();
    loadRecords();
    loadDashboard(); // 刷新仪表盘
  } catch (e) {
    toast(e.message, 'error');
  }
}

function resetReaderForm() {
  $('readerForm').reset(); $('readerId').value = ''; $('readerUsername').disabled = false;
}

// ========== 编辑读者弹窗函数 ==========
function openEditReaderModal(id) {
  const r = state.lastReaders.find(x => x.id === id);
  if (!r) return;
  
  // 保存原始数据用于清空恢复
  $('editReaderId').value = r.id;
  $('editReaderTitle').textContent = '编辑读者';
  
  // 填充表单
  $('editReaderUsername').value = r.username || '';
  $('editReaderFullName').value = r.full_name || '';
  $('editReaderPhone').value = r.phone || '';
  $('editReaderEmail').value = r.email || '';
  $('editReaderDepartment').value = r.department || '';
  $('editReaderRole').value = r.role || 'student';
  $('editReaderMaxDays').value = r.max_borrow_days || '';
  $('editReaderMaxBooks').value = r.max_books || '';
  
  // 清除验证错误
  clearValidationErrors('editReaderForm');
  
  // 显示弹窗
  $('editReaderModal').classList.remove('hidden');
}

function closeEditReaderModal() {
  $('editReaderModal').classList.add('hidden');
  clearValidationErrors('editReaderForm');
}

function resetEditReaderForm() {
  const id = parseInt($('editReaderId').value);
  const r = state.lastReaders.find(x => x.id === id);
  if (!r) return;
  
  // 恢复为原始数据
  $('editReaderFullName').value = r.full_name || '';
  $('editReaderPhone').value = r.phone || '';
  $('editReaderEmail').value = r.email || '';
  $('editReaderDepartment').value = r.department || '';
  $('editReaderRole').value = r.role || 'student';
  $('editReaderMaxDays').value = r.max_borrow_days || '';
  $('editReaderMaxBooks').value = r.max_books || '';
  
  clearValidationErrors('editReaderForm');
}

function clearValidationErrors(formId) {
  const form = $(formId);
  if (!form) return;
  form.querySelectorAll('.validation-error').forEach(el => el.textContent = '');
}

function showFieldError(input, message) {
  const errorEl = input.closest('label')?.querySelector('.validation-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

async function submitEditReader() {
  const id = parseInt($('editReaderId').value);
  const btn = $('submitEditReaderBtn');
  const originalText = btn.textContent;
  
  // 获取表单数据
  const fullName = $('editReaderFullName').value.trim();
  const phone = $('editReaderPhone').value.trim();
  const email = $('editReaderEmail').value.trim();
  const department = $('editReaderDepartment').value;
  const role = $('editReaderRole').value;
  const maxDays = $('editReaderMaxDays').value ? parseInt($('editReaderMaxDays').value) : null;
  const maxBooks = $('editReaderMaxBooks').value ? parseInt($('editReaderMaxBooks').value) : null;
  
  // 清除之前的错误
  clearValidationErrors('editReaderForm');
  
  // 表单校验
  let hasError = false;
  
  if (!fullName) {
    showFieldError($('editReaderFullName'), '姓名不能为空');
    hasError = true;
  }
  
  if (!phone) {
    showFieldError($('editReaderPhone'), '手机号不能为空');
    hasError = true;
  } else if (!/^1\d{10}$/.test(phone)) {
    showFieldError($('editReaderPhone'), '手机号必须为11位数字');
    hasError = true;
  }
  
  if (!department) {
    showFieldError($('editReaderDepartment'), '请选择院系');
    hasError = true;
  }
  
  if (hasError) return;
  
  // 显示加载状态
  btn.disabled = true;
  btn.textContent = '保存中...';
  
  try {
    await api(`/api/readers/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        full_name: fullName,
        phone: phone,
        email: email,
        department: department,
        role: role,
        max_borrow_days: maxDays,
        max_books: maxBooks
      })
    });
    
    toast('读者信息修改成功', 'success');
    closeEditReaderModal();
    loadReaders();
    loadBorrowOptions();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ========== 重置密码弹窗函数 ==========
function openResetPwdModal(id) {
  const r = state.lastReaders.find(x => x.id === id);
  if (!r) return;
  
  $('resetPwdReaderId').value = r.id;
  $('resetPwdUsername').value = r.username || '';
  $('resetPwdFullName').value = r.full_name || '';
  $('resetPwdNew').value = '';
  $('resetPwdConfirm').value = '';
  
  clearValidationErrors('resetPwdForm');
  $('resetPwdModal').classList.remove('hidden');
}

function closeResetPwdModal() {
  $('resetPwdModal').classList.add('hidden');
  clearValidationErrors('resetPwdForm');
}

async function submitResetPwd() {
  const btn = $('submitResetPwdBtn');
  const originalText = btn.textContent;
  
  const newPwd = $('resetPwdNew').value;
  const confirmPwd = $('resetPwdConfirm').value;
  
  clearValidationErrors('resetPwdForm');
  
  // 表单校验
  let hasError = false;
  
  if (!newPwd) {
    showFieldError($('resetPwdNew'), '请输入新密码');
    hasError = true;
  } else if (newPwd.length < 6) {
    showFieldError($('resetPwdNew'), '密码至少需要6位');
    hasError = true;
  }
  
  if (!confirmPwd) {
    showFieldError($('resetPwdConfirm'), '请再次输入新密码');
    hasError = true;
  } else if (newPwd !== confirmPwd) {
    showFieldError($('resetPwdConfirm'), '两次输入的密码不一致');
    hasError = true;
  }
  
  if (hasError) return;
  
  // 显示加载状态
  btn.disabled = true;
  btn.textContent = '重置中...';
  
  try {
    const readerId = parseInt($('resetPwdReaderId').value);
    await api(`/api/readers/${readerId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPwd })
    });
    
    toast('密码重置成功', 'success');
    closeResetPwdModal();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 兼容旧的函数名（如果其他地方有调用）
function editReader(id) {
  openEditReaderModal(id);
}

function resetReaderPassword(id) {
  openResetPwdModal(id);
}

async function deleteReader(id) {
  showConfirmModal('确认删除该读者？存在未还图书时不允许删除。', async () => {
    try { 
      await api(`/api/readers/${id}`, { method: 'DELETE' }); 
      toast('删除成功', 'success'); 
      loadReaders(); 
      loadBorrowOptions(); 
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
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
  state.lastRecords = data.items; // 保存记录以便二次确认时使用
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
  // 获取记录信息
  const record = state.lastRecords.find(r => r.id === recordId);
  const bookTitle = record ? record.book_title : '该图书';
  showConfirmModal(`确认归还《${bookTitle}》？`, async () => {
    try {
      await api(`/api/borrow-records/${recordId}/return`, { method: 'PATCH' });
      toast('归还成功，库存已恢复', 'success');
      loadRecords();
      loadDashboard();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

// 续借弹窗
let renewRecordId = null;

function showRenewModal(recordId, bookTitle) {
  renewRecordId = recordId;
  $('renewBookTitle').textContent = `《${bookTitle}》`;
  $('renewDays').value = '15';
  $('renewModal').classList.remove('hidden');
}

function closeRenewModal() {
  $('renewModal').classList.add('hidden');
  renewRecordId = null;
}

async function submitRenew() {
  const days = $('renewDays').value;
  if (!days || isNaN(days) || parseInt(days) < 1 || parseInt(days) > 90) {
    toast('请输入有效的续借天数（1-90天）', 'error');
    return;
  }
  
  try {
    const record = state.lastRecords.find(r => r.id === renewRecordId);
    const bookTitle = record ? record.book_title : '该图书';
    await api(`/api/borrow-records/${renewRecordId}/renew`, { 
      method: 'PATCH', 
      body: JSON.stringify({ days: parseInt(days) }) 
    });
    toast(`《${bookTitle}》续借成功，已延长${days}天`, 'success');
    loadRecords();
    closeRenewModal();
  } catch (e) { 
    toast(e.message, 'error'); 
  }
}

async function renewBook(recordId) {
  const record = state.lastRecords.find(r => r.id === recordId);
  const bookTitle = record ? record.book_title : '该图书';
  showRenewModal(recordId, bookTitle);
}

async function payFine(recordId) {
  showConfirmModal('确认缴纳罚金？', async () => {
    try {
      const result = await api(`/api/borrow-records/${recordId}/pay-fine`, { method: 'POST' });
      toast(result.message, 'success');
      loadRecords();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

state.reservationPage = 1;

async function loadReservations() {
  const status = encodeURIComponent($('reservationStatus').value || '');
  const keyword = encodeURIComponent($('reservationKeyword').value || '');
  const data = await api(`/api/reservations?status=${status}&keyword=${keyword}&page=${state.reservationPage}&page_size=8`);
  
  // 按ID降序排序，确保最新的预约在最前面
  data.items.sort((a, b) => b.id - a.id);
  
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
  showConfirmModal('确认通知读者前来取书？', async () => {
    try { 
      await api(`/api/reservations/${reservationId}/notify`, { method: 'POST' }); 
      toast('通知已发送', 'success'); 
      loadReservations(); 
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function cancelReservation(reservationId) {
  showConfirmModal('确认取消这个预约？', async () => {
    try {
      await api(`/api/reservations/${reservationId}`, { method: 'DELETE' });
      toast('预约已取消', 'success');
      loadReservations();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
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
    updateUnreadBadge();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function markAllMessagesRead() {
  showConfirmModal('确认将所有消息标记为已读？', async () => {
    try {
      await api('/api/messages/read-all', { method: 'PATCH' });
      toast('所有消息已标记为已读', 'success');
      loadMessages();
      updateUnreadBadge();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function loadReportView() {
  state.currentReport = null;
  $('reportPreview').innerHTML = '<p>请点击"生成报告"查看当前读者的阅读汇总。</p>';
  if (state.user.role === 'admin') {
    await loadReportReaders();
  }
}

// 逾期相关函数
let totalPages = 1;

async function loadOverdue() {
  try {
    const sort = encodeURIComponent(currentOverdueSort || '');
    const keyword = encodeURIComponent(overdueKeyword || '');

    // 先获取全部数据用于准确统计，再获取分页数据
    const [allData, pageData] = await Promise.all([
      api(`/api/overdue?sort=${sort}&keyword=${keyword}&page=1&page_size=10000`),
      api(`/api/overdue?sort=${sort}&keyword=${keyword}&page=${overduePage}&page_size=8`)
    ]);

    // 基于全部数据计算统计（不受分页影响）
    const allItems = allData.items || [];
    const total = allData.total || 0;
    const within7Days = allItems.filter(r => r.overdue_days > 0 && r.overdue_days <= 7).length;
    const over14Days = allItems.filter(r => r.overdue_days > 14).length;
    const totalFine = allItems.reduce((sum, r) => sum + (r.fine_amount || 0), 0);

    $('overdueTotal').textContent = total;
    $('overdue7Days').textContent = within7Days;
    $('overdue14Days').textContent = over14Days;
    $('overdueTotalFine').textContent = `¥${totalFine.toFixed(2)}`;

    const items = pageData.items || [];
    totalPages = Math.max(1, Math.ceil((pageData.total || 0) / pageData.page_size));

    // 更新分页控件
    $('overduePageText').textContent = `第 ${pageData.page} 页 / 共 ${totalPages} 页`;
    $('overduePrev').disabled = pageData.page <= 1;
    $('overdueNext').disabled = pageData.page >= totalPages;

    // 根据用户角色渲染不同的表格
    const isReader = state.user.role === 'reader';

    if (items.length === 0) {
      if (isReader) {
        // 读者端：精简表格
        $('overdueTable').innerHTML = `
          <thead>
            <tr>
              <th>图书名称</th>
              <th>借出日期</th>
              <th>应还日期</th>
              <th>逾期天数</th>
              <th>预估罚金</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colspan="6" style="text-align: center; padding: 40px; color: #94a3b8;">暂无逾期记录</td></tr>
          </tbody>
        `;
      } else {
        // 管理员/馆员：完整表格
        $('overdueTable').innerHTML = `
          <thead>
            <tr>
              <th>ID</th>
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
            <tr><td colspan="9" style="text-align: center; padding: 40px; color: #94a3b8;">暂无逾期记录</td></tr>
          </tbody>
        `;
      }
    } else {
      if (isReader) {
        // 读者端：精简表格
        $('overdueTable').innerHTML = `
          <thead>
            <tr>
              <th>图书名称</th>
              <th>借出日期</th>
              <th>应还日期</th>
              <th>逾期天数</th>
              <th>预估罚金</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(r => {
              const overdueDays = Math.round(r.overdue_days || 0);
              return `
              <tr>
                <td>${escapeHtml(r.book_title)}</td>
                <td>${r.borrow_date}</td>
                <td>${r.due_date}</td>
                <td class="${overdueDays > 14 ? 'text-danger' : overdueDays > 7 ? 'text-warning' : ''}">${overdueDays}</td>
                <td>${r.fine_amount ? `<span class="text-danger">¥${r.fine_amount.toFixed(2)}</span>` : '-'}</td>
                <td>${statusBadge(r.status)}</td>
              </tr>
              `}).join('')}
          </tbody>
        `;
      } else {
        // 管理员/馆员：完整表格
        $('overdueTable').innerHTML = `
          <thead>
            <tr>
              <th>ID</th>
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
            ${items.map(r => {
              const overdueDays = Math.round(r.overdue_days || 0);
              return `
              <tr>
                <td>${r.id}</td>
                <td>${escapeHtml(r.book_title)}</td>
                <td>${escapeHtml(r.reader_name)}</td>
                <td>${r.borrow_date}</td>
                <td>${r.due_date}</td>
                <td class="${overdueDays > 14 ? 'text-danger' : overdueDays > 7 ? 'text-warning' : ''}">${overdueDays}</td>
                <td>${r.fine_amount ? `<span class="text-danger">¥${r.fine_amount.toFixed(2)}</span>` : '-'}</td>
                <td>${statusBadge(r.status)}</td>
                <td>
                  <button class="primary small" onclick="notifyReminder(${r.id})">发送通知</button>
                </td>
              </tr>
              `}).join('')}
          </tbody>
        `;
      }
    }

    // 更新提醒消息区（移除 emoji 图标，用分隔线）
    if (pageData.messages && pageData.messages.length > 0) {
      $('reminderMessages').innerHTML = pageData.messages.map(m => `
        <div class="reminder-message">
          <div class="reminder-message-header">提醒 #${m.id}</div>
          <div class="reminder-message-body">${escapeHtml(m.message)}</div>
          <div class="reminder-message-time">${m.created_at}</div>
        </div>
      `).join('');
    } else {
      $('reminderMessages').innerHTML = '<div class="reminder-message" style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">暂无提醒消息</div>';
    }

    // 更新按钮状态
    updateOverdueButtonStates();
  } catch (error) {
    console.error('加载逾期数据失败:', error);
    toast('加载逾期数据失败，请刷新重试', 'error');
    // 显示空状态
    $('overdueTotal').textContent = '0';
    $('overdue7Days').textContent = '0';
    $('overdue14Days').textContent = '0';
    $('overdueTotalFine').textContent = '¥0.00';
    $('overdueTable').innerHTML = `
      <thead>
        <tr>
          <th>ID</th>
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
        <tr><td colspan="9" style="text-align: center; padding: 40px; color: #94a3b8;">加载失败，请检查网络连接或刷新页面</td></tr>
      </tbody>
    `;
  }
}

function updateOverdueButtonStates() {
  // 根据是否有逾期数据启用/禁用按钮
  const overdueRecords = document.querySelectorAll('#overdueTable tbody tr:not(:last-child)');
  const hasData = overdueRecords.length > 0 && !overdueRecords[0].querySelector('td[colspan="9"]');

  // 启用/禁用按钮
  if ($('batchNotifyBtn')) $('batchNotifyBtn').disabled = !hasData;
  if ($('generateRemindersBtn')) $('generateRemindersBtn').disabled = !hasData;
}

async function batchNotify() {
  showConfirmModal('确认给所有逾期读者发送提醒通知？', async () => {
    try {
      const data = await api('/api/reminders/generate', { method: 'POST' });
      toast(`已成功生成 ${data.created_count || 0} 条提醒消息`, 'success');
      loadOverdue();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function generateReminders() {
  try {
    const data = await api('/api/reminders/generate', { method: 'POST' });
    toast(`已成功生成 ${data.created_count || 0} 条提醒消息`, 'success');
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
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
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
          <button class="ghost" onclick="this.closest('.modal').remove()">关闭</button>
          ${record.status === 'overdue' ? `<button class="primary" onclick="notifyReminder(${record.id}); this.closest('.modal').remove();">发送通知</button>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function notifyReminder(recordId) {
  showConfirmModal('确认发送提醒通知给读者？', async () => {
    try {
      await api(`/api/borrow-records/${recordId}/notify`, { method: 'POST' });
      toast('通知发送成功！', 'success');
      loadOverdue();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function loadRecommendations() {
  try {
    // 检查当前用户是否为读者
    if (state.user.role !== 'reader') {
      // 管理员/馆员查看时，显示提示
      document.querySelectorAll('.rec-list').forEach(el => {
        el.innerHTML = '<p style="color: #94a3b8; font-size: 13px; padding: 20px; text-align: center;">💡 仅读者可查看个性化推荐</p>';
      });
      return;
    }

    const recs = await api('/api/recommendations');

    renderRecommendation('recCategory', recs.by_category, '根据您常借阅的图书分类推荐');
    renderRecommendation('recPopular', recs.by_popular, '热门借阅榜推荐');
    renderRecommendation('recDepartment', recs.by_department, '根据您的专业推荐');
  } catch (e) {
    console.error('Failed to load recommendations:', e);
    toast('加载推荐失败', 'error');
  }
}

function renderRecommendation(containerId, items, reason) {
  const container = $(containerId);

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #999;">
        <div style="font-size: 32px; margin-bottom: 10px;">📚</div>
        <p>暂无阅读数据，可先借阅图书获取个性化推荐</p>
        <button class="primary" style="margin-top: 12px;" onclick="switchView('books')">浏览热门图书</button>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(book => `
    <div class="rec-item">
      <strong>${escapeHtml(book.title)}</strong>
      <div class="rec-author">${escapeHtml(book.author)} · ${escapeHtml(book.category)}</div>
      <div style="color: #94a3b8; font-size: 12px;">ISBN: ${escapeHtml(book.isbn)}</div>
      <div class="rec-reason">${reason}</div>
      <div class="rec-actions">
        <button class="primary small" onclick="borrowRecommendedBook(${book.id})">借阅</button>
        <button class="ghost small" onclick="reserveRecommendedBook(${book.id})">预约</button>
      </div>
    </div>
  `).join('');
}

// 借阅推荐图书（直接调用借阅流程）
async function borrowRecommendedBook(bookId, bookTitle) {
  // 直接调用图书管理页面的借阅功能
  quickBorrow(bookId);
}

// 预约推荐图书（与图书管理页面预约逻辑一致）
async function reserveRecommendedBook(bookId) {
  // 直接调用图书管理页面的预约功能
  quickReserve(bookId);
}

async function loadReportReaders() {
  const data = await api('/api/readers?page=1&page_size=100');
  $('reportReader').innerHTML = '<option value="">请选择读者</option>' +
    data.items.map(r => `<option value="${r.id}">${escapeHtml(r.full_name)}（${escapeHtml(r.username)}${r.department ? '/' + escapeHtml(r.department) : ''}）</option>`).join('');
}

// 初始化报告页面事件监听
let reportEventsInitialized = false;

function initReportPageEvents() {
  // 防止重复绑定事件
  if (reportEventsInitialized) {
    console.log('Report events already initialized');
    return;
  }

  try {
    console.log('Initializing report page events...');

    // 检查必需的元素是否存在（reportReader可能在读者端不存在）
    const requiredElements = [
      'reportPeriod', 'generateReportBtn',
      'downloadReportCsvBtn', 'downloadReportPdfBtn'
    ];

    for (const id of requiredElements) {
      const el = $(id);
      if (!el) {
        console.error(`Element not found: ${id}`);
        throw new Error(`Required element '${id}' not found in DOM`);
      }
    }

    // 读者选择变化时更新按钮状态（仅在元素存在时绑定）
    const reportReaderEl = $('reportReader');
    if (reportReaderEl) {
      reportReaderEl.addEventListener('change', function() {
        updateReportButtonStates();
      });
    }

    // 报告周期变化时显示/隐藏自定义日期范围
    $('reportPeriod').addEventListener('change', function() {
      const customRanges = document.querySelectorAll('.custom-date-range');
      if (this.value === 'custom') {
        customRanges.forEach(el => el.classList.remove('hidden'));
      } else {
        customRanges.forEach(el => el.classList.add('hidden'));
      }
    });

    // 生成报告按钮
    $('generateReportBtn').addEventListener('click', async function() {
      await generateReportWithLoading();
    });

    // 快捷生成报告按钮
    const quickBtn = $('quickGenerateReportBtn');
    if (quickBtn) {
      quickBtn.addEventListener('click', async function() {
        if (state.user.role === 'reader') {
          // 读者端直接生成报告
          await generateReportWithLoading();
        } else {
          // 管理员端提示选择读者
          const readerSelect = $('reportReader');
          if (readerSelect) readerSelect.focus();
          toast('请先选择读者，然后点击「生成报告」');
        }
      });
    }

    // 下载CSV按钮 - 使用onclick确保能捕获点击
    $('downloadReportCsvBtn').onclick = function(e) {
      console.log('CSV button clicked');
      console.log('Current report state:', state.currentReport);

      if (!state.currentReport) {
        toast('请先生成报告', 'error');
        return;
      }

      try {
        downloadReportCSV();
      } catch (err) {
        console.error('CSV export error:', err);
        toast('导出失败: ' + err.message, 'error');
      }
    };

    // 下载PDF按钮
    $('downloadReportPdfBtn').onclick = function(e) {
      console.log('PDF button clicked');
      console.log('Current report state:', state.currentReport);

      if (!state.currentReport) {
        toast('请先生成报告', 'error');
        return;
      }

      try {
        downloadReportPDF();
      } catch (err) {
        console.error('PDF export error:', err);
        toast('导出失败: ' + err.message, 'error');
      }
    };

    // 初始化按钮状态（读者端启用生成按钮）
    updateReportButtonStates();

    reportEventsInitialized = true;
    console.log('Report page events initialized successfully');
  } catch (error) {
    console.error('Failed to initialize report page events:', error);
    // 重置标志，允许重试
    reportEventsInitialized = false;
  }
}

// 更新按钮状态
function updateReportButtonStates() {
  const hasReport = state.currentReport !== null;
  
  // 读者端（reader角色）生成报告按钮始终可用
  const isReader = state.user.role === 'reader';
  const readerSelect = $('reportReader');
  const hasReaderSelection = readerSelect && readerSelect.value;
  
  if (isReader) {
    $('generateReportBtn').disabled = false;
    $('generateReportBtn').title = '点击生成读书报告';
  } else {
    // 管理员/馆员端需要选择读者
    if (!hasReaderSelection) {
      $('generateReportBtn').disabled = true;
      $('generateReportBtn').title = '请先选择读者';
    } else {
      $('generateReportBtn').disabled = false;
      $('generateReportBtn').title = '点击生成读书报告';
    }
  }

  // 下载按钮：仅当报告生成成功后可点击
  $('downloadReportCsvBtn').title = hasReport ? '下载CSV格式报告' : '请先生成报告';
  $('downloadReportCsvBtn').style.opacity = hasReport ? '1' : '0.5';
  $('downloadReportCsvBtn').style.cursor = hasReport ? 'pointer' : 'not-allowed';

  $('downloadReportPdfBtn').title = hasReport ? '下载PDF格式报告' : '请先生成报告';
  $('downloadReportPdfBtn').style.opacity = hasReport ? '1' : '0.5';
  $('downloadReportPdfBtn').style.cursor = hasReport ? 'pointer' : 'not-allowed';
}

function getReportToastReaderName() {
  if (state.user.role === 'reader') {
    return state.user.username || state.user.full_name || '该读者';
  }

  const readerSelect = $('reportReader');
  if (readerSelect && readerSelect.options) {
    return readerSelect.options[readerSelect.selectedIndex]?.text || '该读者';
  }

  return state.user.username || state.user.full_name || '该读者';
}

// 带加载动画的报告生成
async function generateReportWithLoading() {
  // 读者端使用当前登录用户的ID，管理员端使用选择的读者ID
  let readerId = state.user.id;
  if (state.user.role === 'admin' || state.user.role === 'staff') {
    const readerSelect = $('reportReader');
    if (readerSelect) {
      readerId = readerSelect.value;
    }
  }
  
  if (!readerId) {
    toast('无法获取读者信息', 'error');
    return;
  }

  const btn = $('generateReportBtn');
  const originalText = '生成报告';

  try {
    // 显示加载状态
    btn.disabled = true;
    btn.textContent = '生成中...';

    let url = '/api/reports/reader';
    const params = [`reader_id=${readerId}`];

    // 添加时间范围参数
    const period = $('reportPeriod').value;
    if (period !== 'all') {
      params.push(`period=${period}`);

      if (period === 'custom') {
        const startDate = $('reportStartDate').value;
        const endDate = $('reportEndDate').value;
        if (startDate) params.push(`start_date=${startDate}`);
        if (endDate) params.push(`end_date=${endDate}`);
      }
    }

    if (params.length > 0) {
      url += '?' + params.join('&');
    }

    const report = await api(url);
    state.currentReport = report;
    state.currentReportPeriod = period; // 保存当前周期用于导出命名
    renderReport(report);
    updateReportButtonStates();

    const readerName = getReportToastReaderName();
    toast(`读者「${readerName}」的读书报告已生成，可在线预览或下载`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    // 恢复按钮状态
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function loadReport() {
  // 保留旧接口兼容性，但推荐使用 generateReportWithLoading
  await generateReportWithLoading();
}

function renderReport(report) {
  const summary = report.summary;
  const rows = report.records;

  // 计算趋势（与上一周期对比）
  const trendUp = '↑';
  const trendDown = '↓';

  // 核心数据卡片
  const cardsHtml = `
    <div class="report-summary-cards">
      <div class="summary-card">
        <div class="card-label">借阅总次数</div>
        <div class="card-value">${summary.total_borrowed}</div>
        <div class="card-trend">${trendUp} 活跃阅读</div>
      </div>
      <div class="summary-card">
        <div class="card-label">阅读总时长</div>
        <div class="card-value">${summary.total_reading_days}<span style="font-size:16px;color:#666;">天</span></div>
        <div class="card-trend">累计阅读天数</div>
      </div>
      <div class="summary-card">
        <div class="card-label">平均借阅天数</div>
        <div class="card-value">${summary.average_borrow_duration_days}<span style="font-size:16px;color:#666;">天</span></div>
        <div class="card-trend">每次借阅平均时长</div>
      </div>
      <div class="summary-card">
        <div class="card-label">逾期次数</div>
        <div class="card-value" style="color: ${summary.overdue > 0 ? '#ef4444' : '#10b981'};">${summary.overdue}</div>
        <div class="card-trend ${summary.overdue > 0 ? 'negative' : ''}">${summary.overdue > 0 ? '需注意逾期情况' : '无逾期记录'}</div>
      </div>
    </div>
  `;

  // 可视化图表区域
  const chartsHtml = `
    <div class="report-charts">
      <div class="chart-container">
        <h4>阅读分类占比</h4>
        <canvas id="reportCategoryChart" height="280"></canvas>
      </div>
      <div class="chart-container">
        <h4>近半年借阅趋势</h4>
        <canvas id="reportTrendChart" height="280"></canvas>
      </div>
    </div>
  `;

  // 明细列表
  const detailsHtml = `
    <div class="report-details">
      <h4>详细借阅记录</h4>
      
      <div class="detail-section">
        <h5>已借阅图书清单（共 ${rows.length} 本）</h5>
        ${rows.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>ID</th><th>书名</th><th>ISBN</th><th>借出</th><th>应还</th><th>归还</th><th>状态</th><th>借阅天数</th><th>逾期</th></tr></thead>
            <tbody>
              ${rows.map(item => `<tr>
                <td>${item.id}</td>
                <td>${escapeHtml(item.book_title)}</td>
                <td>${escapeHtml(item.isbn)}</td>
                <td>${item.borrow_date}</td>
                <td>${item.due_date}</td>
                <td>${item.return_date || '-'}</td>
                <td>${statusBadge(item.status)}</td>
                <td>${item.borrow_duration_days}</td>
                <td>${Math.max(item.overdue_days, 0)}</td>
              </tr>`).join('')}
            </tbody>
          </table></div>
        ` : '<p style="color: #999; padding: 20px;">暂无借阅记录</p>'}
      </div>
      
      <div class="detail-section">
        <h5>逾期记录汇总</h5>
        ${summary.overdue > 0 ? `
          <p style="padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px; color: #dc2626;">
            当前有 <strong>${summary.overdue}</strong> 条逾期记录，请及时归还图书以避免更多罚金。
          </p>
        ` : '<p style="color: #10b981; padding: 12px; background: rgba(16, 185, 129, 0.1); border-radius: 8px;">无逾期记录，保持良好的借阅习惯！</p>'}
      </div>
      
      <div class="detail-section">
        <h5>热门借阅分类</h5>
        <div id="reportCategoryStats" style="padding: 12px; background: var(--muted); border-radius: 8px;">
          <!-- 动态生成分类统计 -->
        </div>
      </div>
    </div>
  `;

  $('reportPreview').innerHTML = cardsHtml + chartsHtml + detailsHtml;

  // 绘制图表
  setTimeout(() => {
    drawReportCharts(rows);
    generateCategoryStats(rows);
  }, 100);
}

// 绘制报告图表
function drawReportCharts(rows) {
  // 1. 阅读分类占比饼图
  const categoryCount = {};
  rows.forEach(item => {
    const category = item.category || '未分类';
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });

  const categoryData = Object.entries(categoryCount).map(([name, value]) => ({ name, value }));
  if (categoryData.length > 0) {
    drawPie('reportCategoryChart', categoryData);
  }

  // 2. 近半年借阅趋势柱状图
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyCount = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyCount[key] = 0;
  }

  rows.forEach(item => {
    const borrowDate = new Date(item.borrow_date);
    if (borrowDate >= sixMonthsAgo) {
      const key = `${borrowDate.getFullYear()}-${String(borrowDate.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyCount.hasOwnProperty(key)) {
        monthlyCount[key]++;
      }
    }
  });

  const trendData = Object.entries(monthlyCount)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => ({ day, count }));

  if (trendData.length > 0) {
    drawBar('reportTrendChart', trendData);
  }
}

// 生成分类统计
function generateCategoryStats(rows) {
  const categoryCount = {};
  rows.forEach(item => {
    const category = item.category || '未分类';
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });

  const sorted = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5); // Top 5

  const container = $('reportCategoryStats');
  if (sorted.length === 0) {
    container.innerHTML = '<p style="color: #999;">暂无数据</p>';
    return;
  }

  container.innerHTML = sorted.map(([cat, count], idx) => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; ${idx < sorted.length - 1 ? 'border-bottom: 1px dashed var(--border);' : ''}">
      <span style="font-weight: 500;">${idx + 1}. ${escapeHtml(cat)}</span>
      <span style="color: var(--accent); font-weight: 600;">${count} 本</span>
    </div>
  `).join('');
}

function downloadReportCSV() {
  console.log('downloadReportCSV called');
  console.log('state.currentReport:', state.currentReport);

  if (!state.currentReport) {
    toast('请先生成报告再下载', 'error');
    return;
  }

  try {
    const report = state.currentReport;
    const summary = report.summary;
    const rows = report.records;
    const period = state.currentReportPeriod || 'all';

    // 获取周期中文名称
    const periodNames = {
      'all': '全部时间',
      '3months': '近3个月',
      '6months': '近半年',
      '1year': '近1年',
      'custom': '自定义'
    };
    const periodName = periodNames[period] || '全部时间';

    const csvEscape = (value) => {
      const text = String(value ?? '');
      if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    // 构建CSV内容
    const lines = [];

    // 标题行
    lines.push(['读书报告']);
    lines.push([]);

    // 基本信息
    lines.push(['读者信息']);
    lines.push(['读者姓名', report.reader_name]);
    lines.push(['用户名', report.reader_username]);
    lines.push(['院系', report.department]);
    lines.push(['报告周期', periodName]);
    lines.push(['生成时间', report.generated_at]);
    lines.push([]);

    // 统计数据
    lines.push(['统计汇总']);
    lines.push(['总借阅次数', summary.total_borrowed]);
    lines.push(['当前借阅', summary.currently_borrowed]);
    lines.push(['已逾期', summary.overdue]);
    lines.push(['已归还', summary.returned]);
    lines.push(['累计阅读天数', `${summary.total_reading_days} 天`]);
    lines.push(['平均借阅时长', `${summary.average_borrow_duration_days} 天`]);
    lines.push(['平均归还时长', `${summary.average_return_duration_days} 天`]);
    lines.push([]);

    // 分类统计
    const categoryCount = {};
    rows.forEach(item => {
      const category = item.category || '未分类';
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    });

    if (Object.keys(categoryCount).length > 0) {
      lines.push(['阅读分类统计']);
      lines.push(['分类', '数量']);
      Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .forEach(([cat, count]) => {
          lines.push([cat, count]);
        });
      lines.push([]);
    }

    // 借阅明细
    lines.push(['借阅明细']);
    lines.push(['记录ID', '书名', 'ISBN', '作者', '分类', '借出日期', '应还日期', '归还日期', '状态', '借阅天数', '逾期天数']);

    rows.forEach(item => {
      lines.push([
        item.id,
        item.book_title,
        item.isbn,
        item.author || '',
        item.category || '',
        item.borrow_date,
        item.due_date,
        item.return_date || '',
        item.status === 'borrowed' ? '借阅中' : item.status === 'returned' ? '已归还' : '已逾期',
        item.borrow_duration_days,
        Math.max(item.overdue_days, 0)
      ]);
    });

    // 转换为CSV格式
    const csvContent = lines.map(row => row.map(csvEscape).join(',')).join('\r\n');
    console.log('CSV content length:', csvContent.length);

    // 自动命名：[读者姓名]_[周期]读书报告.csv
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const filename = `${report.reader_name}_${periodName}_读书报告_${dateStr}.csv`;

    console.log('Downloading file:', filename);

    // 使用浏览器原生下载方法
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`报告已下载：${filename}`, 'success');
  } catch (err) {
    console.error('CSV export error:', err);
    toast('导出失败: ' + err.message, 'error');
    throw err;
  }
}

// PDF导出功能（使用浏览器打印功能模拟）
function downloadReportPDF() {
  console.log('downloadReportPDF called');
  console.log('state.currentReport:', state.currentReport);

  if (!state.currentReport) {
    toast('请先生成报告再下载', 'error');
    return;
  }

  toast('正在准备PDF导出...', 'info');

  // 创建打印窗口
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    toast('请允许弹出窗口以导出PDF', 'error');
    return;
  }

  const report = state.currentReport;
  const summary = report.summary;
  const rows = report.records;
  const period = state.currentReportPeriod || 'all';

  // 获取周期中文名称
  const periodNames = {
    'all': '全部时间',
    '3months': '近3个月',
    '6months': '近半年',
    '1year': '近1年',
    'custom': '自定义'
  };
  const periodName = periodNames[period] || '全部时间';

  // 计算分类统计
  const categoryCount = {};
  rows.forEach(item => {
    const category = item.category || '未分类';
    categoryCount[category] = (categoryCount[category] || 0) + 1;
  });

  const sortedCategories = Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // 生成HTML内容
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${report.reader_name} - 读书报告</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: "Microsoft YaHei", Arial, sans-serif; 
          padding: 40px; 
          max-width: 900px; 
          margin: 0 auto;
          color: #333;
          line-height: 1.6;
        }
        h1 { 
          color: #B8860B; 
          border-bottom: 3px solid #B8860B; 
          padding-bottom: 15px;
          margin-bottom: 30px;
          font-size: 28px;
        }
        h2 { 
          color: #333; 
          margin-top: 35px;
          margin-bottom: 20px;
          font-size: 20px;
          border-left: 4px solid #B8860B;
          padding-left: 12px;
        }
        h3 {
          font-size: 16px;
          margin-bottom: 12px;
          color: #555;
        }
        .info-section { 
          background: #f8f9fa; 
          padding: 20px; 
          border-radius: 8px; 
          margin-bottom: 25px;
          border: 1px solid #e9ecef;
        }
        .info-section p { 
          margin: 8px 0; 
          font-size: 14px;
        }
        .info-section strong {
          color: #555;
          display: inline-block;
          min-width: 100px;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          margin-bottom: 25px;
        }
        .stat-item {
          background: #fff;
          border: 1px solid #e9ecef;
          border-radius: 6px;
          padding: 15px;
          text-align: center;
        }
        .stat-label {
          font-size: 13px;
          color: #666;
          margin-bottom: 8px;
        }
        .stat-value {
          font-size: 28px;
          font-weight: bold;
          color: #B8860B;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-top: 15px;
          font-size: 13px;
        }
        th, td { 
          padding: 10px 8px; 
          border: 1px solid #dee2e6; 
          text-align: left;
        }
        th { 
          background: #f8f9fa; 
          font-weight: bold;
          color: #495057;
        }
        tr:nth-child(even) {
          background: #f8f9fa;
        }
        .badge { 
          padding: 4px 10px; 
          border-radius: 4px; 
          font-size: 12px;
          display: inline-block;
        }
        .badge.borrowed { 
          background: #dbeafe; 
          color: #1e40af; 
        }
        .badge.returned { 
          background: #dcfce7; 
          color: #166534; 
        }
        .badge.overdue { 
          background: #fee2e2; 
          color: #991b1b; 
        }
        .category-list {
          list-style: none;
          padding: 0;
        }
        .category-list li {
          padding: 8px 12px;
          border-bottom: 1px dashed #dee2e6;
          display: flex;
          justify-content: space-between;
        }
        .category-list li:last-child {
          border-bottom: none;
        }
        .page-break {
          page-break-before: always;
        }
        @media print { 
          body { padding: 20px; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>读书报告</h1>
      
      <div class="info-section">
        <p><strong>读者姓名：</strong>${escapeHtml(report.reader_name)}</p>
        <p><strong>用户名：</strong>${escapeHtml(report.reader_username)}</p>
        <p><strong>院系：</strong>${escapeHtml(report.department)}</p>
        <p><strong>报告周期：</strong>${periodName}</p>
        <p><strong>生成时间：</strong>${report.generated_at}</p>
      </div>
      
      <h2>阅读统计</h2>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-label">总借阅次数</div>
          <div class="stat-value">${summary.total_borrowed}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">当前借阅</div>
          <div class="stat-value">${summary.currently_borrowed}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">已逾期</div>
          <div class="stat-value" style="color: ${summary.overdue > 0 ? '#ef4444' : '#10b981'};">${summary.overdue}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">已归还</div>
          <div class="stat-value">${summary.returned}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">累计阅读天数</div>
          <div class="stat-value">${summary.total_reading_days}<span style="font-size:14px;">天</span></div>
        </div>
        <div class="stat-item">
          <div class="stat-label">平均借阅时长</div>
          <div class="stat-value">${summary.average_borrow_duration_days}<span style="font-size:14px;">天</span></div>
        </div>
      </div>
      
      ${sortedCategories.length > 0 ? `
        <h2>热门借阅分类</h2>
        <ul class="category-list">
          ${sortedCategories.map(([cat, count], idx) => `
            <li>
              <span>${idx + 1}. ${escapeHtml(cat)}</span>
              <strong style="color: #B8860B;">${count} 本</strong>
            </li>
          `).join('')}
        </ul>
      ` : ''}
      
      <div class="page-break"></div>
      
      <h2>借阅明细</h2>
      <table>
        <thead>
          <tr>
            <th>书名</th>
            <th>作者</th>
            <th>借出日期</th>
            <th>应还日期</th>
            <th>归还日期</th>
            <th>状态</th>
            <th>借阅天数</th>
            <th>逾期天数</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(item => `
            <tr>
              <td>${escapeHtml(item.book_title)}</td>
              <td>${escapeHtml(item.author || '-')}</td>
              <td>${item.borrow_date}</td>
              <td>${item.due_date}</td>
              <td>${item.return_date || '-'}</td>
              <td><span class="badge ${item.status}">${item.status === 'borrowed' ? '借阅中' : item.status === 'returned' ? '已归还' : '已逾期'}</span></td>
              <td>${item.borrow_duration_days}</td>
              <td>${Math.max(item.overdue_days, 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      
      <div class="no-print" style="margin-top: 30px; text-align: center;">
        <button onclick="window.print()" style="padding: 12px 30px; background: #B8860B; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">打印 / 另存为PDF</button>
      </div>
      
      <script>
        window.onload = function() { 
          setTimeout(function() {
            window.print();
          }, 500);
        }
      </script>
    </body>
    </html>
  `;

  printWindow.document.write(htmlContent);
  printWindow.document.close();
}

function downloadCsv(filename, text) {
  const blob = new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

// 公告管理功能
async function loadAnnouncements() {
  try {
    const status = encodeURIComponent($('announcementStatus').value || '');
    const data = await api(`/api/announcements?status=${status}&page=${state.announcementPage}&page_size=8`);
    $('announcementTotalText').textContent = `共 ${data.total} 条`;

    const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
    $('announcementPageText').textContent = `第 ${data.page} 页 / 共 ${totalPages} 页`;

    $('announcementPrev').disabled = data.page <= 1;
    $('announcementNext').disabled = data.page >= totalPages;

    const statusMap = { published: '已发布', draft: '草稿', archived: '已撤回' };

    // 根据状态生成操作按钮
    const getActionButtons = (item) => {
      if (state.user.role !== 'admin') {
        return `<button class="ghost small" onclick="viewAnnouncementDetail(${item.id})">查看</button>`;
      }

      let buttons = `<button class="ghost small" onclick="viewAnnouncementDetail(${item.id})">查看</button>`;
      buttons += `<button class="ghost small" onclick="editAnnouncement(${item.id})">编辑</button>`;

      // 已发布状态可以撤回
      if (item.status === 'published') {
        buttons += `<button class="ghost small" onclick="archiveAnnouncement(${item.id})">撤回</button>`;
      }

      // 草稿状态可以发布
      if (item.status === 'draft') {
        buttons += `<button class="primary small" onclick="publishAnnouncement(${item.id})">发布</button>`;
      }

      buttons += `<button class="danger small" onclick="deleteAnnouncement(${item.id})">删除</button>`;
      return buttons;
    };

    if (data.items.length === 0) {
      $('announcementTable').innerHTML = `
        <thead>
          <tr><th>ID</th><th>标题</th><th>内容预览</th><th>发布人</th><th>状态</th><th>发布时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr><td colspan="7" style="text-align: center; padding: 40px; color: #94a3b8;">暂无公告</td></tr>
        </tbody>
      `;
    } else {
      $('announcementTable').innerHTML = `
        <thead>
          <tr><th>ID</th><th>标题</th><th>内容预览</th><th>发布人</th><th>状态</th><th>发布时间</th><th>操作</th></tr>
        </thead>
        <tbody>${data.items.map(item => `
          <tr>
            <td>${item.id}</td>
            <td>${escapeHtml(item.title)}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.content)}</td>
            <td>${escapeHtml(item.admin_name || '系统')}</td>
            <td><span class="badge ${item.status}">${statusMap[item.status] || item.status}</span></td>
            <td>${item.created_at}</td>
            <td>${getActionButtons(item)}</td>
          </tr>
        `).join('')}</tbody>
      `;
    }
  } catch (error) {
    console.error('加载公告失败:', error);
    toast('加载公告失败，请刷新重试', 'error');
    $('announcementTable').innerHTML = `
      <thead>
        <tr><th>ID</th><th>标题</th><th>内容预览</th><th>发布人</th><th>状态</th><th>发布时间</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr><td colspan="7" style="text-align: center; padding: 40px; color: #94a3b8;">加载失败，请检查网络连接或刷新页面</td></tr>
      </tbody>
    `;
  }
}

function openAnnouncementModal() {
  $('announcementModal').classList.remove('hidden');
  $('announcementModalTitle').textContent = '发布公告';
  $('announcementId').value = '';
  $('announcementTitle').value = '';
  $('announcementContent').value = '';
  $('announcementCharCount').textContent = '0/1000字';
}

function closeAnnouncementModal() {
  $('announcementModal').classList.add('hidden');
}

function resetAnnouncementForm() {
  $('announcementForm').reset();
  $('announcementId').value = '';
  $('announcementCharCount').textContent = '0/1000字';
}

async function viewAnnouncementDetail(id) {
  try {
    const item = await api(`/api/announcements/${id}`);
    const statusMap = { published: '已发布', draft: '草稿', archived: '已撤回' };

    $('detailAnnouncementId').textContent = item.id;
    $('detailAnnouncementTitle').textContent = item.title;
    $('detailAnnouncementContent').textContent = item.content;
    $('detailAnnouncementAuthor').textContent = item.admin_name || '系统';
    $('detailAnnouncementStatus').innerHTML = `<span class="badge ${item.status}">${statusMap[item.status] || item.status}</span>`;
    $('detailAnnouncementTime').textContent = item.created_at;

    $('announcementDetailModal').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function closeAnnouncementDetailModal() {
  $('announcementDetailModal').classList.add('hidden');
}

async function editAnnouncement(id) {
  try {
    const item = await api(`/api/announcements/${id}`);
    $('announcementId').value = item.id;
    $('announcementTitle').value = item.title;
    $('announcementContent').value = item.content;
    $('announcementCharCount').textContent = `${item.content.length}/1000字`;
    $('announcementModalTitle').textContent = `编辑公告 #${item.id}`;
    $('announcementModal').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function archiveAnnouncement(id) {
  showConfirmModal('确认撤回该公告？撤回后读者将无法查看。', async () => {
    try {
      await api(`/api/announcements/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'archived' })
      });
      toast('公告已撤回', 'success');
      loadAnnouncements();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function publishAnnouncement(id) {
  showConfirmModal('确认发布该公告？发布后读者将可以查看。', async () => {
    try {
      await api(`/api/announcements/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'published' })
      });
      toast('公告已发布', 'success');
      loadAnnouncements();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function deleteAnnouncement(id) {
  showConfirmModal('确认删除该公告？此操作不可恢复。', async () => {
    try {
      await api(`/api/announcements/${id}`, { method: 'DELETE' });
      toast('删除成功', 'success');
      loadAnnouncements();
    } catch (e) { 
      toast(e.message, 'error'); 
    }
  });
}

async function saveAnnouncement(status) {
  const title = $('announcementTitle').value.trim();
  const content = $('announcementContent').value.trim();

  if (!title) {
    toast('请输入公告标题', 'error');
    return;
  }

  if (!content) {
    toast('请输入公告内容', 'error');
    return;
  }

  if (content.length > 1000) {
    toast('公告内容不能超过1000字', 'error');
    return;
  }

  const id = $('announcementId').value;
  const payload = {
    title: title,
    content: content,
    status: status,
  };

  const saveBtn = $('saveAnnouncementBtn');
  const publishBtn = $('publishAnnouncementBtn');
  saveBtn.disabled = true;
  publishBtn.disabled = true;

  try {
    const method = id ? 'PUT' : 'POST';
    const url = id ? `/api/announcements/${id}` : '/api/announcements';
    await api(url, { method, body: JSON.stringify(payload) });

    if (status === 'published') {
      toast(id ? '公告已更新并发布' : '公告已发布', 'success');
    } else {
      toast(id ? '公告已保存为草稿' : '公告已保存为草稿', 'success');
    }

    closeAnnouncementModal();
    loadAnnouncements();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    publishBtn.disabled = false;
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
document.addEventListener('DOMContentLoaded', function() {
  $('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('loginUsername').value, password: $('loginPassword').value }) });
    state.token = data.token; state.user = data.user; localStorage.setItem('library_token', state.token); toast('登录成功', 'success'); showApp();
  } catch (err) { toast(err.message, 'error'); }
});
$('logoutBtn').addEventListener('click', () => logout(true));
document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
$('bookSearchBtn').addEventListener('click', async () => {
  const btn = $('bookSearchBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '搜索中...';
  state.bookPage = 1;
  try {
    await loadBooks();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
$('categoryFilter').addEventListener('change', async () => {
  const btn = $('bookSearchBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '筛选中...';
  state.bookPage = 1;
  try {
    await loadBooks();
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
$('bookPrev').addEventListener('click', () => { if (state.bookPage > 1) { state.bookPage--; loadBooks(); } });
$('bookNext').addEventListener('click', () => { state.bookPage++; loadBooks(); });
$('addBookBtn').addEventListener('click', () => openBookFormModal());
$('importBooksBtn').addEventListener('click', () => $('importBooksFile').click());
$('importBooksFile').addEventListener('change', importBooks);
$('resetBookForm').addEventListener('click', () => {
  showConfirmModal('确认清空表单内容？', () => {
    resetBookFormFields();
  });
});
$('bookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    isbn: $('bookIsbn').value, title: $('bookTitle').value, author: $('bookAuthor').value, publisher: $('bookPublisher').value,
    category: $('bookCategory').value, total_count: Number($('bookTotal').value), available_count: $('bookAvailable').value === '' ? null : Number($('bookAvailable').value), shelf_location: $('bookShelf').value, description: $('bookDescription').value,
    price: $('bookPrice').value === '' ? 0.0 : parseFloat($('bookPrice').value),
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
// 注意：readerForm已改为弹窗形式(readerFormInner)，使用onclick直接调用submitReaderForm()
// $('readerForm').addEventListener('submit', ...); // 已移除
// 新增读者按钮事件绑定
$('addReaderBtn')?.addEventListener('click', () => openReaderFormModal());

// 编辑读者弹窗按钮事件绑定
$('submitEditReaderBtn')?.addEventListener('click', submitEditReader);
$('cancelEditReaderBtn')?.addEventListener('click', closeEditReaderModal);

// 重置密码弹窗按钮事件绑定
$('submitResetPwdBtn')?.addEventListener('click', submitResetPwd);
$('cancelResetPwdBtn')?.addEventListener('click', closeResetPwdModal);

$('recordSearchBtn')?.addEventListener('click', () => { state.recordPage = 1; loadRecords(); });
$('recordPrev')?.addEventListener('click', () => { if (state.recordPage > 1) { state.recordPage--; loadRecords(); } });
$('recordNext')?.addEventListener('click', () => { state.recordPage++; loadRecords(); });
$('reservationSearchBtn')?.addEventListener('click', () => { state.reservationPage = 1; loadReservations(); });
$('reservationStatus')?.addEventListener('change', () => { state.reservationPage = 1; loadReservations(); });
$('reservationPrev')?.addEventListener('click', () => { if (state.reservationPage > 1) { state.reservationPage--; loadReservations(); } });
$('reservationNext')?.addEventListener('click', () => { state.reservationPage++; loadReservations(); });
// 注意：borrowForm已改为弹窗形式(borrowFormInner)，使用onclick直接调用submitBorrowForm()
// $('borrowForm').addEventListener('submit', ...); // 已移除
// 借书登记按钮事件绑定
$('openBorrowFormBtn')?.addEventListener('click', openBorrowFormModal);
$('generateReportBtn')?.addEventListener('click', loadReport);
$('downloadReportBtn')?.addEventListener('click', downloadReport);
$('refreshOverdueBtn')?.addEventListener('click', async () => {
  const btn = $('refreshOverdueBtn');
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loading').classList.remove('hidden');
  btn.disabled = true;
  overduePage = 1;
  try {
    await loadOverdue();
  } finally {
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loading').classList.add('hidden');
    btn.disabled = false;
  }
});
$('markAllReadBtn')?.addEventListener('click', markAllMessagesRead);
$('messagePrev')?.addEventListener('click', () => { if (state.messagePage > 1) { state.messagePage--; loadMessages(); } });
$('messageNext')?.addEventListener('click', () => { state.messagePage++; loadMessages(); });
$('overdueSort')?.addEventListener('change', (e) => { currentOverdueSort = e.target.value; overduePage = 1; loadOverdue(); });
$('overdueKeyword')?.addEventListener('input', (e) => { overdueKeyword = e.target.value; });
$('overdueKeyword')?.addEventListener('keypress', (e) => { if (e.key === 'Enter') { overduePage = 1; loadOverdue(); } });
$('generateRemindersBtn')?.addEventListener('click', async () => {
  showConfirmModal('确认要生成提醒消息吗？', async () => {
    const btn = $('generateRemindersBtn');
    btn.querySelector('.btn-text').classList.add('hidden');
    btn.querySelector('.btn-loading').classList.remove('hidden');
    btn.disabled = true;
    try {
      await api('/api/reminders/generate', { method: 'POST' });
      toast('提醒消息生成成功！', 'success');
      loadOverdue();
    } catch (e) { toast(e.message, 'error'); }
    finally {
      btn.querySelector('.btn-text').classList.remove('hidden');
      btn.querySelector('.btn-loading').classList.add('hidden');
      btn.disabled = false;
    }
  });
});
$('batchNotifyBtn')?.addEventListener('click', batchNotify);
$('exportOverdueBtn')?.addEventListener('click', async () => {
  const btn = $('exportOverdueBtn');
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loading').classList.remove('hidden');
  btn.disabled = true;
  try {
    const sort = encodeURIComponent(currentOverdueSort || '');
    const keyword = encodeURIComponent(overdueKeyword || '');
    const data = await api(`/api/overdue?sort=${sort}&keyword=${keyword}&page=1&page_size=10000`);
    // 生成带日期的文件名
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
    // 构建 CSV 数据
    const headers = ['记录ID', '图书', '读者', '借出日期', '应还日期', '逾期天数', '预估罚金', '状态'];
    const rows = (data.items || []).map(item => [
      item.id,
      `"${(item.book_title || '').replace(/"/g, '""')}"`,
      `"${(item.reader_name || '').replace(/"/g, '""')}"`,
      item.borrow_date,
      item.due_date,
      Math.max(0, Math.round(item.overdue_days || 0)),
      (item.fine_amount || 0).toFixed(2),
      item.status === 'overdue' ? '已逾期' : item.status === 'returned' ? '已归还' : '借阅中'
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `逾期报表_${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('导出成功！', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loading').classList.add('hidden');
    btn.disabled = false;
  }
});
// 逾期分页按钮事件
$('overduePrev')?.addEventListener('click', () => { if (overduePage > 1) { overduePage--; loadOverdue(); } });
$('overdueNext')?.addEventListener('click', () => { if (overduePage < totalPages) { overduePage++; loadOverdue(); } });
$('exportBooksBtn')?.addEventListener('click', async () => {
  const btn = $('exportBooksBtn');
  const originalText = btn.textContent;
  
  // 检查是否有数据可导出
  const totalText = $('bookTotalText').textContent;
  const match = totalText.match(/共 (\d+) 本/);
  const totalCount = match ? parseInt(match[1]) : 0;
  
  if (totalCount === 0) {
    toast('暂无数据可导出', 'warning');
    return;
  }
  
  btn.disabled = true;
  btn.textContent = '导出中...';
  
  try {
    const csv = await api(`/api/books/export?search=${encodeURIComponent($('bookSearch').value || '')}&category=${encodeURIComponent($('categoryFilter').value || '')}`);
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    downloadCsv(`图书列表_${dateStr}.csv`, csv);
    toast('导出成功', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});
$('exportRecordsBtn')?.addEventListener('click', async () => {
  try { const csv = await api(`/api/borrow-records/export?status=${encodeURIComponent($('recordStatus').value || '')}&keyword=${encodeURIComponent($('recordKeyword').value || '')}`); downloadCsv('借还记录.csv', csv); }
  catch (e) { toast(e.message, 'error'); }
});
if ($('resetReaderForm')) $('resetReaderForm').addEventListener('click', resetReaderForm);

// 公告管理事件绑定
$('addAnnouncementBtn')?.addEventListener('click', openAnnouncementModal);

$('announcementContent')?.addEventListener('input', (e) => {
  const count = e.target.value.length;
  $('announcementCharCount').textContent = `${count}/1000字`;
});

$('resetAnnouncementForm')?.addEventListener('click', () => {
  resetAnnouncementForm();
});

$('saveAnnouncementBtn')?.addEventListener('click', () => {
  saveAnnouncement('draft');
});

$('publishAnnouncementBtn')?.addEventListener('click', () => {
  saveAnnouncement('published');
});

$('listAnnouncementsBtn')?.addEventListener('click', () => {
  state.announcementPage = 1;
  loadAnnouncements();
});

$('announcementStatus')?.addEventListener('change', () => {
  state.announcementPage = 1;
  loadAnnouncements();
});

$('announcementPrev')?.addEventListener('click', () => {
  if (state.announcementPage > 1) {
    state.announcementPage--;
    loadAnnouncements();
  }
});

$('announcementNext')?.addEventListener('click', () => {
  const totalText = $('announcementPageText').textContent;
  const match = totalText.match(/共 (\d+) 页/);
  const totalPages = match ? parseInt(match[1]) : 1;
  if (state.announcementPage < totalPages) {
    state.announcementPage++;
    loadAnnouncements();
  }
});

// 点击遮罩层关闭弹窗
$('announcementModal')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeAnnouncementModal();
  }
});

$('announcementDetailModal')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeAnnouncementDetailModal();
  }
});

// 操作日志事件绑定
$('searchAuditBtn')?.addEventListener('click', () => { state.auditPage = 1; loadAuditLogs(); });
$('auditAction')?.addEventListener('change', () => { state.auditPage = 1; loadAuditLogs(); });
$('auditPrev')?.addEventListener('click', () => { if (state.auditPage > 1) { state.auditPage--; loadAuditLogs(); } });
$('auditNext')?.addEventListener('click', () => { state.auditPage++; loadAuditLogs(); });
$('exportAuditBtn')?.addEventListener('click', exportAuditLogs);

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

async function sendRegisterCode() {
  const phone = $('registerPhone').value.trim();
  if (!phone) return toast('请输入手机号', 'error');

  try {
    await api('/api/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    toast('验证码已发送', 'success');
    startCodeTimer('sendRegisterCodeBtn');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function sendForgotCode() {
  const phone = $('forgotPhone').value.trim();
  if (!phone) return toast('请输入手机号', 'error');

  try {
    await api('/api/auth/send-forgot-code', {
      method: 'POST',
      body: JSON.stringify({ phone })
    });
    toast('验证码已发送', 'success');
    startCodeTimer('sendForgotCodeBtn');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = $('registerUsername').value;
  const full_name = $('registerFullName').value;
  const phone = $('registerPhone').value;
  const code = $('registerCode').value;
  const password = $('registerPassword').value;

  if (!username || !full_name || !phone || !code || !password) {
    return toast('请填写完整信息', 'error');
  }
  if (password.length < 6) {
    return toast('密码至少6位', 'error');
  }

  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, full_name, phone, verify_code: code, password })
    });
    toast('注册成功，请登录', 'success');
    showLoginPage();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const phone = $('forgotPhone').value;
  const code = $('forgotCode').value;
  const newPassword = $('forgotNewPassword').value;

  if (!phone || !code || !newPassword) {
    return toast('请填写完整信息', 'error');
  }
  if (newPassword.length < 6) {
    return toast('密码至少6位', 'error');
  }

  try {
    await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ phone, verify_code: code, new_password: newPassword })
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
$('sendRegisterCodeBtn')?.addEventListener('click', sendRegisterCode);
$('sendForgotCodeBtn')?.addEventListener('click', sendForgotCode);
$('registerForm').addEventListener('submit', handleRegister);
$('forgotPasswordForm').addEventListener('submit', handleForgotPassword);
$('changePasswordBtn').addEventListener('click', showChangePasswordModal);

// 时间筛选器事件绑定
document.querySelectorAll('.time-filter-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    // 移除所有active类
    document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));
    // 添加当前按钮的active类
    this.classList.add('active');
    // 更新时间范围
    state.dashboardTimeRange = parseInt(this.dataset.days);
    // 重新加载仪表盘
    loadDashboard();
  });
});

// 自定义日期应用按钮
if ($('applyCustomDate')) {
  $('applyCustomDate').addEventListener('click', function() {
    const startDate = $('customStartDate').value;
    const endDate = $('customEndDate').value;

    if (!startDate || !endDate) {
      return toast('请选择开始和结束日期', 'error');
    }

    if (new Date(startDate) > new Date(endDate)) {
      return toast('开始日期不能晚于结束日期', 'error');
    }

    // 计算天数差
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
    state.dashboardTimeRange = days;

    // 更新按钮状态
    document.querySelectorAll('.time-filter-btn').forEach(b => b.classList.remove('active'));

    // 重新加载仪表盘
    loadDashboard();
    toast(`已应用自定义日期范围：${days}天`, 'success');
  });
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initAuth);

// ========== 读者管理弹窗控制 ==========
function openReaderFormModal(reader = null) {
  $('readerFormTitle').textContent = reader ? '编辑读者' : '新增读者';
  $('readerId').value = reader ? reader.id : '';
  $('readerUsername').value = reader ? reader.username : '';
  $('readerPassword').value = '';
  $('readerConfirmPassword').value = '';
  $('readerFullName').value = reader ? reader.full_name : '';
  $('readerPhone').value = reader ? reader.phone : '';
  $('readerEmail').value = reader ? reader.email || '' : '';
  $('readerDepartment').value = reader ? reader.department || '' : '';
  $('readerDepartmentCustom').value = '';
  $('readerStatus').value = reader ? reader.status : 'active';

  // 清空验证错误
  document.querySelectorAll('#readerFormModal .validation-error').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });

  $('readerFormModal').classList.remove('hidden');
}

function closeReaderFormModal() {
  $('readerFormModal').classList.add('hidden');
}

async function submitReaderForm() {
  const id = $('readerId').value;
  const username = $('readerUsername').value;
  const password = $('readerPassword').value;
  const confirmPassword = $('readerConfirmPassword').value;
  const fullName = $('readerFullName').value;
  const phone = $('readerPhone').value;
  const email = $('readerEmail').value;
  const department = $('readerDepartment').value || $('readerDepartmentCustom').value;
  const status = $('readerStatus').value;

  // 表单校验
  if (!username) {
    toast('请输入用户名', 'error');
    return;
  }
  if (!id && !password) {
    toast('请输入密码', 'error');
    return;
  }
  if (password && password !== confirmPassword) {
    toast('两次输入的密码不一致', 'error');
    return;
  }
  if (password && password.length < 8) {
    toast('密码至少8位', 'error');
    return;
  }
  if (!fullName) {
    toast('请输入姓名', 'error');
    return;
  }
  if (!phone) {
    toast('请输入手机号', 'error');
    return;
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    toast('请输入有效的11位手机号', 'error');
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('请输入有效的邮箱地址', 'error');
    return;
  }

  try {
    const payload = {
      username,
      full_name: fullName,
      phone,
      email: email || null,
      department: department || null,
      status
    };

    if (id) {
      // 编辑读者
      if (password) {
        payload.password = password;
      }
      await api(`/api/readers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast(`读者「${fullName}」更新成功`, 'success');
    } else {
      // 新增读者
      payload.password = password;
      await api('/api/readers', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast(`读者「${fullName}」新增成功`, 'success');
    }

    closeReaderFormModal();
    loadReaders();
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 点击遮罩层关闭弹窗
$('readerFormModal')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeReaderFormModal();
  }
});

// ========== 借书登记弹窗控制 ==========
function openBorrowFormModal() {
  $('borrowOutDate').value = new Date().toISOString().split('T')[0];
  $('borrowDays').value = '30';
  $('borrowDueDate').value = '';
  $('borrowRemarkType').value = '';
  $('borrowRemark').value = '';

  // 加载图书和读者下拉框
  loadBorrowOptions();
  calculateDueDate();

  $('borrowFormModal').classList.remove('hidden');
}

function closeBorrowFormModal() {
  $('borrowFormModal').classList.add('hidden');
}

function calculateDueDate() {
  const outDate = $('borrowOutDate').value;
  const days = parseInt($('borrowDays').value) || 30;

  if (outDate) {
    const dueDate = new Date(outDate);
    dueDate.setDate(dueDate.getDate() + days);
    const year = dueDate.getFullYear();
    const month = String(dueDate.getMonth() + 1).padStart(2, '0');
    const day = String(dueDate.getDate()).padStart(2, '0');
    $('borrowDueDate').value = `${year}-${month}-${day}`;
  } else {
    $('borrowDueDate').value = '';
  }
}

async function submitBorrowForm() {
  const bookId = $('borrowBook').value;
  const readerId = $('borrowReader').value;
  const outDate = $('borrowOutDate').value;
  const days = parseInt($('borrowDays').value);
  const dueDate = $('borrowDueDate').value;
  const remarkType = $('borrowRemarkType').value;
  const remark = $('borrowRemark').value;

  // 表单校验
  if (!bookId) {
    toast('请选择借阅的图书', 'error');
    return;
  }
  if (!readerId) {
    toast('请选择读者', 'error');
    return;
  }
  if (!outDate) {
    toast('请选择借出日期', 'error');
    return;
  }
  if (days > 30) {
    toast('最长借阅天数为30天', 'error');
    return;
  }

  // 组合备注
  let fullRemark = remark;
  if (remarkType) {
    const typeMap = { teacher: '教师借阅', holiday: '学生假期借阅' };
    fullRemark = remark ? `${typeMap[remarkType]} - ${remark}` : typeMap[remarkType];
  }

  try {
    await api('/api/borrow-records', {
      method: 'POST',
      body: JSON.stringify({
        book_id: parseInt(bookId),
        reader_id: parseInt(readerId),
        borrow_date: outDate,
        days: days,
        remark: fullRemark || null
      })
    });

    // 获取图书和读者信息用于提示
    const bookSelect = $('borrowBook');
    const readerSelect = $('borrowReader');
    const bookTitle = bookSelect.options[bookSelect.selectedIndex]?.text.split('(')[0] || '图书';
    const readerName = readerSelect.options[readerSelect.selectedIndex]?.text.split('(')[0] || '读者';

    toast(`《${bookTitle}》已成功借给读者「${readerName}」，应还日期为 ${dueDate}`, 'success');
    closeBorrowFormModal();
    loadRecords();
    loadDashboard(); // 刷新仪表盘
  } catch (e) {
    toast(e.message, 'error');
  }
}

// 监听借出日期和借阅天数变化
$('borrowDays')?.addEventListener('change', calculateDueDate);
$('borrowOutDate')?.addEventListener('change', calculateDueDate);

// 点击遮罩层关闭弹窗
$('borrowFormModal')?.addEventListener('click', function(e) {
  if (e.target === this) {
    closeBorrowFormModal();
  }
});

}); // 结束 DOMContentLoaded


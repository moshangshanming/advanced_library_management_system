console.log('app.js loaded');
const state = {
  token: localStorage.getItem('library_token') || '',
  user: null,
  bookPage: 1,
  recordPage: 1,
  lastBooks: [],
  lastReaders: [],
  currentReport: null,
};

const $ = (id) => document.getElementById(id);

function toast(message, type = 'info') {
  const el = $('toast');
  el.textContent = message;

  // 核心修复：移除原先硬编码的 style 属性，彻底交由上面新写的明亮级 CSS 类控制
  el.removeAttribute('style');
  el.className = `toast show ${type}`;

  setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
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
  $('currentUser').textContent = `${state.user.full_name}（${state.user.role === 'admin' ? '管理员' : '读者'}）`;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', state.user.role !== 'admin'));
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

function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === viewName));
  $(viewName).classList.add('active-view');
  const titleMap = {
    dashboard: ['数据总览', '多维度统计图表，辅助管理员了解图书馆运行情况。'],
    books: ['图书管理', '完成图书新增、删除、查询和修改。'],
    readers: ['读者管理', '维护读者基础信息与账号状态。'],
    records: ['借还记录', '记录每一次借书与还书操作。'],
    reports: ['读书报告', '为读者生成个性化报告并在线预览。'],
    overdue: ['逾期提醒', '发现逾期借阅并生成提醒消息。'],
  };
  $('pageTitle').textContent = titleMap[viewName][0];
  $('pageSubtitle').textContent = titleMap[viewName][1];
  if (viewName === 'dashboard') loadDashboard();
  if (viewName === 'books') loadBooks();
  if (viewName === 'readers') loadReaders();
  if (viewName === 'records') { loadBorrowOptions(); loadRecords(); }
  if (viewName === 'reports') loadReportView();
  if (viewName === 'overdue') loadOverdue();
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
    <div class="top-item"><div class="rank">${idx + 1}</div><div><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.category)}</small></div><b>${item.borrow_count} 次</b></div>
  `).join('') : '<p>暂无借阅数据</p>';
}

function drawPie(canvasId, items) {
  const canvas = $(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 220 * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const total = items.reduce((sum, x) => sum + Number(x.value), 0) || 1;
  let start = -Math.PI / 2;
  const colors = ['#6b8ea5', '#9ebba1', '#d4b58e', '#cca3a3', '#8b849c', '#7ba1a0', '#c296a1', '#b2bba1', '#98849c', '#d69e85'];
  const cx = 120 * devicePixelRatio, cy = 110 * devicePixelRatio, r = 76 * devicePixelRatio;
  items.forEach((item, i) => {
    const angle = (Number(item.value) / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, start, start + angle); ctx.closePath();
    ctx.fillStyle = colors[i % colors.length]; ctx.fill(); start += angle;
  });
  ctx.fillStyle = '#182235'; ctx.font = `${13 * devicePixelRatio}px Microsoft YaHei`;
  items.slice(0, 8).forEach((item, i) => {
    const x = 230 * devicePixelRatio, y = (34 + i * 22) * devicePixelRatio;
    ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(x, y - 10 * devicePixelRatio, 12 * devicePixelRatio, 12 * devicePixelRatio);
    ctx.fillStyle = '#334155'; ctx.fillText(`${item.name}：${item.value}`, x + 20 * devicePixelRatio, y);
  });
}

function drawBar(canvasId, items) {
  const canvas = $(canvasId);
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 220 * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  const pad = 34 * devicePixelRatio;
  const max = Math.max(1, ...items.map(x => Number(x.count)));
  const gap = 8 * devicePixelRatio;
  const barW = (w - pad * 2 - gap * (items.length - 1)) / items.length;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.lineTo(w - pad, h - pad); ctx.stroke();
  items.forEach((item, i) => {
    const bh = (Number(item.count) / max) * (h - pad * 2);
    const x = pad + i * (barW + gap), y = h - pad - bh;
    ctx.fillStyle = '#2563eb'; ctx.fillRect(x, y, barW, bh || 2 * devicePixelRatio);
    ctx.fillStyle = '#64748b'; ctx.font = `${10 * devicePixelRatio}px Microsoft YaHei`;
    if (i % 2 === 0) ctx.fillText(item.day, x - 2 * devicePixelRatio, h - 10 * devicePixelRatio);
  });
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
  $('bookTable').innerHTML = `
    <thead><tr><th>ID</th><th>ISBN</th><th>书名</th><th>作者</th><th>分类</th><th>库存</th><th>位置</th><th>操作</th></tr></thead>
    <tbody>${data.items.map(book => `
      <tr>
        <td>${book.id}</td><td>${escapeHtml(book.isbn)}</td><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.author)}</td><td>${escapeHtml(book.category)}</td>
        <td>${book.available_count}/${book.total_count}</td><td>${escapeHtml(book.shelf_location)}</td>
        <td><div class="row-actions">
          <button class="ghost" onclick="quickBorrow(${book.id})">借阅</button>
          ${state.user.role === 'admin' ? `<button class="ghost" onclick="editBook(${book.id})">编辑</button><button class="danger" onclick="deleteBook(${book.id})">删除</button>` : ''}
        </div></td>
      </tr>`).join('')}</tbody>`;
}

function resetBookForm() {
  $('bookForm').reset(); $('bookId').value = ''; $('bookFormTitle').textContent = '新增图书';
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
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.username)}</td><td>${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.phone)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.department)}</td><td>${r.status === 'active' ? '正常' : '冻结'}</td><td><div class="row-actions"><button class="ghost" onclick="editReader(${r.id})">编辑</button><button class="danger" onclick="deleteReader(${r.id})">删除</button></div></td></tr>`).join('')}
  </tbody>`;
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
  $('recordTable').innerHTML = `<thead><tr><th>ID</th><th>图书</th><th>读者</th><th>借出日期</th><th>应还日期</th><th>归还日期</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.book_title)}</td><td>${escapeHtml(r.reader_name)}</td><td>${r.borrow_date}</td><td>${r.due_date}</td><td>${r.return_date || '-'}</td><td>${statusBadge(r.status)}</td><td>${r.status !== 'returned' ? `<button class="primary" onclick="returnBook(${r.id})">归还</button>` : '-'}</td></tr>`).join('')}
  </tbody>`;
}

async function returnBook(recordId) {
  if (!confirm('确认归还这本书？')) return;
  try { await api(`/api/borrow-records/${recordId}/return`, { method: 'PATCH' }); toast('归还成功，库存已恢复', 'success'); loadRecords(); loadDashboard(); }
  catch (e) { toast(e.message, 'error'); }
}

async function loadOverdue() {
  const data = await api('/api/overdue');
  $('overdueTable').innerHTML = `<thead><tr><th>记录ID</th><th>图书</th><th>读者</th><th>应还日期</th><th>逾期天数</th><th>状态</th></tr></thead><tbody>
    ${data.items.map(r => `<tr><td>${r.id}</td><td>${escapeHtml(r.book_title)}</td><td>${escapeHtml(r.reader_name)}</td><td>${r.due_date}</td><td>${Math.max(r.overdue_days, 1)}</td><td>${statusBadge(r.status)}</td></tr>`).join('') || '<tr><td colspan="6">暂无逾期记录</td></tr>'}
  </tbody>`;
}

async function loadReportView() {
  state.currentReport = null;
  $('reportPreview').innerHTML = '<p>请点击“生成报告”查看当前读者的阅读汇总。</p>';
  if (state.user.role === 'admin') {
    await loadReportReaders();
  }
}

async function loadReportReaders() {
  const data = await api('/api/readers?page=1&page_size=100');
  $('reportReader').innerHTML = '<option value="">请选择读者</option>' + data.items.map(r => `<option value="${r.id}">${escapeHtml(r.full_name)} / ${escapeHtml(r.username)}</option>`).join('');
}

async function loadReport() {
  console.log('loadReport called');
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
    console.error('loadReport error', err);
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
  console.log('downloadReport called');
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
    await api(id ? `/api/books/${id}` : '/api/books', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    toast('图书保存成功', 'success'); resetBookForm(); loadBooks(); loadDashboard();
  } catch (err) { toast(err.message, 'error'); }
});
$('readerSearchBtn').addEventListener('click', loadReaders);
$('resetReaderForm').addEventListener('click', resetReaderForm);
$('readerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('readerId').value;
  const payload = { full_name: $('readerFullName').value, phone: $('readerPhone').value, email: $('readerEmail').value, department: $('readerDepartment').value, status: $('readerStatus').value };
  if (!id) { payload.username = $('readerUsername').value; payload.password = $('readerPassword').value; if (!payload.password || payload.password.length < 6) return toast('新增读者密码至少 6 位', 'error'); }
  else if ($('readerPassword').value) payload.password = $('readerPassword').value;
  try { await api(id ? `/api/readers/${id}` : '/api/readers', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); toast('读者保存成功', 'success'); resetReaderForm(); loadReaders(); loadBorrowOptions(); }
  catch (err) { toast(err.message, 'error'); }
});
$('borrowForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = { book_id: Number($('borrowBook').value), days: Number($('borrowDays').value), remark: $('borrowRemark').value };
  if (state.user.role === 'admin') payload.reader_id = Number($('borrowReader').value);
  try { await api('/api/borrow-records', { method: 'POST', body: JSON.stringify(payload) }); toast('借书登记成功', 'success'); loadBorrowOptions(); loadRecords(); loadBooks(); loadDashboard(); }
  catch (err) { toast(err.message, 'error'); }
});
$('recordSearchBtn').addEventListener('click', () => { state.recordPage = 1; loadRecords(); });
$('recordPrev').addEventListener('click', () => { if (state.recordPage > 1) { state.recordPage--; loadRecords(); } });
$('recordNext').addEventListener('click', () => { state.recordPage++; loadRecords(); });
$('refreshOverdueBtn').addEventListener('click', loadOverdue);
$('generateRemindersBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/reminders/generate', { method: 'POST' });
    $('reminderMessages').innerHTML = data.items.map(x => `<div class="reminder-msg">${escapeHtml(x.message)}</div>`).join('') || '<div class="reminder-msg">暂无需要提醒的逾期记录。</div>';
    toast(`已生成 ${data.total} 条提醒`, 'success');
  } catch (err) { toast(err.message, 'error'); }
});
$('exportBooksBtn').addEventListener('click', async () => downloadCsv('books.csv', await api('/api/export/books')));
$('exportRecordsBtn').addEventListener('click', async () => downloadCsv('borrow_records.csv', await api('/api/export/borrow-records')));
$('generateReportBtn').addEventListener('click', loadReport);
$('downloadReportBtn').addEventListener('click', downloadReport);
console.log('report buttons bound', $('generateReportBtn'), $('downloadReportBtn'));

initAuth();

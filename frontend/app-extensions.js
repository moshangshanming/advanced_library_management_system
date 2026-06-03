// ===== 扩展前端功能 =====
// 添加到现有 app.js 的补充代码

// ===== 公告管理 =====
async function loadAnnouncements() {
  const page = state.announcementPage || 1;
  try {
    const data = await api(`/api/announcements?page=${page}&page_size=10`);
    state.lastAnnouncements = data.items;
    
    const html = data.items.map(ann => `
      <div class="announcement-card">
        <div class="announcement-header">
          <h3>${escapeHtml(ann.title)}</h3>
          <span class="time">${ann.created_at}</span>
        </div>
        <div class="announcement-content">${escapeHtml(ann.content)}</div>
        ${state.user.role === 'admin' ? `
          <div class="row-actions">
            <button class="ghost" onclick="editAnnouncement(${ann.id})">编辑</button>
            <button class="danger" onclick="deleteAnnouncement(${ann.id})">删除</button>
          </div>
        ` : ''}
      </div>
    `).join('');
    
    $('announcementList').innerHTML = html || '<p>暂无公告</p>';
  } catch (err) {
    toast(err.message, 'error');
  }
}

function editAnnouncement(id) {
  const ann = state.lastAnnouncements.find(x => x.id === id);
  if (!ann) return;
  $('announcementId').value = ann.id;
  $('announcementTitle').value = ann.title;
  $('announcementContent').value = ann.content;
  $('announcementStatus').value = ann.status;
}

async function deleteAnnouncement(id) {
  if (!confirm('确认删除该公告？')) return;
  try {
    await api(`/api/announcements/${id}`, { method: 'DELETE' });
    toast('公告已删除', 'success');
    loadAnnouncements();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== 用户管理增强 =====
async function importReadersCsv(file) {
  if (!file) return toast('请选择文件', 'error');
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const response = await fetch('/api/readers/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || '导入失败');
    }
    
    const result = await response.json();
    toast(`导入完成：成功 ${result.success}，失败 ${result.failed}`, 'success');
    
    if (result.errors.length > 0) {
      console.error('Import errors:', result.errors);
      toast(`有 ${result.errors.length} 行出现错误，请查看控制台`, 'info');
    }
    
    loadReaders();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function exportReadersCsv() {
  try {
    const csv = await api('/api/readers/export');
    downloadCsv('readers.csv', csv);
    toast('已下载读者列表', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function resetReaderPassword(readerId) {
  const newPassword = prompt('请输入新密码（至少6位）：');
  if (!newPassword || newPassword.length < 6) return toast('密码不符合要求', 'error');
  
  try {
    await api(`/api/readers/${readerId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ reader_id: readerId, new_password: newPassword })
    });
    toast('密码已重置', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== 操作日志 =====
async function loadAuditLogs() {
  const page = state.auditPage || 1;
  const userId = $('auditUserId').value || '';
  const action = $('auditAction').value || '';
  
  try {
    const params = new URLSearchParams({
      page: page,
      page_size: 20,
      ...(userId && { user_id: userId }),
      ...(action && { action: action })
    });
    
    const data = await api(`/api/audit-logs?${params}`);
    $('auditLogTable').innerHTML = `
      <thead>
        <tr><th>时间</th><th>用户</th><th>操作</th><th>对象</th><th>ID</th><th>详情</th></tr>
      </thead>
      <tbody>
        ${data.items.map(log => `
          <tr>
            <td>${log.timestamp}</td>
            <td>${escapeHtml(log.username || '-')}</td>
            <td>${log.action}</td>
            <td>${log.target_type}</td>
            <td>${log.target_id || '-'}</td>
            <td>${escapeHtml(log.details || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function exportAuditLogs() {
  try {
    const csv = await api('/api/audit-logs/export');
    downloadCsv('audit_logs.csv', csv);
    toast('已下载操作日志', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== 智能推荐 =====
async function loadRecommendations() {
  try {
    const recommendations = await api('/api/recommendations');
    
    const renderBooks = (books, title) => {
      if (!books || books.length === 0) return '';
      return `
        <div class="recommendation-section">
          <h4>${title}</h4>
          <div class="book-grid">
            ${books.map(book => `
              <div class="book-card">
                <div class="book-info">
                  <strong>${escapeHtml(book.title)}</strong>
                  <p>${escapeHtml(book.author)}</p>
                </div>
                <button class="small" onclick="quickBorrow(${book.id})">借阅</button>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    };
    
    const html = `
      ${renderBooks(recommendations.by_category, '根据您的借阅分类推荐')}
      ${renderBooks(recommendations.by_popular, '热门图书推荐')}
      ${renderBooks(recommendations.by_rating, '高分推荐')}
      ${renderBooks(recommendations.by_department, '您部门同学也在读')}
    `;
    
    $('recommendationContent').innerHTML = html || '<p>暂无推荐</p>';
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== 书籍评论 =====
async function addBookReview(bookId) {
  const rating = prompt('请评分（1-5）：', '5');
  if (!rating || rating < 1 || rating > 5) return;
  
  const reviewText = prompt('请输入书评（可选）：', '');
  
  try {
    await api('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        book_id: bookId,
        rating: parseInt(rating),
        review_text: reviewText || ''
      })
    });
    toast('评论已添加', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function viewBookReviews(bookId) {
  try {
    const data = await api(`/api/books/${bookId}/with-reviews`);
    const avgRating = data.average_rating ? data.average_rating.toFixed(1) : '未评分';
    
    const reviewsHtml = data.reviews.map(review => `
      <div class="review-item">
        <div class="review-header">
          <strong>${escapeHtml(review.reader_name)}</strong>
          <span class="stars">${'★'.repeat(review.rating)}</span>
        </div>
        <p>${escapeHtml(review.review_text)}</p>
        <small>${review.created_at}</small>
      </div>
    `).join('');
    
    const html = `
      <div class="book-reviews">
        <div class="review-summary">
          <h3>${escapeHtml(data.title)}</h3>
          <p>平均评分：${avgRating} / 5</p>
          <p>评论数：${data.review_count}</p>
        </div>
        <div class="reviews-list">
          ${reviewsHtml || '<p>暂无评论</p>'}
        </div>
      </div>
    `;
    
    // 这里应该在一个模态框中显示，需要添加相应的 UI
    alert('书籍评论已加载，请在控制台查看完整信息');
    console.log('Reviews:', data);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ===== 页面导航更新 =====
// 在 switchView 函数中添加新的视图处理
const originalSwitchView = switchView;
switchView = function(viewName) {
  if (viewName === 'announcements') {
    $('pageTitle').textContent = '系统公告';
    $('pageSubtitle').textContent = '查看最新的系统通知和公告信息';
    loadAnnouncements();
  } else if (viewName === 'manage-users') {
    $('pageTitle').textContent = '用户管理';
    $('pageSubtitle').textContent = '读者管理、批量导入、密码重置';
    loadReaders();
  } else if (viewName === 'audit-logs') {
    $('pageTitle').textContent = '操作日志';
    $('pageSubtitle').textContent = '系统操作审计日志、导出';
    loadAuditLogs();
  } else if (viewName === 'recommendations') {
    $('pageTitle').textContent = '智能推荐';
    $('pageSubtitle').textContent = '基于您的借阅历史的个性化推荐';
    loadRecommendations();
  } else {
    return originalSwitchView(viewName);
  }
};

// ===== 事件监听（需要在 HTML 中绑定相应的元素）=====
// 公告表单提交
if ($('announcementForm')) {
  $('announcementForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: $('announcementTitle').value,
      content: $('announcementContent').value,
      status: $('announcementStatus').value
    };
    
    try {
      const id = $('announcementId').value;
      await api(
        id ? `/api/announcements/${id}` : '/api/announcements',
        { 
          method: id ? 'PUT' : 'POST',
          body: JSON.stringify(payload)
        }
      );
      toast('公告已保存', 'success');
      $('announcementForm').reset();
      loadAnnouncements();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// 文件导入
if ($('readerImportFile')) {
  $('readerImportBtn').addEventListener('click', () => {
    const file = $('readerImportFile').files[0];
    if (file) importReadersCsv(file);
  });
}

console.log('Frontend extensions loaded');

# 前端功能扩展说明

为了支持新增功能，需要对前端代码进行以下扩展：

## 需要在 HTML 中添加的新导航和视图

### 在侧边栏中添加新的导航按钮
在 `<aside class="sidebar">` 的导航按钮中添加：
```html
<button data-view="announcements" class="nav">系统公告</button>
<button data-view="manage-users" class="nav admin-only">用户管理</button>
<button data-view="audit-logs" class="nav admin-only">操作日志</button>
<button data-view="recommendations" class="nav">智能推荐</button>
```

### 添加新的视图部分

1. **公告管理视图** (announcements)
2. **用户管理视图** (manage-users) - 包括批量导入、导出、重置密码
3. **操作日志视图** (audit-logs) - 包括日志查看和导出
4. **智能推荐视图** (recommendations) - 包括多种推荐方式

## JavaScript 扩展函数

### 公告管理
- `loadAnnouncements()` - 加载公告列表
- `createAnnouncement()` - 创建公告
- `updateAnnouncement()` - 更新公告
- `deleteAnnouncement()` - 删除公告
- `showAnnouncementModal()` - 显示公告编辑对话框

### 用户管理增强
- `importReadersCsv()` - 批量导入读者
- `exportReadersCsv()` - 导出读者为 CSV
- `resetReaderPassword()` - 重置读者密码

### 操作日志
- `loadAuditLogs()` - 加载审计日志
- `exportAuditLogsCsv()` - 导出操作日志
- `filterAuditLogs()` - 按用户/操作类型筛选

### 智能推荐
- `loadRecommendations()` - 加载推荐书籍
- `getRecommendationsByCategory()` - 按借阅分类推荐
- `getRecommendationsByPopular()` - 按热门榜推荐
- `getRecommendationsByRating()` - 按评分推荐
- `getRecommendationsByDepartment()` - 按部门推荐
- `addBookReview()` - 添加书籍评论

## 关键 API 端点

### 公告
- `GET /api/announcements` - 查看公告列表
- `POST /api/announcements` - 创建公告
- `PUT /api/announcements/{id}` - 更新公告
- `DELETE /api/announcements/{id}` - 删除公告

### 读者管理
- `POST /api/readers/import` - 批量导入
- `GET /api/readers/export` - 导出为 CSV
- `POST /api/readers/{id}/reset-password` - 重置密码

### 审计日志
- `GET /api/audit-logs` - 查看日志
- `GET /api/audit-logs/export` - 导出为 CSV

### 书籍评论
- `GET /api/books/{id}/reviews` - 获取评论
- `POST /api/reviews` - 添加评论
- `GET /api/books/{id}/with-reviews` - 获取书籍及评论

### 推荐
- `GET /api/recommendations` - 获取所有推荐
- `GET /api/recommendations/by-category` - 按分类推荐
- `GET /api/recommendations/by-popular` - 按热度推荐
- `GET /api/recommendations/by-rating` - 按评分推荐
- `GET /api/recommendations/by-department` - 按部门推荐

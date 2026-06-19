# 智慧图书管理系统（可视化高级版）

这是一个图书管理系统，包含 **前端页面 + FastAPI 后端 + SQLite 数据库 + 管理员权限 + 可视化统计 + CSV 导出**。

## 1. 功能清单

### 1.1 核心业务功能

| 模块 | 功能描述 |
|-----|---------|
| **图书管理** | 图书新增、删除、查询、修改；ISBN 唯一校验；库存校验；分页检索；分类筛选；模糊搜索 |
| **借还书记录** | 借书登记、归还登记、库存自动扣减/恢复、重复借阅校验、状态自动更新、借阅数量限制 |
| **读者信息管理** | 读者新增、修改、删除、查询、冻结/启用账号、密码重置 |
| **逾期提醒** | 自动扫描逾期记录，一键生成提醒消息，归还后自动标记提醒已处理 |
| **管理员权限** | 管理员可管理全部数据；普通读者只能查看/操作自己的借阅记录 |
| **数据可视化** | 馆藏分类饼图、近 14 天借阅趋势柱状图、热门图书 Top10、指标卡片 |
| **数据导出** | 图书数据 CSV 导出、借还记录 CSV 导出 |
| **查询效率优化** | SQLite 索引优化、视图 `v_borrow_detail`、分页查询、参数化 SQL |

### 1.2 用户角色权限

| 功能 | 管理员 (admin) | 馆员 (librarian) | 读者 (reader) |
|-----|:---:|:---:|:---:|
| 查看图书列表 | ✅ | ✅ | ✅ |
| 新增/修改/删除图书 | ✅ | ✅ | ❌ |
| 查看所有读者信息 | ✅ | ✅ | ❌ |
| 管理读者账号 | ✅ | ✅ | ❌ |
| 查看所有借阅记录 | ✅ | ✅ | ❌ |
| 借书/还书操作 | ✅ | ✅ | ✅（仅自己） |
| 查看操作日志 | ✅ | ❌ | ❌ |
| 批量导入读者 | ✅ | ❌ | ❌ |
| 系统配置 | ✅ | ❌ | ❌ |

### 1.3 用户使用流程

```
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌──────────┐
│   登录   │ ──▶  │  图书检索 │ ──▶  │  借书登记 │ ──▶  │  归还图书 │
└──────────┘      └──────────┘      └──────────┘      └──────────┘
     │                 │                 │                 │
     ▼                 ▼                 ▼                 ▼
  权限验证         库存检查         数量限制         逾期检测
```

## 2. 运行环境

建议使用：

- Python 3.10+
- Windows / macOS / Linux 均可
- 浏览器：Edge / Chrome

## 3. 一键运行

### Windows

双击或在终端运行：

```bat
run.bat
```

### macOS / Linux

```bash
chmod +x run.sh
./run.sh
```

运行成功后打开：

```text
http://127.0.0.1:8000
```

## 4. 演示账号

| 角色 | 用户名 | 密码 |
|---|---|---|
| 管理员 | admin | admin123 |
| 普通读者 | reader | reader123 |

## 5. 手动运行方式

```bash
pip install -r requirements.txt
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

## 6. 项目结构

```
advanced_library_management_system/
├─ backend/                    # 后端服务
│  ├─ app/                     # FastAPI 核心代码
│  │  ├─ main.py               # API 路由入口（定义接口）
│  │  ├─ services.py           # 业务逻辑（图书、读者、借还管理）
│  │  ├─ database.py           # 数据库操作（建表、索引、视图）
│  │  ├─ schemas.py            # 数据校验模型（请求/响应结构）
│  │  ├─ security.py            # 安全模块（密码哈希、JWT认证）
│  │  ├─ auth_service.py       # 认证服务（注册、登录、验证码）
│  │  └─ config.py             # 配置管理（路径、密钥等）
│  └─ library.db               # 开发测试数据库
├─ data/                       # 正式数据库存储目录
├─ frontend/                   # 前端页面
│  ├─ index.html               # 单页应用入口
│  ├─ app.js                   # 前端交互逻辑
│  ├─ styles.css               # 样式文件
│  ├─ app-extensions.js        # 扩展功能
│  └─ uploads/                 # 图书封面上传目录
├─ scripts/                    # 辅助脚本（数据修复、测试工具）
├─ requirements.txt            # Python 依赖列表
├─ run.bat / run.sh            # 一键启动脚本
└─ README.md                   # 项目说明文档
```

### 三层架构设计

```
┌─────────────────────────────────────┐
│         前端层 (frontend/)           │
│  HTML + CSS + JS (静态页面)          │
└───────────────────┬─────────────────┘
                    │ HTTP 请求
                    ▼
┌─────────────────────────────────────┐
│         路由层 (main.py)             │
│  FastAPI 接口定义、权限控制          │
└───────────────────┬─────────────────┘
                    │ 调用
                    ▼
┌─────────────────────────────────────┐
│         业务层 (services.py)         │
│  业务逻辑处理、数据校验              │
└───────────────────┬─────────────────┘
                    │ SQL 操作
                    ▼
┌─────────────────────────────────────┐
│         数据层 (database.py)         │
│  SQLite 数据库、索引、视图           │
└─────────────────────────────────────┘
```

## 7. 技术栈

| 层级 | 技术 |
|-----|------|
| 前端 | HTML5 + CSS3 + JavaScript (原生) + Canvas 图表 |
| 后端 | Python 3.10+ / FastAPI |
| 数据库 | SQLite |
| 认证 | JWT Token + 密码哈希 |
| 部署 | 跨平台支持（Windows/macOS/Linux） |

## 8. 数据库表结构

系统使用 SQLite 数据库，包含以下核心表：

### 8.1 users 表（用户/读者表）
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,          -- 用户名（唯一）
    password_hash TEXT NOT NULL,              -- 密码哈希
    role TEXT NOT NULL CHECK(role IN ('admin', 'librarian', 'reader')),  -- 角色
    full_name TEXT NOT NULL,                  -- 姓名
    phone TEXT DEFAULT '',                    -- 电话
    email TEXT DEFAULT '',                    -- 邮箱
    department TEXT DEFAULT '',               -- 院系/部门
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'frozen')),  -- 状态
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 8.2 books 表（图书表）
```sql
CREATE TABLE books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,                      -- 书名
    author TEXT NOT NULL,                      -- 作者
    isbn TEXT UNIQUE,                         -- ISBN（唯一）
    publisher TEXT DEFAULT '',                 -- 出版社
    category TEXT DEFAULT '',                  -- 分类
    total_count INTEGER DEFAULT 1,            -- 总库存
    available_count INTEGER DEFAULT 1,        -- 可借数量
    location TEXT DEFAULT '',                 -- 存放位置
    cover_url TEXT DEFAULT '',                 -- 封面图片
    description TEXT DEFAULT '',              -- 简介
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 8.3 borrow_records 表（借阅记录表）
```sql
CREATE TABLE borrow_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,                 -- 图书ID
    reader_id INTEGER NOT NULL,               -- 读者ID
    borrow_date DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 借书日期
    due_date DATETIME NOT NULL,               -- 应还日期
    return_date DATETIME,                     -- 实际归还日期
    status TEXT DEFAULT 'borrowed' CHECK(status IN ('borrowed', 'returned', 'overdue')),  -- 状态
    fine_amount REAL DEFAULT 0,               -- 罚款金额
    remarks TEXT DEFAULT '',                   -- 备注
    FOREIGN KEY (book_id) REFERENCES books(id),
    FOREIGN KEY (reader_id) REFERENCES users(id)
);
```

### 8.4 索引优化
```sql
CREATE INDEX idx_books_title ON books(title);
CREATE INDEX idx_books_category ON books(category);
CREATE INDEX idx_books_isbn ON books(isbn);
CREATE INDEX idx_records_reader_status ON borrow_records(reader_id, status);
CREATE INDEX idx_records_due_date ON borrow_records(due_date);
CREATE INDEX idx_records_book ON borrow_records(book_id);
```

### 8.5 视图优化
```sql
CREATE VIEW v_borrow_detail AS
SELECT r.id, r.book_id, b.title AS book_title,
       r.reader_id, u.full_name AS reader_name,
       r.borrow_date, r.due_date, r.return_date,
       r.status, r.fine_amount,
       CAST(julianday('now') - julianday(r.due_date) AS INTEGER) AS overdue_days
FROM borrow_records r
JOIN books b ON r.book_id = b.id
JOIN users u ON r.reader_id = u.id;
```

## 9. API 接口一览

### 9.1 认证接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 公开 |
| POST | `/api/auth/login` | 用户登录 | 公开 |
| GET | `/api/auth/me` | 获取当前用户信息 | 登录用户 |
| PUT | `/api/auth/password` | 修改密码 | 登录用户 |

### 9.2 图书管理接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| GET | `/api/books` | 获取图书列表（支持分页、筛选） | 登录用户 |
| GET | `/api/books/{id}` | 获取图书详情 | 登录用户 |
| POST | `/api/books` | 新增图书 | 管理员/馆员 |
| PUT | `/api/books/{id}` | 修改图书信息 | 管理员/馆员 |
| DELETE | `/api/books/{id}` | 删除图书 | 管理员 |

### 9.3 借还管理接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| POST | `/api/borrow` | 借书 | 管理员/馆员/读者 |
| POST | `/api/return/{record_id}` | 还书 | 管理员/馆员/读者 |
| GET | `/api/borrow-records` | 获取借阅记录 | 管理员/馆员查看全部，读者查看个人 |
| GET | `/api/overdue` | 获取逾期记录 | 管理员/馆员 |

### 9.4 读者管理接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| GET | `/api/readers` | 获取读者列表 | 管理员/馆员 |
| GET | `/api/readers/{id}` | 获取读者详情 | 管理员/馆员 |
| POST | `/api/readers` | 新增读者 | 管理员/馆员 |
| PUT | `/api/readers/{id}` | 修改读者信息 | 管理员/馆员 |
| DELETE | `/api/readers/{id}` | 删除读者 | 管理员 |
| PUT | `/api/readers/{id}/status` | 冻结/启用读者 | 管理员/馆员 |

### 9.5 统计接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| GET | `/api/stats/overview` | 数据总览 | 管理员/馆员 |
| GET | `/api/stats/category-distribution` | 馆藏分类分布 | 登录用户 |
| GET | `/api/stats/borrow-trend` | 借阅趋势 | 管理员/馆员 |
| GET | `/api/stats/top-books` | 热门图书 Top10 | 登录用户 |

### 9.6 数据导出接口
| 方法 | 路径 | 说明 | 权限 |
|-----|------|------|------|
| GET | `/api/export/books` | 导出图书数据 | 管理员 |
| GET | `/api/export/borrow-records` | 导出借阅记录 | 管理员/馆员 |

## 10. 安全性设计

### 10.1 认证机制
- **JWT Token**：用户登录成功后生成 Token，有效期 24 小时
- **密码哈希**：使用 Python `passlib` 库进行 BCrypt 哈希加密
- **Token 验证**：每个请求需携带 `Authorization: Bearer <token>` 头部

### 10.2 SQL 注入防护
- 所有 SQL 语句使用参数化查询
- 禁止字符串拼接 SQL

### 10.3 输入校验
- 使用 Pydantic 模型进行请求参数校验
- 前端表单必填项校验、数值范围校验、格式校验

### 10.4 权限控制
- API 层：使用 FastAPI 依赖注入进行权限校验
- 业务层：在 services.py 中再次校验用户角色和数据归属

## 11. 性能优化

### 11.1 数据库优化
- 为常用查询字段创建索引
- 使用视图简化复杂查询
- 分页查询避免一次性返回大量数据

### 11.2 前端优化
- Canvas 绘制图表，减少第三方依赖
- 响应式设计，适配多种屏幕
- Toast 提示优化用户体验

### 11.3 可扩展性
- SQLite 可轻松迁移到 MySQL / PostgreSQL
- 模块化设计，便于功能扩展
- API 接口遵循 RESTful 规范

## 12. 注意事项

1. 首次运行时会自动创建 `data/library.db` 并写入演示数据。
2. 如果想重置系统，只需关闭服务后删除 `data/library.db`，重新运行即可重新生成。

import sqlite3

conn = sqlite3.connect('../data/library.db')

# 查看当前users表的创建语句
cursor = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
row = cursor.fetchone()
print('当前表结构:')
print(row[0])

# 查看所有视图
cursor = conn.execute("SELECT name, sql FROM sqlite_master WHERE type='view'")
views = cursor.fetchall()
print('\n存在的视图:')
for name, sql in views:
    print(f'{name}: {sql[:100]}...')

# 删除视图
for name, _ in views:
    conn.execute(f'DROP VIEW IF EXISTS {name}')
    print(f'已删除视图: {name}')

# 修改表结构，添加librarian角色支持
conn.execute('''
    CREATE TABLE IF NOT EXISTS users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'librarian', 'reader')),
        full_name TEXT NOT NULL,
        phone TEXT DEFAULT '',
        email TEXT DEFAULT '',
        department TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'frozen')),
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
''')

# 复制数据
conn.execute('INSERT INTO users_new SELECT * FROM users')

# 删除旧表
conn.execute('DROP TABLE users')

# 重命名新表
conn.execute('ALTER TABLE users_new RENAME TO users')

# 重新创建视图
conn.execute('''
    CREATE VIEW v_borrow_detail AS
    SELECT 
        r.id, r.book_id, r.reader_id, r.borrow_date, r.due_date, r.return_date, r.status, r.remark,
        r.fine_amount, r.fine_paid,
        b.title AS book_title, b.isbn, b.author,
        u.username AS reader_name, u.full_name AS reader_full_name
    FROM borrow_records r
    JOIN books b ON r.book_id = b.id
    JOIN users u ON r.reader_id = u.id
''')
print('已重建视图: v_borrow_detail')

conn.commit()
print('\n表结构已更新，现在支持librarian角色')

conn.close()

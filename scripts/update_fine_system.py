import sqlite3

conn = sqlite3.connect('../data/library.db')

# 1. 向图书表添加定价字段
try:
    conn.execute('ALTER TABLE books ADD COLUMN price REAL DEFAULT 0')
    print('已添加定价字段')
except sqlite3.OperationalError:
    print('定价字段已存在')

# 2. 删除旧视图
conn.execute('DROP VIEW IF EXISTS v_borrow_detail')

# 3. 创建新视图，包含逾期天数计算
conn.execute('''
    CREATE VIEW v_borrow_detail AS
    SELECT
        r.id, r.book_id, r.reader_id, r.borrow_date, r.due_date, r.return_date, r.status, r.remark,
        r.fine_amount, r.fine_paid,
        b.title AS book_title, b.isbn, b.author, b.price,
        u.username AS reader_name, u.full_name AS reader_full_name,
        -- 计算逾期天数
        CASE 
            WHEN r.status = 'returned' AND r.return_date > r.due_date THEN 
                julianday(r.return_date) - julianday(r.due_date)
            WHEN r.status IN ('borrowed', 'overdue') AND date('now') > r.due_date THEN 
                julianday('now') - julianday(r.due_date)
            ELSE 0 
        END AS overdue_days,
        -- 计算借阅时长
        CASE 
            WHEN r.return_date IS NOT NULL THEN julianday(r.return_date) - julianday(r.borrow_date)
            ELSE julianday('now') - julianday(r.borrow_date) 
        END AS borrow_duration_days
    FROM borrow_records r
    JOIN books b ON r.book_id = b.id
    JOIN users u ON r.reader_id = u.id
''')

conn.commit()
print('视图已更新，包含逾期天数和借阅时长计算')

conn.close()

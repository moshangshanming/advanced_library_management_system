import sqlite3

conn = sqlite3.connect('../data/library.db')

# 更新一本图书的价格
conn.execute('UPDATE books SET price = 50.0 WHERE id = 1')
print('已更新图书价格为50元')

# 创建一条逾期的借阅记录（借期已过）
cursor = conn.execute('''
    INSERT INTO borrow_records (book_id, reader_id, borrow_date, due_date, status)
    VALUES (1, 2, '2026-05-01', '2026-05-15', 'overdue')
''')
record_id = cursor.lastrowid
print(f'已创建逾期借阅记录ID: {record_id}')

conn.commit()
conn.close()

print('测试数据准备完成！')

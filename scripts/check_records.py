import sqlite3

conn = sqlite3.connect('../data/library.db')

# 查看所有借阅记录
print('=== 所有借阅记录 ===')
cursor = conn.execute('SELECT * FROM borrow_records ORDER BY id DESC')
cols = [desc[0] for desc in cursor.description]
print(' | '.join(cols))
print('-' * 120)
for row in cursor.fetchall():
    print(' | '.join(str(v) for v in row))

print('\n=== 视图数据 ===')
cursor = conn.execute('SELECT id, book_title, status, overdue_days FROM v_borrow_detail WHERE overdue_days > 0')
print('ID | 图书 | 状态 | 逾期天数')
print('-' * 60)
for row in cursor.fetchall():
    print(f'{row[0]} | {row[1]} | {row[2]} | {row[3]}')

conn.close()

import sqlite3

conn = sqlite3.connect('../data/library.db')

# 查看book_reservations表结构
print('book_reservations 表结构:')
cursor = conn.execute("PRAGMA table_info(book_reservations)")
for row in cursor.fetchall():
    print(f'  - {row[1]}: {row[2]}')

# 查看现有预约记录
print('\n现有预约记录:')
cursor = conn.execute("SELECT * FROM book_reservations LIMIT 5")
rows = cursor.fetchall()
if rows:
    for row in rows:
        print(row)
else:
    print('  暂无预约记录')

conn.close()

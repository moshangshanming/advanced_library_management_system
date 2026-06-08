import sqlite3

conn = sqlite3.connect('../data/library.db')

# 查看视图定义
cursor = conn.execute("SELECT sql FROM sqlite_master WHERE type='view' AND name='v_borrow_detail'")
row = cursor.fetchone()
print('当前视图定义:')
print(row[0])

conn.close()

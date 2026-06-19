import sqlite3
from pathlib import Path

# 数据库文件路径（与后端配置一致）
ROOT_DIR = Path(__file__).resolve().parents[1]
DB_FILE = ROOT_DIR / "data" / "library.db"

conn = sqlite3.connect(DB_FILE)
cursor = conn.cursor()

# 获取所有表名
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("数据库中的表：")
for table in tables:
    print(f"  - {table[0]}")

# 查询预约记录，按ID降序
cursor.execute("SELECT id, book_id, reader_id, status, reserve_date FROM book_reservations ORDER BY id DESC LIMIT 10")
rows = cursor.fetchall()

print("\n数据库中按ID降序的预约记录（最新的在前）：")
print("-" * 60)
print(f"{'ID':<4} {'图书ID':<8} {'读者ID':<8} {'状态':<10} {'预约日期':<12}")
print("-" * 60)
for row in rows:
    print(f"{row[0]:<4} {row[1]:<8} {row[2]:<8} {row[3]:<10} {row[4]:<12}")

conn.close()
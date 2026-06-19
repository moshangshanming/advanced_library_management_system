import json
from app.database import db_manager

# 获取最新的预约记录
row = db_manager.fetch_one("""
    SELECT r.*, b.title AS book_title, u.username AS reader_username, u.full_name AS reader_name
    FROM book_reservations r
    JOIN books b ON r.book_id = b.id
    JOIN users u ON r.reader_id = u.id
    WHERE r.id = 12
""")

print("预约记录:")
print(dict(row))

# 尝试序列化为 JSON
try:
    json_str = json.dumps(dict(row), ensure_ascii=False, default=str)
    print("\nJSON 序列化成功:")
    print(json_str)
except Exception as e:
    print(f"\nJSON 序列化失败: {e}")

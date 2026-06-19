import json
from app.database import db_manager
from datetime import date

# 模拟创建预约的逻辑
book_id = 1
reader_id = 2
current_user = {"id": 2, "role": "reader"}

# 检查是否已经预约
existing = db_manager.fetch_one(
    "SELECT id FROM book_reservations WHERE book_id = ? AND reader_id = ? AND status = 'pending'",
    (book_id, reader_id)
)
print(f"是否已预约: {existing}")

# 创建预约记录
reservation_id = db_manager.execute(
    "INSERT INTO book_reservations(book_id, reader_id, reserve_date, status, notified) VALUES (?, ?, ?, 'pending', 0)",
    (book_id, reader_id, date.today().isoformat())
)
print(f"创建预约成功, ID: {reservation_id}")

# 获取预约详情
row = db_manager.fetch_one("""
    SELECT r.*, b.title AS book_title, u.username AS reader_username, u.full_name AS reader_name
    FROM book_reservations r
    JOIN books b ON r.book_id = b.id
    JOIN users u ON r.reader_id = u.id
    WHERE r.id = ?
""", (reservation_id,))

print(f"\n预约详情:")
for key, value in dict(row).items():
    print(f"  {key}: {value} (type: {type(value).__name__})")

# 尝试序列化为 JSON
try:
    json_str = json.dumps(dict(row), ensure_ascii=False, default=str)
    print(f"\nJSON 序列化成功:")
    print(json_str)
except Exception as e:
    print(f"\nJSON 序列化失败: {e}")

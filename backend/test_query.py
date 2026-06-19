from app.database import db_manager

# 查询用户2的pending预约
rows = db_manager.fetch_all(
    "SELECT id, book_id, reader_id, status FROM book_reservations WHERE reader_id = 2 AND status = 'pending'"
)
print("用户2的pending预约:")
for r in rows:
    print(dict(r))

from app.database import db_manager
db_manager.init_db()

# 检查是否有书评数据
reviews = db_manager.fetch_all("SELECT COUNT(*) as count FROM book_reviews")
print(f"书评数量: {reviews[0]['count']}")

# 检查是否有评分数据
rated_books = db_manager.fetch_all("SELECT COUNT(DISTINCT book_id) as count FROM book_reviews WHERE rating IS NOT NULL")
print(f"有评分的图书数量: {rated_books[0]['count']}")

# 检查读者部门信息
readers = db_manager.fetch_all("SELECT id, username, department FROM users WHERE role = 'reader'")
print("\n读者部门信息:")
for reader in readers:
    print(f"ID: {reader['id']}, 用户: {reader['username']}, 部门: '{reader['department']}'")
from app.database import db_manager
db_manager.init_db()

# 查找库存为0的图书
books = db_manager.fetch_all("SELECT id, title, available_count FROM books WHERE available_count = 0 LIMIT 5")
print("库存为0的图书:")
for book in books:
    print(f"ID: {book['id']}, 书名: {book['title']}, 库存: {book['available_count']}")
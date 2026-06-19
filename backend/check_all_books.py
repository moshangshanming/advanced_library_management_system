from app.database import db_manager
db_manager.init_db()

# 查找所有库存为0的图书
books = db_manager.fetch_all("SELECT id, title, available_count FROM books WHERE available_count = 0")
print("所有库存为0的图书:")
for book in books:
    print(f"ID: {book['id']}, 书名: {book['title']}, 库存: {book['available_count']}")

# 查看reader用户的所有预约
reservations = db_manager.fetch_all("SELECT r.id, r.book_id, b.title, r.status FROM book_reservations r JOIN books b ON r.book_id = b.id WHERE r.reader_id = 2")
print("\nreader用户的预约记录:")
for res in reservations:
    print(f"预约ID: {res['id']}, 图书ID: {res['book_id']}, 书名: {res['title']}, 状态: {res['status']}")
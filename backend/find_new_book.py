from app.database import db_manager
db_manager.init_db()

# 查找库存为0且reader用户未预约的图书
sql = """
SELECT b.id, b.title, b.available_count 
FROM books b
LEFT JOIN book_reservations r ON b.id = r.book_id AND r.reader_id = 2 AND r.status = 'pending'
WHERE b.available_count = 0 AND r.id IS NULL
LIMIT 5
"""
books = db_manager.fetch_all(sql)
print("库存为0且未被预约的图书:")
for book in books:
    print(f"ID: {book['id']}, 书名: {book['title']}, 库存: {book['available_count']}")
from app.database import db_manager
db_manager.init_db()

# 检查软件工程专业其他读者的借阅记录
sql = """
SELECT DISTINCT b.id, b.title, b.category, COUNT(br.id) as borrow_count
FROM books b
JOIN borrow_records br ON b.id = br.book_id
JOIN users u ON br.reader_id = u.id
WHERE u.department = '软件工程专业'
AND br.reader_id != 2
GROUP BY b.id, b.title, b.category
ORDER BY borrow_count DESC
LIMIT 10
"""
rows = db_manager.fetch_all(sql)
print("软件工程专业其他读者借阅过的图书:")
for row in rows:
    print(f"ID: {row['id']}, 书名: {row['title']}, 分类: {row['category']}, 借阅次数: {row['borrow_count']}")

# 检查当前读者(reader_id=2)的借阅记录
sql2 = """
SELECT b.id, b.title FROM books b
JOIN borrow_records br ON b.id = br.book_id
WHERE br.reader_id = 2
"""
borrowed = db_manager.fetch_all(sql2)
print(f"\n当前读者已借阅的图书数量: {len(borrowed)}")
if borrowed:
    borrowed_ids = [str(b['id']) for b in borrowed]
    print(f"已借阅图书ID: {', '.join(borrowed_ids)}")
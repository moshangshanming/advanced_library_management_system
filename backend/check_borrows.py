from app.database import db_manager
db_manager.init_db()

# 查询reader用户（ID=2）借阅中/逾期的记录数量
active = db_manager.fetch_one("SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = 2 AND status IN ('borrowed', 'overdue')")
print(f"借阅中/逾期数量: {active['n']}")

# 查询所有借阅记录状态统计
status_counts = db_manager.fetch_all("SELECT status, COUNT(*) AS count FROM borrow_records WHERE reader_id = 2 GROUP BY status")
print("\n各状态记录数:")
for row in status_counts:
    print(f"  {row['status']}: {row['count']}")
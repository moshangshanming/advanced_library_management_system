"""
预约管理测试数据生成脚本
生成10条预约记录用于测试
"""
import sqlite3
from datetime import datetime, timedelta
import random

DB_PATH = "data/library.db"

def generate_test_reservations():
    """生成预约测试数据"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 获取现有图书和读者
    books = cursor.execute("SELECT id, title, isbn FROM books LIMIT 5").fetchall()
    readers = cursor.execute("SELECT id, full_name, username, department FROM users WHERE role='reader' AND status='active' LIMIT 5").fetchall()
    
    if not books or not readers:
        print("错误：数据库中缺少图书或读者数据")
        return
    
    print(f"找到 {len(books)} 本图书，{len(readers)} 个读者")
    
    # 定义状态分布：待取书4条、已取书2条、已取消2条、已过期2条
    statuses = [
        ('pending', 4),   # 待取书
        ('fulfilled', 2), # 已取书
        ('cancelled', 2), # 已取消
        ('expired', 2)    # 已过期
    ]
    
    # 清除旧的测试数据（可选）
    # cursor.execute("DELETE FROM book_reservations WHERE remark LIKE '%测试数据%'")
    
    test_data = []
    today = datetime.now().date()
    
    for status, count in statuses:
        for i in range(count):
            book = random.choice(books)
            reader = random.choice(readers)
            
            # 生成预约日期（近30天内）
            days_ago = random.randint(0, 29)
            reserve_date = today - timedelta(days=days_ago)
            
            # 有效期
            valid_days = random.choice([3, 7, 15])
            expiry_date = reserve_date + timedelta(days=valid_days)
            
            # 备注
            remarks = [
                "测试数据 - 普通预约",
                "测试数据 - 急需此书",
                "测试数据 - 假期借阅",
                "测试数据 - 教师推荐",
                ""
            ]
            remark = random.choice(remarks)
            
            # 来源
            source = random.choice(['manual', 'reader', 'phone'])
            
            # 插入数据
            try:
                cursor.execute("""
                    INSERT INTO book_reservations 
                    (book_id, reader_id, reserve_date, valid_days, expiry_date, source, remark, status, notified)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                """, (
                    book[0],
                    reader[0],
                    reserve_date.isoformat(),
                    valid_days,
                    expiry_date.isoformat(),
                    source,
                    remark,
                    status
                ))
                
                test_data.append({
                    'id': cursor.lastrowid,
                    'book': book[1],
                    'reader': reader[1],
                    'status': status,
                    'reserve_date': reserve_date.isoformat(),
                    'expiry_date': expiry_date.isoformat()
                })
                
                print(f"✓ 创建预约 #{cursor.lastrowid}: 《{book[1]}》 - {reader[1]} ({status})")
                
            except sqlite3.IntegrityError as e:
                print(f"✗ 创建失败: {e}")
                continue
    
    conn.commit()
    conn.close()
    
    print(f"\n成功生成 {len(test_data)} 条测试数据")
    print("\n数据分布:")
    status_counts = {}
    for item in test_data:
        status_counts[item['status']] = status_counts.get(item['status'], 0) + 1
    
    status_names = {
        'pending': '待取书',
        'fulfilled': '已取书',
        'cancelled': '已取消',
        'expired': '已过期'
    }
    
    for status, count in status_counts.items():
        print(f"  {status_names.get(status, status)}: {count} 条")

if __name__ == "__main__":
    generate_test_reservations()

"""
测试数据库迁移和接口修复
"""
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.app.database import db_manager

def test_database_schema():
    """测试数据库表结构"""
    print("=" * 60)
    print("测试数据库表结构...")
    print("=" * 60)
    
    # 初始化数据库（会添加新字段）
    db_manager.init_db()
    
    # 检查books表的字段
    books_columns = db_manager.fetch_all("PRAGMA table_info(books)")
    book_column_names = [col['name'] for col in books_columns]
    print(f"\nBooks表字段: {book_column_names}")
    
    required_book_fields = ['price', 'cover_image']
    for field in required_book_fields:
        if field in book_column_names:
            print(f"✓ {field} 字段存在")
        else:
            print(f"✗ {field} 字段缺失")
    
    # 检查borrow_records表的字段
    borrow_columns = db_manager.fetch_all("PRAGMA table_info(borrow_records)")
    borrow_column_names = [col['name'] for col in borrow_columns]
    print(f"\nBorrow_records表字段: {borrow_column_names}")
    
    required_borrow_fields = ['fine_amount', 'fine_paid']
    for field in required_borrow_fields:
        if field in borrow_column_names:
            print(f"✓ {field} 字段存在")
        else:
            print(f"✗ {field} 字段缺失")
    
    # 检查视图是否正常
    try:
        test_query = db_manager.fetch_one("SELECT * FROM v_borrow_detail LIMIT 1")
        print(f"\n✓ v_borrow_detail 视图查询成功")
        if test_query:
            print(f"  视图字段: {list(test_query.keys())}")
    except Exception as e:
        print(f"\n✗ v_borrow_detail 视图查询失败: {e}")
    
    print("\n" + "=" * 60)
    print("数据库测试完成")
    print("=" * 60)

if __name__ == "__main__":
    test_database_schema()

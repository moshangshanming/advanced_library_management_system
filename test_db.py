import sqlite3

try:
    conn = sqlite3.connect('backend/library.db')
    cursor = conn.cursor()
    
    # 检查 users 表结构
    cursor.execute("PRAGMA table_info(users)")
    columns = cursor.fetchall()
    print("Users Table Columns:")
    for col in columns:
        print(f"  {col[1]}: {col[2]} {'NOT NULL' if col[3] else ''}")
    
    # 尝试插入一条测试数据
    try:
        cursor.execute('INSERT INTO users(username, password_hash, role, full_name, phone, email, department, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                      ('testuser3', 'testhash', 'reader', 'Test User', '', '', '', 'active'))
        conn.commit()
        print("\nInsert successful!")
        
        # 查询刚插入的数据
        cursor.execute('SELECT * FROM users WHERE username = ?', ('testuser3',))
        row = cursor.fetchone()
        print(f"Inserted row: {row}")
        
        # 删除测试数据
        cursor.execute('DELETE FROM users WHERE username = ?', ('testuser3',))
        conn.commit()
        print("Test data deleted.")
        
    except Exception as e:
        print(f"\nInsert error: {e}")
        
    conn.close()
    print("\nDatabase connection test completed.")
except Exception as e:
    print(f"Database connection error: {e}")
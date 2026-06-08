import sqlite3
import hashlib
import os

def hash_password(password: str) -> str:
    """使用与后端相同的带盐 PBKDF2 哈希"""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"{salt.hex()}${digest.hex()}"

conn = sqlite3.connect('../data/library.db')
try:
    # 先删除已存在的馆员账号
    conn.execute('DELETE FROM users WHERE username = ?', ('librarian',))
    
    # 插入新的馆员账号
    conn.execute('''
        INSERT INTO users 
        (username, password_hash, full_name, phone, email, role, status, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ''', ('librarian', hash_password('librarian123'), '张馆员', '13800138003', 'librarian@library.com', 'librarian', 'active'))
    
    conn.commit()
    print('馆员账号已创建成功')
    
    # 验证创建结果
    cursor = conn.execute('SELECT username, role, status FROM users WHERE username = ?', ('librarian',))
    row = cursor.fetchone()
    print(f'创建的账号: {row}')
except Exception as e:
    print(f'创建失败: {e}')
finally:
    conn.close()

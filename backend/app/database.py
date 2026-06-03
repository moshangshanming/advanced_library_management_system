import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .config import DB_FILE, DATA_DIR
from .security import hash_password


class DatabaseManager:
    """Small SQLite helper with schema initialization, seed data and safe parameterized queries."""

    def __init__(self, db_path: Path = DB_FILE):
        self.db_path = Path(db_path)
        DATA_DIR.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def fetch_one(self, sql: str, params: Tuple[Any, ...] = ()) -> Optional[Dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def fetch_all(self, sql: str, params: Tuple[Any, ...] = ()) -> List[Dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(row) for row in rows]

    def execute(self, sql: str, params: Tuple[Any, ...] = ()) -> int:
        with self.transaction() as conn:
            cursor = conn.execute(sql, params)
            return cursor.lastrowid

    def init_db(self) -> None:
        with self.transaction() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('admin', 'reader')),
                    full_name TEXT NOT NULL,
                    phone TEXT DEFAULT '',
                    email TEXT DEFAULT '',
                    department TEXT DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'frozen')),
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
                );

                CREATE TABLE IF NOT EXISTS books (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    isbn TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL,
                    author TEXT NOT NULL,
                    publisher TEXT DEFAULT '',
                    category TEXT NOT NULL,
                    total_count INTEGER NOT NULL CHECK(total_count >= 0),
                    available_count INTEGER NOT NULL CHECK(available_count >= 0),
                    shelf_location TEXT DEFAULT '',
                    description TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
                );

                CREATE TABLE IF NOT EXISTS borrow_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER NOT NULL,
                    reader_id INTEGER NOT NULL,
                    borrow_date TEXT NOT NULL,
                    due_date TEXT NOT NULL,
                    return_date TEXT,
                    status TEXT NOT NULL CHECK(status IN ('borrowed', 'returned', 'overdue')),
                    remark TEXT DEFAULT '',
                    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE RESTRICT,
                    FOREIGN KEY(reader_id) REFERENCES users(id) ON DELETE RESTRICT
                );

                CREATE TABLE IF NOT EXISTS reminders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_id INTEGER NOT NULL,
                    message TEXT NOT NULL,
                    resolved INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(record_id) REFERENCES borrow_records(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS announcements (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    admin_id INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft', 'published', 'archived')),
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    target_type TEXT NOT NULL,
                    target_id INTEGER,
                    details TEXT DEFAULT '',
                    timestamp TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS book_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    book_id INTEGER NOT NULL,
                    reader_id INTEGER NOT NULL,
                    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
                    review_text TEXT DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                    UNIQUE(book_id, reader_id),
                    FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE,
                    FOREIGN KEY(reader_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
                CREATE INDEX IF NOT EXISTS idx_books_category ON books(category);
                CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
                CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
                CREATE INDEX IF NOT EXISTS idx_records_reader_status ON borrow_records(reader_id, status);
                CREATE INDEX IF NOT EXISTS idx_records_due_date ON borrow_records(due_date);
                CREATE INDEX IF NOT EXISTS idx_records_book ON borrow_records(book_id);
                CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
                CREATE INDEX IF NOT EXISTS idx_announcements_created ON announcements(created_at);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
                CREATE INDEX IF NOT EXISTS idx_reviews_book ON book_reviews(book_id);
                CREATE INDEX IF NOT EXISTS idx_reviews_reader ON book_reviews(reader_id);

                CREATE VIEW IF NOT EXISTS v_borrow_detail AS
                SELECT
                    r.id,
                    r.book_id,
                    b.title AS book_title,
                    b.isbn,
                    r.reader_id,
                    u.full_name AS reader_name,
                    u.username AS reader_username,
                    r.borrow_date,
                    r.due_date,
                    r.return_date,
                    r.status,
                    r.remark,
                    CAST(julianday('now') - julianday(r.due_date) AS INTEGER) AS overdue_days
                FROM borrow_records r
                JOIN books b ON r.book_id = b.id
                JOIN users u ON r.reader_id = u.id;
                """
            )
            self._seed(conn)

    def _seed(self, conn: sqlite3.Connection) -> None:
        user_count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        if user_count == 0:
            conn.executemany(
                """
                INSERT INTO users(username, password_hash, role, full_name, phone, email, department)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    ("admin", hash_password("admin123"), "admin", "系统管理员", "13800000000", "admin@library.local", "图书馆"),
                    ("reader", hash_password("reader123"), "reader", "测试读者", "13900000000", "reader@library.local", "软件工程专业"),
                    ("zhangsan", hash_password("123456"), "reader", "张三", "13611112222", "zhangsan@example.com", "人工智能学院"),
                    ("lisi", hash_password("123456"), "reader", "李四", "13733334444", "lisi@example.com", "经管学院"),
                ],
            )

        book_count = conn.execute("SELECT COUNT(*) AS n FROM books").fetchone()["n"]
        if book_count == 0:
            books = [
                ("9787115546081", "Python编程：从入门到实践", "Eric Matthes", "人民邮电出版社", "计算机", 8, 8, "A-01", "适合初学者的 Python 编程教材。"),
                ("9787115428028", "算法图解", "Aditya Bhargava", "人民邮电出版社", "计算机", 6, 6, "A-02", "用图示讲解常见算法与数据结构。"),
                ("9787121361637", "深入理解计算机系统", "Randal E. Bryant", "机械工业出版社", "计算机", 5, 5, "A-03", "计算机系统经典教材。"),
                ("9787111213826", "数据库系统概念", "Abraham Silberschatz", "机械工业出版社", "数据库", 7, 7, "B-01", "数据库课程经典参考书。"),
                ("9787302423287", "数据可视化实战", "Cole Nussbaumer Knaflic", "清华大学出版社", "数据分析", 4, 4, "B-02", "讲解商业图表与数据故事表达。"),
                ("9787508647357", "从0到1", "Peter Thiel", "中信出版社", "商业管理", 5, 5, "C-01", "创新创业经典读物。"),
                ("9787544253994", "百年孤独", "加西亚·马尔克斯", "南海出版公司", "文学", 4, 4, "D-01", "魔幻现实主义文学名著。"),
                ("9787020002207", "红楼梦", "曹雪芹", "人民文学出版社", "文学", 10, 10, "D-02", "中国古典文学名著。"),
                ("9787208061644", "经济学原理", "N. Gregory Mankiw", "北京大学出版社", "经济金融", 6, 6, "E-01", "经济学入门经典教材。"),
                ("9787111599715", "机器学习", "周志华", "清华大学出版社", "人工智能", 5, 5, "F-01", "机器学习中文经典教材。"),
                ("9787111565727", "深度学习", "Ian Goodfellow", "人民邮电出版社", "人工智能", 4, 4, "F-02", "深度学习领域经典教材。"),
                ("9787121287296", "软件工程：实践者的研究方法", "Roger S. Pressman", "机械工业出版社", "软件工程", 6, 6, "G-01", "软件工程课程参考书。"),
            ]
            conn.executemany(
                """
                INSERT INTO books(isbn, title, author, publisher, category, total_count, available_count, shelf_location, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                books,
            )

        record_count = conn.execute("SELECT COUNT(*) AS n FROM borrow_records").fetchone()["n"]
        if record_count == 0:
            today = date.today()
            reader = conn.execute("SELECT id FROM users WHERE username='reader'").fetchone()["id"]
            zhangsan = conn.execute("SELECT id FROM users WHERE username='zhangsan'").fetchone()["id"]
            lisi = conn.execute("SELECT id FROM users WHERE username='lisi'").fetchone()["id"]
            book1 = conn.execute("SELECT id FROM books WHERE title='Python编程：从入门到实践'").fetchone()["id"]
            book2 = conn.execute("SELECT id FROM books WHERE title='数据库系统概念'").fetchone()["id"]
            book3 = conn.execute("SELECT id FROM books WHERE title='机器学习'").fetchone()["id"]
            book4 = conn.execute("SELECT id FROM books WHERE title='数据可视化实战'").fetchone()["id"]
            sample_records = [
                (book1, reader, (today - timedelta(days=18)).isoformat(), (today + timedelta(days=12)).isoformat(), None, "borrowed", "种子数据：正常借阅"),
                (book2, zhangsan, (today - timedelta(days=45)).isoformat(), (today - timedelta(days=15)).isoformat(), None, "overdue", "种子数据：逾期未还"),
                (book3, lisi, (today - timedelta(days=20)).isoformat(), (today - timedelta(days=2)).isoformat(), today.isoformat(), "returned", "种子数据：已归还"),
                (book4, reader, (today - timedelta(days=7)).isoformat(), (today + timedelta(days=23)).isoformat(), None, "borrowed", "种子数据：正常借阅"),
            ]
            conn.executemany(
                """
                INSERT INTO borrow_records(book_id, reader_id, borrow_date, due_date, return_date, status, remark)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                sample_records,
            )
            conn.execute("UPDATE books SET available_count = available_count - 1 WHERE id IN (?, ?, ?)", (book1, book2, book4))


db_manager = DatabaseManager()

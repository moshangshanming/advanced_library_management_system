import csv
import io
import sqlite3
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from .database import db_manager
from .schemas import BookCreate, BookUpdate, BorrowCreate, ReaderCreate, ReaderUpdate, AnnouncementCreate, AnnouncementUpdate, ReaderImportItem, BookReviewCreate, BookReviewUpdate, UserCreate, UserUpdate, RenewRequest, ReservationCreate
from .security import hash_password


def paginate(page: int, page_size: int) -> Tuple[int, int, int]:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    offset = (page - 1) * page_size
    return page, page_size, offset


def normalize_like(keyword: str) -> str:
    return f"%{keyword.strip()}%"


class BookService:
    def list_books(self, search: str = "", category: str = "", isbn: str = "", author: str = "", publisher: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions = []
        params: List[Any] = []
        if search.strip():
            conditions.append("(title LIKE ? OR author LIKE ? OR isbn LIKE ? OR publisher LIKE ? OR description LIKE ?)")
            like = normalize_like(search)
            params.extend([like, like, like, like, like])
        if isbn.strip():
            conditions.append("isbn LIKE ?")
            params.append(normalize_like(isbn.strip()))
        if author.strip():
            conditions.append("author LIKE ?")
            params.append(normalize_like(author.strip()))
        if publisher.strip():
            conditions.append("publisher LIKE ?")
            params.append(normalize_like(publisher.strip()))
        if category.strip():
            conditions.append("category = ?")
            params.append(category.strip())
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM books{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"""
            SELECT * FROM books
            {where_sql}
            ORDER BY updated_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )
        categories = db_manager.fetch_all("SELECT DISTINCT category FROM books ORDER BY category")
        return {"items": rows, "total": total, "page": page, "page_size": page_size, "categories": [c["category"] for c in categories]}

    def create_book(self, data: BookCreate) -> Dict[str, Any]:
        available = data.available_count if data.available_count is not None else data.total_count
        if available > data.total_count:
            raise HTTPException(status_code=400, detail="可借数量不能大于馆藏总数。")
        try:
            book_id = db_manager.execute(
                """
                INSERT INTO books(isbn, title, author, publisher, category, total_count, available_count, shelf_location, description, cover_image)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (data.isbn.strip(), data.title.strip(), data.author.strip(), data.publisher.strip(), data.category.strip(), data.total_count, available, data.shelf_location.strip(), data.description.strip(), data.cover_image.strip()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="ISBN 已存在，不能重复添加。")
        return self.get_book(book_id)

    def import_books(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        success_count = 0
        fail_count = 0
        errors = []
        for i, item in enumerate(items):
            try:
                book_data = BookCreate(
                    isbn=str(item.get("isbn", "")).strip(),
                    title=str(item.get("title", "")).strip(),
                    author=str(item.get("author", "")).strip(),
                    publisher=str(item.get("publisher", "")).strip(),
                    category=str(item.get("category", "")).strip(),
                    total_count=int(item.get("total_count", 1)),
                    shelf_location=str(item.get("shelf_location", "")).strip(),
                    description=str(item.get("description", "")).strip(),
                )
                self.create_book(book_data)
                success_count += 1
            except Exception as e:
                fail_count += 1
                errors.append(f"第 {i+1} 行: {str(e)}")
        return {"success": success_count, "fail": fail_count, "errors": errors}

    def get_book(self, book_id: int) -> Dict[str, Any]:
        book = db_manager.fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        return book

    def update_book(self, book_id: int, data: BookUpdate) -> Dict[str, Any]:
        old = self.get_book(book_id)
        update_data = data.model_dump(exclude_unset=True, exclude_none=True)
        if not update_data:
            return old
        new_total = update_data.get("total_count", old["total_count"])
        new_available = update_data.get("available_count", old["available_count"])
        borrowed_count = old["total_count"] - old["available_count"]
        if new_total < borrowed_count:
            raise HTTPException(status_code=400, detail=f"当前已有 {borrowed_count} 本借出，馆藏总数不能低于借出数量。")
        if new_available > new_total:
            raise HTTPException(status_code=400, detail="可借数量不能大于馆藏总数。")
        fields = []
        params: List[Any] = []
        for key, value in update_data.items():
            fields.append(f"{key} = ?")
            params.append(value.strip() if isinstance(value, str) else value)
        fields.append("updated_at = datetime('now', 'localtime')")
        params.append(book_id)
        try:
            db_manager.execute(f"UPDATE books SET {', '.join(fields)} WHERE id = ?", tuple(params))
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="ISBN 已存在，不能重复。")
        return self.get_book(book_id)

    def delete_book(self, book_id: int) -> Dict[str, str]:
        self.get_book(book_id)
        active = db_manager.fetch_one("SELECT COUNT(*) AS n FROM borrow_records WHERE book_id = ? AND status IN ('borrowed', 'overdue')", (book_id,))["n"]
        if active:
            raise HTTPException(status_code=400, detail="该图书仍有未归还记录，不能删除。")
        db_manager.execute("DELETE FROM books WHERE id = ?", (book_id,))
        return {"message": "图书已删除。"}


class ReaderService:
    def list_readers(self, search: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions = ["role = 'reader'"]
        params: List[Any] = []
        if search.strip():
            conditions.append("(username LIKE ? OR full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR department LIKE ?)")
            like = normalize_like(search)
            params.extend([like, like, like, like, like])
        where_sql = " WHERE " + " AND ".join(conditions)
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM users{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"""
            SELECT id, username, role, full_name, phone, email, department, status, created_at
            FROM users {where_sql}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def create_reader(self, data: ReaderCreate) -> Dict[str, Any]:
        try:
            user_id = db_manager.execute(
                """
                INSERT INTO users(username, password_hash, role, full_name, phone, email, department, status)
                VALUES (?, ?, 'reader', ?, ?, ?, ?, ?)
                """,
                (data.username.strip(), hash_password(data.password), data.full_name.strip(), data.phone.strip(), data.email.strip(), data.department.strip(), data.status),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="用户名已存在。")
        return self.get_reader(user_id)

    def get_reader(self, reader_id: int) -> Dict[str, Any]:
        row = db_manager.fetch_one(
            """
            SELECT id, username, role, full_name, phone, email, department, status, created_at
            FROM users WHERE id = ? AND role = 'reader'
            """,
            (reader_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail="读者不存在。")
        return row

    def update_reader(self, reader_id: int, data: ReaderUpdate) -> Dict[str, Any]:
        self.get_reader(reader_id)
        update_data = data.model_dump(exclude_unset=True, exclude_none=True)
        if not update_data:
            return self.get_reader(reader_id)
        fields = []
        params: List[Any] = []
        for key, value in update_data.items():
            if key == "password":
                fields.append("password_hash = ?")
                params.append(hash_password(value))
            else:
                fields.append(f"{key} = ?")
                params.append(value.strip() if isinstance(value, str) else value)
        params.append(reader_id)
        db_manager.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ? AND role = 'reader'", tuple(params))
        return self.get_reader(reader_id)

    def delete_reader(self, reader_id: int) -> Dict[str, str]:
        self.get_reader(reader_id)
        active = db_manager.fetch_one("SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status IN ('borrowed', 'overdue')", (reader_id,))["n"]
        if active:
            raise HTTPException(status_code=400, detail="该读者仍有未归还图书，不能删除。")
        db_manager.execute("DELETE FROM users WHERE id = ? AND role = 'reader'", (reader_id,))
        return {"message": "读者已删除。"}


class BorrowService:
    def _sync_overdue_status(self) -> None:
        today = date.today().isoformat()
        db_manager.execute("UPDATE borrow_records SET status = 'overdue' WHERE status = 'borrowed' AND due_date < ?", (today,))

    def borrow_book(self, data: BorrowCreate, current_user: Dict[str, Any]) -> Dict[str, Any]:
        reader_id = data.reader_id
        if current_user["role"] == "reader":
            reader_id = current_user["id"]
        if not reader_id:
            raise HTTPException(status_code=400, detail="管理员借书时必须选择读者。")
        reader = db_manager.fetch_one("SELECT id, status FROM users WHERE id = ? AND role = 'reader'", (reader_id,))
        if not reader:
            raise HTTPException(status_code=404, detail="读者不存在。")
        if reader["status"] != "active":
            raise HTTPException(status_code=400, detail="该读者账号已冻结，不能借书。")
        book = db_manager.fetch_one("SELECT * FROM books WHERE id = ?", (data.book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        if book["available_count"] <= 0:
            raise HTTPException(status_code=400, detail="该图书库存不足，暂时无法借阅。")
        duplicate = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND book_id = ? AND status IN ('borrowed', 'overdue')",
            (reader_id, data.book_id),
        )["n"]
        if duplicate:
            raise HTTPException(status_code=400, detail="该读者已经借阅此书且尚未归还。")
        borrow_date = date.today()
        due_date = borrow_date + timedelta(days=data.days)
        with db_manager.transaction() as conn:
            conn.execute("UPDATE books SET available_count = available_count - 1, updated_at = datetime('now', 'localtime') WHERE id = ?", (data.book_id,))
            cursor = conn.execute(
                """
                INSERT INTO borrow_records(book_id, reader_id, borrow_date, due_date, status, remark)
                VALUES (?, ?, ?, ?, 'borrowed', ?)
                """,
                (data.book_id, reader_id, borrow_date.isoformat(), due_date.isoformat(), data.remark.strip()),
            )
            record_id = cursor.lastrowid
        return self.get_record(record_id, current_user)

    def return_book(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        record = self.get_record(record_id, current_user)
        if record["status"] == "returned":
            raise HTTPException(status_code=400, detail="该记录已经归还。")
        if current_user["role"] == "reader" and record["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能归还自己的借阅记录。")
        
        # 计算逾期罚金：每天 0.5 元
        overdue_days = max(record["overdue_days"], 0)
        fine_amount = round(overdue_days * 0.5, 2)
        
        with db_manager.transaction() as conn:
            conn.execute(
                "UPDATE borrow_records SET status = 'returned', return_date = ?, fine_amount = ? WHERE id = ?",
                (date.today().isoformat(), fine_amount, record_id),
            )
            conn.execute(
                "UPDATE books SET available_count = available_count + 1, updated_at = datetime('now', 'localtime') WHERE id = ?",
                (record["book_id"],),
            )
            conn.execute("UPDATE reminders SET resolved = 1 WHERE record_id = ?", (record_id,))
        return self.get_record(record_id, current_user)

    def get_record(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        self._sync_overdue_status()
        row = db_manager.fetch_one("SELECT * FROM v_borrow_detail WHERE id = ?", (record_id,))
        if not row:
            raise HTTPException(status_code=404, detail="借阅记录不存在。")
        if current_user["role"] == "reader" and row["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该借阅记录。")
        return row

    def list_records(self, current_user: Dict[str, Any], status_filter: str = "", keyword: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        self._sync_overdue_status()
        page, page_size, offset = paginate(page, page_size)
        conditions: List[str] = []
        params: List[Any] = []
        if current_user["role"] == "reader":
            conditions.append("reader_id = ?")
            params.append(current_user["id"])
        if status_filter.strip():
            conditions.append("status = ?")
            params.append(status_filter.strip())
        if keyword.strip():
            conditions.append("(book_title LIKE ? OR reader_name LIKE ? OR isbn LIKE ?)")
            like = normalize_like(keyword)
            params.extend([like, like, like])
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM v_borrow_detail{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"SELECT * FROM v_borrow_detail{where_sql} ORDER BY id DESC LIMIT ? OFFSET ?",
            tuple(params + [page_size, offset]),
        )
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def renew_book(self, record_id: int, data: RenewRequest, current_user: Dict[str, Any]) -> Dict[str, Any]:
        self._sync_overdue_status()
        record = self.get_record(record_id, current_user)
        if record["status"] != "borrowed":
            raise HTTPException(status_code=400, detail="只有借阅中的图书才能续借。")
        if current_user["role"] == "reader" and record["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能续借自己的借阅记录。")
        renew_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE book_id = ? AND reader_id = ? AND return_date IS NOT NULL",
            (record["book_id"], record["reader_id"]),
        )["n"]
        if renew_count >= 2:
            raise HTTPException(status_code=400, detail="该图书最多只能续借2次。")
        new_due_date = date.fromisoformat(record["due_date"]) + timedelta(days=data.days)
        db_manager.execute(
            "UPDATE borrow_records SET due_date = ?, remark = ? WHERE id = ?",
            (new_due_date.isoformat(), data.remark.strip(), record_id),
        )
        return self.get_record(record_id, current_user)

    def reserve_book(self, data: ReservationCreate, current_user: Dict[str, Any]) -> Dict[str, Any]:
        reader_id = current_user["id"]
        if current_user["role"] != "reader":
            raise HTTPException(status_code=400, detail="只有读者才能预约图书。")
        reader = db_manager.fetch_one("SELECT id, status FROM users WHERE id = ? AND role = 'reader'", (reader_id,))
        if not reader or reader["status"] != "active":
            raise HTTPException(status_code=400, detail="读者账号不存在或已冻结。")
        book = db_manager.fetch_one("SELECT * FROM books WHERE id = ?", (data.book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        if book["available_count"] > 0:
            raise HTTPException(status_code=400, detail="该图书当前有库存，可直接借阅，无需预约。")
        active_reserve = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM book_reservations WHERE book_id = ? AND reader_id = ? AND status = 'pending'",
            (data.book_id, reader_id),
        )["n"]
        if active_reserve:
            raise HTTPException(status_code=400, detail="您已经预约了此书。")
        active_borrow = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE book_id = ? AND reader_id = ? AND status IN ('borrowed', 'overdue')",
            (data.book_id, reader_id),
        )["n"]
        if active_borrow:
            raise HTTPException(status_code=400, detail="您正在借阅此书，无法重复预约。")
        cursor = db_manager.execute(
            "INSERT INTO book_reservations(book_id, reader_id, reserve_date) VALUES (?, ?, ?)",
            (data.book_id, reader_id, date.today().isoformat()),
        )
        return self.get_reservation(cursor.lastrowid, current_user)

    def get_reservation(self, reservation_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        row = db_manager.fetch_one(
            """
            SELECT r.*, b.title as book_title, b.isbn, u.full_name as reader_name, u.phone as reader_phone
            FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            WHERE r.id = ?
            """,
            (reservation_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail="预约记录不存在。")
        if current_user["role"] == "reader" and row["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该预约记录。")
        return row

    def list_reservations(self, current_user: Dict[str, Any], status_filter: str = "", keyword: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions: List[str] = []
        params: List[Any] = []
        if current_user["role"] == "reader":
            conditions.append("r.reader_id = ?")
            params.append(current_user["id"])
        if status_filter.strip():
            conditions.append("r.status = ?")
            params.append(status_filter.strip())
        if keyword.strip():
            conditions.append("(b.title LIKE ? OR u.full_name LIKE ? OR b.isbn LIKE ?)")
            like = normalize_like(keyword)
            params.extend([like, like, like])
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = db_manager.fetch_one(
            f"""
            SELECT COUNT(*) AS n FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            {where_sql}
            """,
            tuple(params),
        )["n"]
        rows = db_manager.fetch_all(
            f"""
            SELECT r.*, b.title as book_title, b.isbn, u.full_name as reader_name, u.phone as reader_phone
            FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            {where_sql}
            ORDER BY r.reserve_date DESC, r.id DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def cancel_reservation(self, reservation_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        reservation = self.get_reservation(reservation_id, current_user)
        if reservation["status"] != "pending":
            raise HTTPException(status_code=400, detail="只能取消待处理的预约。")
        if current_user["role"] == "reader" and reservation["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能取消自己的预约。")
        db_manager.execute("UPDATE book_reservations SET status = 'cancelled' WHERE id = ?", (reservation_id,))
        return {"message": "预约已取消。"}

    def overdue_records(self, current_user: Dict[str, Any]) -> List[Dict[str, Any]]:
        self._sync_overdue_status()
        conditions = ["status = 'overdue'"]
        params: List[Any] = []
        if current_user["role"] == "reader":
            conditions.append("reader_id = ?")
            params.append(current_user["id"])
        return db_manager.fetch_all(
            f"SELECT * FROM v_borrow_detail WHERE {' AND '.join(conditions)} ORDER BY due_date ASC",
            tuple(params),
        )

    def generate_reminders(self, current_user: Dict[str, Any]) -> Dict[str, Any]:
        overdue = self.overdue_records(current_user)
        created = []
        with db_manager.transaction() as conn:
            for item in overdue:
                existing = conn.execute(
                    "SELECT id FROM reminders WHERE record_id = ? AND resolved = 0",
                    (item["id"],),
                ).fetchone()
                message = f"提醒：{item['reader_name']} 借阅的《{item['book_title']}》已逾期 {max(item['overdue_days'], 1)} 天，请尽快归还。"
                if existing:
                    conn.execute("UPDATE reminders SET message = ?, created_at = datetime('now', 'localtime') WHERE id = ?", (message, existing["id"]))
                    reminder_id = existing["id"]
                else:
                    cursor = conn.execute("INSERT INTO reminders(record_id, message) VALUES (?, ?)", (item["id"], message))
                    reminder_id = cursor.lastrowid
                created.append({"id": reminder_id, "record_id": item["id"], "message": message})
        return {"total": len(created), "items": created}

    def pay_fine(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """支付罚金"""
        record = self.get_record(record_id, current_user)
        if record["status"] != "returned":
            raise HTTPException(status_code=400, detail="只能支付已归还记录的罚金。")
        if current_user["role"] == "reader" and record["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能支付自己的罚金。")
        if record["fine_paid"]:
            raise HTTPException(status_code=400, detail="该罚金已经支付过了。")
        
        db_manager.execute(
            "UPDATE borrow_records SET fine_paid = 1 WHERE id = ?",
            (record_id,),
        )
        return self.get_record(record_id, current_user)

    def list_unpaid_fines(self, current_user: Dict[str, Any], page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        """查询未支付罚金的记录"""
        page, page_size, offset = paginate(page, page_size)
        conditions = ["status = 'returned'", "fine_amount > 0", "fine_paid = 0"]
        params: List[Any] = []
        
        if current_user["role"] == "reader":
            conditions.append("reader_id = ?")
            params.append(current_user["id"])
        
        where_sql = " WHERE " + " AND ".join(conditions)
        total = db_manager.fetch_one(
            f"SELECT COUNT(*) AS n FROM v_borrow_detail{where_sql}",
            tuple(params),
        )["n"]
        
        rows = db_manager.fetch_all(
            f"SELECT * FROM v_borrow_detail{where_sql} ORDER BY due_date ASC LIMIT ? OFFSET ?",
            tuple(params + [page_size, offset]),
        )
        
        # 计算未支付罚金总额
        unpaid_total = db_manager.fetch_one(
            f"SELECT COALESCE(SUM(fine_amount), 0) AS total FROM v_borrow_detail{where_sql}",
            tuple(params),
        )["total"]
        
        return {"items": rows, "total": total, "page": page, "page_size": page_size, "unpaid_total": unpaid_total}

    def overdue_statistics(self, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """逾期统计"""
        if current_user["role"] == "reader":
            uid = current_user["id"]
            total_overdue = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status IN ('overdue', 'returned') AND fine_amount > 0",
                (uid,)
            )["n"]
            unpaid_overdue = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status = 'returned' AND fine_amount > 0 AND fine_paid = 0",
                (uid,)
            )["n"]
            total_fine = db_manager.fetch_one(
                "SELECT COALESCE(SUM(fine_amount), 0) AS total FROM borrow_records WHERE reader_id = ?",
                (uid,)
            )["total"]
            unpaid_fine = db_manager.fetch_one(
                "SELECT COALESCE(SUM(fine_amount), 0) AS total FROM borrow_records WHERE reader_id = ? AND fine_paid = 0",
                (uid,)
            )["total"]
            return {
                "total_overdue_count": total_overdue,
                "unpaid_overdue_count": unpaid_overdue,
                "total_fine": total_fine,
                "unpaid_fine": unpaid_fine,
            }
        
        # 管理员视角的统计
        total_overdue = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE status IN ('overdue', 'returned') AND fine_amount > 0"
        )["n"]
        unpaid_overdue = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE status = 'returned' AND fine_amount > 0 AND fine_paid = 0"
        )["n"]
        current_overdue = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE status = 'overdue'"
        )["n"]
        total_fine = db_manager.fetch_one(
            "SELECT COALESCE(SUM(fine_amount), 0) AS total FROM borrow_records"
        )["total"]
        unpaid_fine = db_manager.fetch_one(
            "SELECT COALESCE(SUM(fine_amount), 0) AS total FROM borrow_records WHERE fine_paid = 0"
        )["total"]
        
        # 按读者分组统计未支付罚金
        reader_fines = db_manager.fetch_all(
            """
            SELECT u.id, u.full_name, u.username, COUNT(*) AS overdue_count, COALESCE(SUM(fine_amount), 0) AS total_fine
            FROM borrow_records r
            JOIN users u ON r.reader_id = u.id
            WHERE r.status = 'returned' AND r.fine_amount > 0 AND r.fine_paid = 0
            GROUP BY u.id, u.full_name, u.username
            ORDER BY total_fine DESC
            """
        )
        
        return {
            "total_overdue_count": total_overdue,
            "unpaid_overdue_count": unpaid_overdue,
            "current_overdue": current_overdue,
            "total_fine": total_fine,
            "unpaid_fine": unpaid_fine,
            "reader_fines": reader_fines,
        }


class StatsService:
    def overview(self, current_user: Dict[str, Any]) -> Dict[str, Any]:
        borrow_service = BorrowService()
        borrow_service._sync_overdue_status()

        # 这里改成所有角色都可以看到的基础统计数据
        book_total = db_manager.fetch_one(
            "SELECT COALESCE(SUM(total_count), 0) AS n FROM books"
        )["n"]

        reader_total = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE role='reader'"
        )["n"]

        if current_user["role"] == "reader":
            uid = current_user["id"]
            borrowed = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status = 'borrowed'",
                (uid,)
            )["n"]
            overdue = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status = 'overdue'",
                (uid,)
            )["n"]
            returned = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status = 'returned'",
                (uid,)
            )["n"]

            return {
                "book_total": book_total,
                "reader_total": reader_total,
                "borrowed": borrowed,
                "overdue": overdue,
                "returned": returned,
            }

        return {
            "book_total": book_total,
            "reader_total": reader_total,
            "borrowed": db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE status='borrowed'"
            )["n"],
            "overdue": db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE status='overdue'"
            )["n"],
            "returned": db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM borrow_records WHERE status='returned'"
            )["n"],
        }

    def category_distribution(self) -> List[Dict[str, Any]]:
        return db_manager.fetch_all("SELECT category AS name, COUNT(*) AS value FROM books GROUP BY category ORDER BY value DESC")

    def borrow_trend(self, current_user: Dict[str, Any], days: int = 14) -> List[Dict[str, Any]]:
        days = min(max(7, days), 60)
        start = date.today() - timedelta(days=days - 1)
        params: List[Any] = [start.isoformat()]
        condition = "borrow_date >= ?"
        if current_user["role"] == "reader":
            condition += " AND reader_id = ?"
            params.append(current_user["id"])
        rows = db_manager.fetch_all(
            f"SELECT borrow_date AS day, COUNT(*) AS count FROM borrow_records WHERE {condition} GROUP BY borrow_date ORDER BY borrow_date",
            tuple(params),
        )
        mapped = {r["day"]: r["count"] for r in rows}
        return [{"day": (start + timedelta(days=i)).isoformat()[5:], "count": mapped.get((start + timedelta(days=i)).isoformat(), 0)} for i in range(days)]

    def top_books(self) -> List[Dict[str, Any]]:
        return db_manager.fetch_all(
            """
            SELECT b.title, b.category, COUNT(r.id) AS borrow_count
            FROM borrow_records r JOIN books b ON r.book_id = b.id
            GROUP BY b.id
            ORDER BY borrow_count DESC, b.title ASC
            LIMIT 10
            """
        )


class ExportService:
    def to_csv(self, rows: List[Dict[str, Any]]) -> str:
        output = io.StringIO()
        if not rows:
            return ""
        writer = csv.DictWriter(output, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue()

    def export_books(self) -> str:
        rows = db_manager.fetch_all("SELECT id, isbn, title, author, publisher, category, total_count, available_count, shelf_location, created_at FROM books ORDER BY id")
        return self.to_csv(rows)

    def export_records(self, current_user: Dict[str, Any]) -> str:
        conditions: List[str] = []
        params: List[Any] = []
        if current_user["role"] == "reader":
            conditions.append("reader_id = ?")
            params.append(current_user["id"])
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = db_manager.fetch_all(f"SELECT * FROM v_borrow_detail{where_sql} ORDER BY id", tuple(params))
        return self.to_csv(rows)


class ReportService:
    def _resolve_reader(self, current_user: Dict[str, Any], reader_id: Optional[int] = None) -> Dict[str, Any]:
        if current_user["role"] == "reader":
            if reader_id is not None and reader_id != current_user["id"]:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看他人读者报告。")
            return reader_service.get_reader(current_user["id"])
        if reader_id is None:
            raise HTTPException(status_code=400, detail="管理员请指定 reader_id。")
        return reader_service.get_reader(reader_id)

    def generate_reader_report(self, current_user: Dict[str, Any], reader_id: Optional[int] = None) -> Dict[str, Any]:
        reader = self._resolve_reader(current_user, reader_id)
        rows = db_manager.fetch_all(
            "SELECT * FROM v_borrow_detail WHERE reader_id = ? ORDER BY borrow_date DESC",
            (reader["id"],),
        )
        report_items: List[Dict[str, Any]] = []
        total_reading_days = 0
        total_returned_days = 0
        for row in rows:
            borrow_date = date.fromisoformat(row["borrow_date"])
            end_date = date.fromisoformat(row["return_date"]) if row["return_date"] else date.today()
            duration_days = max((end_date - borrow_date).days, 0)
            row["borrow_duration_days"] = duration_days
            report_items.append(row)
            total_reading_days += duration_days
            if row["status"] == "returned":
                total_returned_days += duration_days

        total_borrowed = len(report_items)
        currently_borrowed = sum(1 for item in report_items if item["status"] == "borrowed")
        overdue = sum(1 for item in report_items if item["status"] == "overdue")
        returned = sum(1 for item in report_items if item["status"] == "returned")
        average_borrow_duration = round(total_reading_days / total_borrowed, 1) if total_borrowed else 0.0
        average_return_duration = round(total_returned_days / returned, 1) if returned else 0.0

        return {
            "reader_id": reader["id"],
            "reader_name": reader["full_name"],
            "reader_username": reader["username"],
            "department": reader["department"],
            "generated_at": date.today().isoformat(),
            "summary": {
                "total_borrowed": total_borrowed,
                "currently_borrowed": currently_borrowed,
                "overdue": overdue,
                "returned": returned,
                "total_reading_days": total_reading_days,
                "average_borrow_duration_days": average_borrow_duration,
                "average_return_duration_days": average_return_duration,
            },
            "records": report_items,
        }


book_service = BookService()
reader_service = ReaderService()
borrow_service = BorrowService()
stats_service = StatsService()
export_service = ExportService()
report_service = ReportService()


class AnnouncementService:
    def list_announcements(self, status_filter: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions: List[str] = ["a.status != 'draft'"]  # 读者只看已发布的
        params: List[Any] = []
        if status_filter.strip():
            conditions.append("a.status = ?")
            params.append(status_filter.strip())
        where_sql = " WHERE " + " AND ".join(conditions)
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM announcements a{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"""
            SELECT a.id, a.title, a.content, a.admin_id, u.full_name AS admin_name, a.status, a.created_at, a.updated_at
            FROM announcements a
            LEFT JOIN users u ON a.admin_id = u.id
            {where_sql}
            ORDER BY a.created_at DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def create_announcement(self, data: AnnouncementCreate, admin_id: int) -> Dict[str, Any]:
        announcement_id = db_manager.execute(
            """
            INSERT INTO announcements(title, content, admin_id, status)
            VALUES (?, ?, ?, ?)
            """,
            (data.title.strip(), data.content.strip(), admin_id, data.status),
        )
        return self.get_announcement(announcement_id)

    def get_announcement(self, announcement_id: int) -> Dict[str, Any]:
        row = db_manager.fetch_one(
            """
            SELECT a.id, a.title, a.content, a.admin_id, u.full_name AS admin_name, a.status, a.created_at, a.updated_at
            FROM announcements a
            LEFT JOIN users u ON a.admin_id = u.id
            WHERE a.id = ?
            """,
            (announcement_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail="公告不存在。")
        return row

    def update_announcement(self, announcement_id: int, data: AnnouncementUpdate) -> Dict[str, Any]:
        self.get_announcement(announcement_id)
        update_data = data.model_dump(exclude_unset=True, exclude_none=True)
        if not update_data:
            return self.get_announcement(announcement_id)
        fields = []
        params: List[Any] = []
        for key, value in update_data.items():
            fields.append(f"{key} = ?")
            params.append(value.strip() if isinstance(value, str) else value)
        fields.append("updated_at = datetime('now', 'localtime')")
        params.append(announcement_id)
        db_manager.execute(f"UPDATE announcements SET {', '.join(fields)} WHERE id = ?", tuple(params))
        return self.get_announcement(announcement_id)

    def delete_announcement(self, announcement_id: int) -> Dict[str, str]:
        self.get_announcement(announcement_id)
        db_manager.execute("DELETE FROM announcements WHERE id = ?", (announcement_id,))
        return {"message": "公告已删除。"}


class AuditLogService:
    def log_action(self, user_id: int, action: str, target_type: str, target_id: Optional[int] = None, details: str = "") -> int:
        log_id = db_manager.execute(
            """
            INSERT INTO audit_logs(user_id, action, target_type, target_id, details)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, action, target_type, target_id, details),
        )
        return log_id

    def list_logs(self, user_id_filter: Optional[int] = None, action_filter: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions: List[str] = []
        params: List[Any] = []
        if user_id_filter:
            conditions.append("user_id = ?")
            params.append(user_id_filter)
        if action_filter.strip():
            conditions.append("action = ?")
            params.append(action_filter.strip())
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM audit_logs{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"""
            SELECT a.id, a.user_id, u.username, a.action, a.target_type, a.target_id, a.details, a.timestamp
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {where_sql}
            ORDER BY a.timestamp DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def export_logs(self, user_id_filter: Optional[int] = None, action_filter: str = "") -> str:
        conditions: List[str] = []
        params: List[Any] = []
        if user_id_filter:
            conditions.append("user_id = ?")
            params.append(user_id_filter)
        if action_filter.strip():
            conditions.append("action = ?")
            params.append(action_filter.strip())
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        rows = db_manager.fetch_all(
            f"""
            SELECT a.id, a.user_id, u.username, a.action, a.target_type, a.target_id, a.details, a.timestamp
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {where_sql}
            ORDER BY a.timestamp DESC
            """,
            tuple(params),
        )
        return export_service.to_csv(rows)


class BookReviewService:
    def get_book_reviews(self, book_id: int) -> List[Dict[str, Any]]:
        rows = db_manager.fetch_all(
            """
            SELECT br.id, br.book_id, br.reader_id, u.full_name AS reader_name, br.rating, br.review_text, br.created_at, br.updated_at
            FROM book_reviews br
            LEFT JOIN users u ON br.reader_id = u.id
            WHERE br.book_id = ?
            ORDER BY br.created_at DESC
            """,
            (book_id,),
        )
        return rows

    def add_review(self, data: BookReviewCreate, reader_id: int) -> Dict[str, Any]:
        # 检查图书是否存在
        book = db_manager.fetch_one("SELECT id FROM books WHERE id = ?", (data.book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        
        # 检查是否已评论过
        existing = db_manager.fetch_one(
            "SELECT id FROM book_reviews WHERE book_id = ? AND reader_id = ?",
            (data.book_id, reader_id),
        )
        if existing:
            # 更新评论
            db_manager.execute(
                """
                UPDATE book_reviews SET rating = ?, review_text = ?, updated_at = datetime('now', 'localtime')
                WHERE book_id = ? AND reader_id = ?
                """,
                (data.rating, data.review_text.strip(), data.book_id, reader_id),
            )
            return self.get_review(existing["id"], reader_id)
        
        # 新建评论
        review_id = db_manager.execute(
            """
            INSERT INTO book_reviews(book_id, reader_id, rating, review_text)
            VALUES (?, ?, ?, ?)
            """,
            (data.book_id, reader_id, data.rating, data.review_text.strip()),
        )
        return self.get_review(review_id, reader_id)

    def get_review(self, review_id: int, reader_id: int) -> Dict[str, Any]:
        row = db_manager.fetch_one(
            """
            SELECT br.id, br.book_id, br.reader_id, u.full_name AS reader_name, br.rating, br.review_text, br.created_at, br.updated_at
            FROM book_reviews br
            LEFT JOIN users u ON br.reader_id = u.id
            WHERE br.id = ? AND br.reader_id = ?
            """,
            (review_id, reader_id),
        )
        if not row:
            raise HTTPException(status_code=404, detail="评论不存在。")
        return row

    def get_book_with_reviews(self, book_id: int) -> Dict[str, Any]:
        book = db_manager.fetch_one("SELECT id, isbn, title, author, category FROM books WHERE id = ?", (book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        
        reviews = self.get_book_reviews(book_id)
        avg_rating = None
        if reviews:
            avg_rating = round(sum(r["rating"] for r in reviews) / len(reviews), 2)
        
        return {
            **book,
            "average_rating": avg_rating,
            "review_count": len(reviews),
            "reviews": reviews,
        }


class ReaderBulkImportService:
    def import_readers_csv(self, csv_content: str) -> Dict[str, Any]:
        """批量导入读者"""
        lines = csv_content.strip().split('\n')
        if not lines:
            raise HTTPException(status_code=400, detail="CSV 文件为空。")
        
        reader = csv.DictReader(io.StringIO(csv_content))
        if not reader.fieldnames:
            raise HTTPException(status_code=400, detail="CSV 文件格式错误。")
        
        results = {
            "total": 0,
            "success": 0,
            "failed": 0,
            "errors": [],
        }
        
        for idx, row in enumerate(reader, start=2):  # 从第2行开始（第1行是标题）
            try:
                item = ReaderImportItem(
                    username=row.get("username", "").strip(),
                    password=row.get("password", "").strip(),
                    full_name=row.get("full_name", "").strip(),
                    phone=row.get("phone", "").strip(),
                    email=row.get("email", "").strip(),
                    department=row.get("department", "").strip(),
                )
                reader_service.create_reader(item)
                results["success"] += 1
            except ValueError as e:
                results["failed"] += 1
                results["errors"].append({"row": idx, "error": str(e)})
            except HTTPException as e:
                results["failed"] += 1
                results["errors"].append({"row": idx, "error": e.detail})
            except Exception as e:
                results["failed"] += 1
                results["errors"].append({"row": idx, "error": str(e)})
            finally:
                results["total"] += 1
        
        return results

    def export_readers(self) -> str:
        """导出读者为 CSV"""
        rows = db_manager.fetch_all(
            """
            SELECT id, username, full_name, phone, email, department, status, created_at
            FROM users WHERE role = 'reader'
            ORDER BY id
            """
        )
        return export_service.to_csv(rows)


class RecommendationService:
    def recommend_by_category(self, reader_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """根据读者历史借阅分类推荐图书"""
        # 获取读者借阅过的分类
        borrowed_categories = db_manager.fetch_all(
            """
            SELECT DISTINCT b.category FROM books b
            JOIN borrow_records br ON b.id = br.book_id
            WHERE br.reader_id = ?
            """,
            (reader_id,),
        )
        
        if not borrowed_categories:
            return []
        
        categories = [c["category"] for c in borrowed_categories]
        placeholders = ",".join("?" * len(categories))
        
        # 推荐相同分类且未借阅过的图书
        rows = db_manager.fetch_all(
            f"""
            SELECT DISTINCT b.* FROM books b
            WHERE b.category IN ({placeholders})
            AND b.id NOT IN (
                SELECT book_id FROM borrow_records WHERE reader_id = ?
            )
            ORDER BY b.updated_at DESC
            LIMIT ?
            """,
            tuple(categories + [reader_id, limit]),
        )
        return rows

    def recommend_by_popular(self, reader_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """根据热门借阅榜推荐图书"""
        rows = db_manager.fetch_all(
            """
            SELECT b.* FROM books b
            LEFT JOIN (
                SELECT book_id, COUNT(*) as borrow_count
                FROM borrow_records
                GROUP BY book_id
            ) stats ON b.id = stats.book_id
            WHERE b.id NOT IN (
                SELECT book_id FROM borrow_records WHERE reader_id = ?
            )
            ORDER BY COALESCE(stats.borrow_count, 0) DESC, b.updated_at DESC
            LIMIT ?
            """,
            (reader_id, limit),
        )
        return rows

    def recommend_by_rating(self, reader_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """根据评分和评论推荐高质量图书"""
        rows = db_manager.fetch_all(
            """
            SELECT b.*, AVG(br.rating) as avg_rating, COUNT(br.id) as review_count
            FROM books b
            LEFT JOIN book_reviews br ON b.id = br.book_id
            WHERE b.id NOT IN (
                SELECT book_id FROM borrow_records WHERE reader_id = ?
            )
            AND br.rating IS NOT NULL
            GROUP BY b.id
            ORDER BY avg_rating DESC, review_count DESC
            LIMIT ?
            """,
            (reader_id, limit),
        )
        return rows

    def recommend_by_department(self, reader_id: int, limit: int = 5) -> List[Dict[str, Any]]:
        """根据专业或院系推荐相关书籍"""
        # 获取读者的部门/专业
        reader = reader_service.get_reader(reader_id)
        department = reader.get("department", "").strip()
        
        if not department:
            return []
        
        # 推荐该部门其他读者借阅过的图书
        rows = db_manager.fetch_all(
            """
            SELECT DISTINCT b.* FROM books b
            JOIN borrow_records br ON b.id = br.book_id
            JOIN users u ON br.reader_id = u.id
            WHERE u.department = ?
            AND b.id NOT IN (
                SELECT book_id FROM borrow_records WHERE reader_id = ?
            )
            ORDER BY b.updated_at DESC
            LIMIT ?
            """,
            (department, reader_id, limit),
        )
        return rows

    def get_all_recommendations(self, reader_id: int) -> Dict[str, List[Dict[str, Any]]]:
        """获取所有推荐"""
        return {
            "by_category": self.recommend_by_category(reader_id),
            "by_popular": self.recommend_by_popular(reader_id),
            "by_rating": self.recommend_by_rating(reader_id),
            "by_department": self.recommend_by_department(reader_id),
        }


announcement_service = AnnouncementService()
audit_log_service = AuditLogService()
book_review_service = BookReviewService()
reader_bulk_import_service = ReaderBulkImportService()
recommendation_service = RecommendationService()


class UserService:
    ROLE_PERMISSIONS = {
        "admin": {
            "name": "管理员",
            "permissions": [
                "manage_users",
                "manage_books",
                "manage_borrow",
                "manage_announcements",
                "view_stats",
                "view_reports",
                "view_audit_logs",
                "import_export",
            ],
        },
        "librarian": {
            "name": "馆员",
            "permissions": [
                "manage_books",
                "manage_borrow",
                "manage_announcements",
                "view_stats",
                "view_reports",
                "import_export",
            ],
        },
        "reader": {
            "name": "普通读者",
            "permissions": [
                "borrow_books",
                "view_books",
                "view_reviews",
                "add_reviews",
                "view_recommendations",
            ],
        },
    }

    def list_users(
        self, search: str = "", role: str = "", page: int = 1, page_size: int = 10
    ) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions: List[str] = []
        params: List[Any] = []

        if search.strip():
            conditions.append(
                "(username LIKE ? OR full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR department LIKE ?)"
            )
            like = normalize_like(search)
            params.extend([like, like, like, like, like])

        if role.strip():
            conditions.append("role = ?")
            params.append(role.strip())

        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""

        total = db_manager.fetch_one(
            f"SELECT COUNT(*) AS n FROM users{where_sql}", tuple(params)
        )["n"]

        rows = db_manager.fetch_all(
            f"""
            SELECT id, username, role, full_name, phone, email, department, status, created_at
            FROM users {where_sql}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
            """,
            tuple(params + [page_size, offset]),
        )

        for row in rows:
            row["role_name"] = self.ROLE_PERMISSIONS.get(row["role"], {}).get(
                "name", row["role"]
            )

        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def create_user(self, data: UserCreate) -> Dict[str, Any]:
        try:
            user_id = db_manager.execute(
                """
                INSERT INTO users(username, password_hash, role, full_name, phone, email, department, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data.username.strip(),
                    hash_password(data.password),
                    data.role.strip(),
                    data.full_name.strip(),
                    data.phone.strip(),
                    data.email.strip(),
                    data.department.strip(),
                    data.status.strip(),
                ),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="用户名已存在。")

        return self.get_user(user_id)

    def get_user(self, user_id: int) -> Dict[str, Any]:
        row = db_manager.fetch_one(
            """
            SELECT id, username, role, full_name, phone, email, department, status, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        )

        if not row:
            raise HTTPException(status_code=404, detail="用户不存在。")

        row["role_name"] = self.ROLE_PERMISSIONS.get(row["role"], {}).get(
            "name", row["role"]
        )

        return row

    def update_user(self, user_id: int, data: UserUpdate) -> Dict[str, Any]:
        self.get_user(user_id)

        update_data = data.model_dump(exclude_unset=True, exclude_none=True)

        if not update_data:
            return self.get_user(user_id)

        fields = []
        params: List[Any] = []

        for key, value in update_data.items():
            if key == "password":
                fields.append("password_hash = ?")
                params.append(hash_password(value))
            else:
                fields.append(f"{key} = ?")
                params.append(value.strip() if isinstance(value, str) else value)

        params.append(user_id)

        db_manager.execute(
            f"UPDATE users SET {', '.join(fields)} WHERE id = ?", tuple(params)
        )

        return self.get_user(user_id)

    def delete_user(self, user_id: int) -> Dict[str, str]:
        user = self.get_user(user_id)

        if user["role"] == "admin":
            admin_count = db_manager.fetch_one(
                "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'"
            )["n"]
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="至少需要保留一个活跃的管理员账户。")

        active_borrows = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE reader_id = ? AND status IN ('borrowed', 'overdue')",
            (user_id,),
        )["n"]

        if active_borrows > 0:
            raise HTTPException(
                status_code=400, detail="该用户仍有未归还的图书，无法删除。"
            )

        db_manager.execute("DELETE FROM users WHERE id = ?", (user_id,))

        return {"message": "用户已删除。"}

    def get_role_permissions(self, role: str) -> Dict[str, Any]:
        return self.ROLE_PERMISSIONS.get(role, {"name": role, "permissions": []})

    def list_roles(self) -> List[Dict[str, Any]]:
        return [
            {"role": role, "name": details["name"], "permissions": details["permissions"]}
            for role, details in self.ROLE_PERMISSIONS.items()
        ]

    def get_user_stats(self) -> Dict[str, Any]:
        admin_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"
        )["n"]
        librarian_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'librarian'"
        )["n"]
        reader_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE role = 'reader'"
        )["n"]

        active_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE status = 'active'"
        )["n"]
        frozen_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE status = 'frozen'"
        )["n"]

        return {
            "admin_count": admin_count,
            "librarian_count": librarian_count,
            "reader_count": reader_count,
            "active_count": active_count,
            "frozen_count": frozen_count,
            "total_count": admin_count + librarian_count + reader_count,
        }


user_service = UserService()

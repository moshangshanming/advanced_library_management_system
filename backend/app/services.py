import csv
import io
import sqlite3
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status

from .database import db_manager
from .schemas import BookCreate, BookUpdate, BorrowCreate, ReaderCreate, ReaderUpdate, AnnouncementCreate, AnnouncementUpdate, ReaderImportItem, BookReviewCreate, BookReviewUpdate
from .security import hash_password


def paginate(page: int, page_size: int) -> Tuple[int, int, int]:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    offset = (page - 1) * page_size
    return page, page_size, offset


def normalize_like(keyword: str) -> str:
    return f"%{keyword.strip()}%"


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
            SELECT a.id, u.username, a.action, a.target_type, a.target_id, a.details, a.timestamp
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.id
            {where_sql}
            ORDER BY a.timestamp DESC
            """,
            tuple(params),
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "操作员", "操作类型", "目标类型", "目标ID", "详情", "时间"])
        for row in rows:
            writer.writerow([row["id"], row["username"], row["action"], row["target_type"], row["target_id"], row["details"], row["timestamp"]])
        return output.getvalue()


audit_log_service = AuditLogService()


class BookService:
    def list_books(self, search: str = "", category: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        page, page_size, offset = paginate(page, page_size)
        conditions = []
        params: List[Any] = []
        if search.strip():
            conditions.append("(title LIKE ? OR author LIKE ? OR isbn LIKE ? OR publisher LIKE ?)")
            like = normalize_like(search)
            params.extend([like, like, like, like])
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
                INSERT INTO books(isbn, title, author, publisher, category, total_count, available_count, shelf_location, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (data.isbn.strip(), data.title.strip(), data.author.strip(), data.publisher.strip(), data.category.strip(), data.total_count, available, data.shelf_location.strip(), data.description.strip()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="ISBN 已存在，不能重复添加。")
        return self.get_book(book_id)

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
        """同步逾期状态并自动计算罚金"""
        today = date.today().isoformat()
        
        # 更新状态为逾期
        db_manager.execute("UPDATE borrow_records SET status = 'overdue' WHERE status = 'borrowed' AND due_date < ?", (today,))
        
        # 获取所有逾期记录
        overdue_records = db_manager.fetch_all("SELECT * FROM v_borrow_detail WHERE status = 'overdue'")
        
        # 为每条逾期记录计算并更新罚金
        for record in overdue_records:
            fine_amount = self._calculate_fine(record)
            if fine_amount > 0:
                db_manager.execute("UPDATE borrow_records SET fine_amount = ? WHERE id = ?", (fine_amount, record["id"]))

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
        
        # 计算逾期罚金
        fine_amount = self._calculate_fine(record)
        
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
        
        # 处理该图书的预约（通知第一个预约用户）
        self.process_reservations(record["book_id"])
        
        return self.get_record(record_id, current_user)

    def _calculate_fine(self, record: Dict[str, Any]) -> float:
        """计算逾期罚金"""
        overdue_days = int(record.get("overdue_days", 0))
        if overdue_days <= 0:
            return 0.0
        
        price = float(record.get("price", 0))
        if price <= 0:
            # 如果没有定价，使用默认每天0.1元
            daily_fine = 0.1
            max_fine = 20.0  # 最大罚金20元
        else:
            # 罚金 = 定价 * 0.05 * 逾期天数，上限为定价的2倍
            daily_fine = price * 0.05
            max_fine = price * 2
        
        fine = daily_fine * overdue_days
        return round(min(fine, max_fine), 2)

    def pay_fine(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """缴纳罚金"""
        record = self.get_record(record_id, current_user)
        if current_user["role"] == "reader" and record["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能缴纳自己的罚金。")
        if record["fine_paid"] == 1:
            raise HTTPException(status_code=400, detail="该罚金已缴纳。")
        if record["fine_amount"] <= 0:
            raise HTTPException(status_code=400, detail="没有需要缴纳的罚金。")
        
        db_manager.execute(
            "UPDATE borrow_records SET fine_paid = 1 WHERE id = ?",
            (record_id,)
        )
        
        audit_log_service.log_action(
            user_id=current_user["id"],
            action="PAY_FINE",
            target_type="borrow_record",
            target_id=record_id,
            details=f"缴纳罚金: {record['fine_amount']}元"
        )
        
        return {"message": f"罚金缴纳成功，金额: {record['fine_amount']}元", "fine_amount": record["fine_amount"]}

    def get_record(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        self._sync_overdue_status()
        row = db_manager.fetch_one("SELECT * FROM v_borrow_detail WHERE id = ?", (record_id,))
        if not row:
            raise HTTPException(status_code=404, detail="借阅记录不存在。")
        if current_user["role"] == "reader" and row["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该借阅记录。")
        return row

    def get_book_borrow_count(self, book_id: int) -> int:
        """获取某本书的借阅次数"""
        result = db_manager.fetch_one("SELECT COUNT(*) AS count FROM borrow_records WHERE book_id = ?", (book_id,))
        return result["count"] if result else 0

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

    def overdue_records_paginated(
        self, current_user: Dict[str, Any], sort: str = "due_date_asc", keyword: str = "", page: int = 1, page_size: int = 10
    ) -> Dict[str, Any]:
        """分页查询逾期记录"""
        self._sync_overdue_status()
        page, page_size, offset = paginate(page, page_size)
        
        # 处理排序
        sort_map = {
            "due_date_asc": "due_date ASC",
            "due_date_desc": "due_date DESC",
            "overdue_days_desc": "overdue_days DESC",
            "fine_desc": "fine_amount DESC",
        }
        order_by = sort_map.get(sort, "due_date ASC")
        
        # 处理条件 - 显示所有逾期过的记录（包括已归还但有逾期历史的）
        conditions = ["overdue_days > 0"]
        params: List[Any] = []
        
        if current_user["role"] == "reader":
            conditions.append("reader_id = ?")
            params.append(current_user["id"])
        
        if keyword.strip():
            conditions.append("(book_title LIKE ? OR reader_name LIKE ?)")
            like = normalize_like(keyword)
            params.extend([like, like])
        
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        
        total = db_manager.fetch_one(f"SELECT COUNT(*) AS n FROM v_borrow_detail{where_sql}", tuple(params))["n"]
        rows = db_manager.fetch_all(
            f"SELECT * FROM v_borrow_detail{where_sql} ORDER BY {order_by} LIMIT ? OFFSET ?",
            tuple(params + [page_size, offset]),
        )
        
        # 获取提醒消息列表
        messages = db_manager.fetch_all(
            "SELECT id, message, created_at FROM reminders WHERE resolved = 0 ORDER BY created_at DESC LIMIT 5"
        )
        
        return {"items": rows, "total": total, "page": page, "page_size": page_size, "messages": messages}

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

    def send_reminder(self, record_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """发送提醒通知（根据借阅记录id）"""
        # 获取借阅记录详情
        record = db_manager.fetch_one("SELECT * FROM v_borrow_detail WHERE id = ?", (record_id,))
        if not record:
            raise HTTPException(status_code=404, detail="借阅记录不存在。")
        
        # 获取或创建提醒记录
        reminder = db_manager.fetch_one("SELECT id FROM reminders WHERE record_id = ? AND resolved = 0", (record_id,))
        if not reminder:
            # 创建提醒记录
            message = f"提醒：{record['reader_name']} 借阅的《{record['book_title']}》已逾期 {max(int(record['overdue_days']), 1)} 天，请尽快归还。"
            reminder_id = db_manager.execute("INSERT INTO reminders(record_id, message) VALUES (?, ?)", (record_id, message))
        else:
            reminder_id = reminder["id"]
        
        # 更新状态为已通知
        db_manager.execute("UPDATE reminders SET notified = 1, notified_at = datetime('now', 'localtime') WHERE id = ?", (reminder_id,))
        
        # 发送消息给读者
        db_manager.execute(
            """
            INSERT INTO messages(user_id, title, content, type)
            VALUES (?, ?, ?, 'overdue')
            """,
            (record["reader_id"], "逾期提醒", f"您借阅的《{record['book_title']}》已逾期 {max(int(record['overdue_days']), 1)} 天，请尽快归还。"),
        )
        
        audit_log_service.log_action(
            user_id=current_user["id"],
            action="SEND_REMINDER",
            target_type="reminder",
            target_id=reminder_id,
            details=f"向读者 {record['reader_name']} 发送逾期提醒"
        )
        
        return {"message": f"提醒通知已发送给读者 {record['reader_name']}"}

    def renew_book(self, record_id: int, days: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """续借图书"""
        record = self.get_record(record_id, current_user)
        if record["status"] == "returned":
            raise HTTPException(status_code=400, detail="该记录已经归还，无法续借。")
        if current_user["role"] == "reader" and record["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能续借自己的借阅记录。")
        
        # 检查续借次数限制（最多续借2次）
        renew_count = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM borrow_records WHERE book_id = ? AND reader_id = ? AND status = 'returned'",
            (record["book_id"], record["reader_id"])
        )["n"]
        if renew_count >= 2:
            raise HTTPException(status_code=400, detail="该图书最多只能续借2次。")
        
        # 更新借阅记录，延长到期日期
        db_manager.execute(
            "UPDATE borrow_records SET due_date = date(due_date, ?), remark = COALESCE(remark || '; ', '') || ? WHERE id = ?",
            (f'+{days} days', f'续借{days}天', record_id)
        )
        
        return self.get_record(record_id, current_user)

    def create_reservation(self, book_id: int, reader_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """创建预约"""
        # 确定读者ID
        if current_user["role"] == "reader":
            reader_id = current_user["id"]
        if not reader_id:
            raise HTTPException(status_code=400, detail="管理员预约时必须选择读者。")
        
        # 检查读者是否存在
        reader = db_manager.fetch_one("SELECT id, status FROM users WHERE id = ? AND role = 'reader'", (reader_id,))
        if not reader:
            raise HTTPException(status_code=404, detail="读者不存在。")
        if reader["status"] != "active":
            raise HTTPException(status_code=400, detail="该读者账号已冻结，不能预约。")
        
        # 检查图书是否存在
        book = db_manager.fetch_one("SELECT * FROM books WHERE id = ?", (book_id,))
        if not book:
            raise HTTPException(status_code=404, detail="图书不存在。")
        
        # 如果图书有库存，直接借阅，不需要预约
        if book["available_count"] > 0:
            raise HTTPException(status_code=400, detail="该图书当前有库存，可直接借阅，无需预约。")
        
        # 检查是否已经预约
        existing = db_manager.fetch_one(
            "SELECT id FROM book_reservations WHERE book_id = ? AND reader_id = ? AND status = 'pending'",
            (book_id, reader_id)
        )
        if existing:
            raise HTTPException(status_code=400, detail="您已经预约了这本图书。")
        
        # 创建预约记录
        cursor = db_manager.execute(
            "INSERT INTO book_reservations(book_id, reader_id, reserve_date, status, notified) VALUES (?, ?, ?, 'pending', 0)",
            (book_id, reader_id, date.today().isoformat())
        )
        reservation_id = cursor.lastrowid
        
        return self.get_reservation(reservation_id)

    def get_reservation(self, reservation_id: int) -> Dict[str, Any]:
        """获取预约记录详情"""
        row = db_manager.fetch_one("""
            SELECT r.*, b.title AS book_title, u.username AS reader_username, u.full_name AS reader_name
            FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            WHERE r.id = ?
        """, (reservation_id,))
        if not row:
            raise HTTPException(status_code=404, detail="预约记录不存在。")
        return row

    def list_reservations(self, current_user: Dict[str, Any], status_filter: str = "", keyword: str = "", page: int = 1, page_size: int = 10) -> Dict[str, Any]:
        """列出预约记录"""
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
            conditions.append("(b.title LIKE ? OR u.username LIKE ? OR u.full_name LIKE ?)")
            like = normalize_like(keyword)
            params.extend([like, like, like])
        
        where_sql = " WHERE " + " AND ".join(conditions) if conditions else ""
        total = db_manager.fetch_one(f"""
            SELECT COUNT(*) AS n FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            {where_sql}
        """, tuple(params))["n"]
        
        rows = db_manager.fetch_all(f"""
            SELECT r.*, b.title AS book_title, b.total_count, b.available_count, u.username AS reader_username, u.full_name AS reader_name
            FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            {where_sql}
            ORDER BY r.reserve_date ASC
            LIMIT ? OFFSET ?
        """, tuple(params + [page_size, offset]))
        
        return {"items": rows, "total": total, "page": page, "page_size": page_size}

    def cancel_reservation(self, reservation_id: int, current_user: Dict[str, Any]) -> Dict[str, Any]:
        """取消预约"""
        reservation = self.get_reservation(reservation_id)
        if current_user["role"] == "reader" and reservation["reader_id"] != current_user["id"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能取消自己的预约。")
        if reservation["status"] != "pending":
            raise HTTPException(status_code=400, detail="该预约已完成或已取消，无法取消。")
        
        db_manager.execute("UPDATE book_reservations SET status = 'cancelled' WHERE id = ?", (reservation_id,))
        return {"message": "预约已取消。"}

    def process_reservations(self, book_id: int) -> None:
        """处理预约（当图书归还时自动通知预约用户）"""
        # 获取该图书的所有待处理预约
        reservations = db_manager.fetch_all("""
            SELECT r.*, b.title AS book_title, u.username AS reader_username 
            FROM book_reservations r
            JOIN books b ON r.book_id = b.id
            JOIN users u ON r.reader_id = u.id
            WHERE r.book_id = ? AND r.status = 'pending'
            ORDER BY r.reserve_date ASC
        """, (book_id,))
        
        if reservations:
            # 更新第一个预约为已通知状态
            db_manager.execute(
                "UPDATE book_reservations SET status = 'notified', notified = 1 WHERE id = ?",
                (reservations[0]["id"],)
            )
            
            # 发送消息给读者
            message_service.send_message(
                user_id=reservations[0]["reader_id"],
                title="预约图书已到馆",
                content=f"您预约的图书《{reservations[0]['book_title']}》已到馆，请尽快到图书馆借阅。",
                msg_type="reservation"
            )


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
            SELECT b.id, b.title, b.author, b.category, b.cover_image, b.description, COUNT(r.id) AS borrow_count
            FROM borrow_records r JOIN books b ON r.book_id = b.id
            GROUP BY b.id
            HAVING COUNT(r.id) > 0
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
        
        # 如果创建时状态就是发布，发送消息给所有读者
        if data.status == 'published':
            announcement = self.get_announcement(announcement_id)
            readers = db_manager.fetch_all("SELECT id FROM users WHERE role = 'reader' AND status = 'active'")
            for reader in readers:
                db_manager.execute(
                    """
                    INSERT INTO messages(user_id, title, content, type)
                    VALUES (?, ?, ?, 'info')
                    """,
                    (reader["id"], f"新公告：{announcement['title']}", announcement['content'][:200] + '...' if len(announcement['content']) > 200 else announcement['content']),
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
        
        # 如果状态变为发布，发送消息给所有读者
        if 'status' in update_data and update_data['status'] == 'published':
            announcement = self.get_announcement(announcement_id)
            # 获取所有读者
            readers = db_manager.fetch_all("SELECT id FROM users WHERE role = 'reader' AND status = 'active'")
            for reader in readers:
                db_manager.execute(
                    """
                    INSERT INTO messages(user_id, title, content, type)
                    VALUES (?, ?, ?, 'info')
                    """,
                    (reader["id"], f"新公告：{announcement['title']}", announcement['content'][:200] + '...' if len(announcement['content']) > 200 else announcement['content']),
                )
        
        return self.get_announcement(announcement_id)

    def delete_announcement(self, announcement_id: int) -> Dict[str, str]:
        self.get_announcement(announcement_id)
        db_manager.execute("DELETE FROM announcements WHERE id = ?", (announcement_id,))
        return {"message": "公告已删除。"}


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


class MessageService:
    """消息服务"""
    
    def send_message(self, user_id: int, title: str, content: str, msg_type: str = "info") -> int:
        """发送消息给用户"""
        cursor = db_manager.execute(
            """
            INSERT INTO messages(user_id, title, content, type)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, title, content, msg_type),
        )
        return cursor.lastrowid
    
    def list_messages(self, user_id: int, page: int = 1, page_size: int = 20) -> Dict[str, Any]:
        """获取用户消息列表"""
        page, page_size, offset = paginate(page, page_size)
        
        total = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM messages WHERE user_id = ?",
            (user_id,)
        )["n"]
        
        rows = db_manager.fetch_all(
            """
            SELECT * FROM messages 
            WHERE user_id = ? 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
            """,
            (user_id, page_size, offset),
        )
        
        return {"items": rows, "total": total, "page": page, "page_size": page_size}
    
    def get_unread_count(self, user_id: int) -> int:
        """获取未读消息数量"""
        result = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND read = 0",
            (user_id,)
        )
        return result["n"]
    
    def mark_as_read(self, message_id: int, user_id: int) -> None:
        """标记消息为已读"""
        db_manager.execute(
            "UPDATE messages SET read = 1 WHERE id = ? AND user_id = ?",
            (message_id, user_id),
        )
    
    def mark_all_read(self, user_id: int) -> None:
        """标记所有消息为已读"""
        db_manager.execute(
            "UPDATE messages SET read = 1 WHERE user_id = ?",
            (user_id,),
        )


announcement_service = AnnouncementService()
book_review_service = BookReviewService()
reader_bulk_import_service = ReaderBulkImportService()
recommendation_service = RecommendationService()
message_service = MessageService()

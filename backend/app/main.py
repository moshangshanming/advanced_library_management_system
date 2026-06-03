from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, APP_VERSION, FRONTEND_DIR
from .database import db_manager
from .auth_service import auth_service
from .schemas import (
    BookCreate,
    BookUpdate,
    BorrowCreate,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    ReaderCreate,
    ReaderUpdate,
    RegisterRequest,
    VerifyCodeRequest,
    AnnouncementCreate,
    AnnouncementUpdate,
    ResetPasswordRequest,
    BookReviewCreate,
    BookReviewUpdate,
    UserCreate,
    UserUpdate,
    RenewRequest,
    ReservationCreate
)
from .security import create_token, verify_password, verify_token
from .services import (
    book_service, borrow_service, export_service, reader_service, report_service, 
    stats_service, announcement_service, audit_log_service, book_review_service,
    reader_bulk_import_service, recommendation_service, user_service
)

app = FastAPI(title=APP_NAME, version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    db_manager.init_db()


if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/", include_in_schema=False)
def index():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"message": APP_NAME}


def get_current_user(authorization: str = Header(default="")) -> Dict[str, Any]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录。")
    payload = verify_token(authorization.replace("Bearer ", "", 1).strip())
    user = db_manager.fetch_one(
        "SELECT id, username, role, full_name, phone, email, department, status, created_at FROM users WHERE id = ?",
        (payload["user_id"],),
    )
    if not user or user["status"] != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在或已被冻结。")
    return user


def require_admin(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user["role"] != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限。")
    return current_user


def require_librarian(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if current_user["role"] not in ["admin", "librarian"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员或馆员权限。")
    return current_user


@app.get("/api/auth/me")
def me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user


@app.post("/api/auth/send-code")
def send_verify_code(data: VerifyCodeRequest):
    return auth_service.send_verify_code(data.phone, "register")


@app.post("/api/auth/send-forgot-code")
def send_forgot_code(data: VerifyCodeRequest):
    return auth_service.send_verify_code(data.phone, "forgot_password")


@app.post("/api/auth/register")
def register(data: RegisterRequest):
    user = auth_service.register(data.dict())
    token = create_token(user)
    return {"token": token, "user": user}


@app.post("/api/auth/forgot-password")
def forgot_password(data: ForgotPasswordRequest):
    return auth_service.forgot_password(data.phone, data.verify_code, data.new_password)


@app.post("/api/auth/change-password")
def change_password(data: ChangePasswordRequest, current_user: Dict[str, Any] = Depends(get_current_user)):
    return auth_service.change_password(current_user["id"], data.old_password, data.new_password)


@app.get("/api/books")
def list_books(
    search: str = "",
    category: str = "",
    isbn: str = "",
    author: str = "",
    publisher: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return book_service.list_books(search=search, category=category, isbn=isbn, author=author, publisher=publisher, page=page, page_size=page_size)


@app.post("/api/books")
def create_book(data: BookCreate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = book_service.create_book(data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="CREATE",
        target_type="book",
        target_id=result["id"],
        details=f"创建图书: {data.title}"
    )
    return result


@app.put("/api/books/{book_id}")
def update_book(book_id: int, data: BookUpdate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = book_service.update_book(book_id, data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="UPDATE",
        target_type="book",
        target_id=book_id,
        details=f"更新图书"
    )
    return result


@app.delete("/api/books/{book_id}")
def delete_book(book_id: int, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = book_service.delete_book(book_id)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="DELETE",
        target_type="book",
        target_id=book_id,
        details=f"删除图书"
    )
    return result


@app.post("/api/books/cover/{book_id}")
async def upload_book_cover(book_id: int, file: UploadFile = File(...), current_user: Dict[str, Any] = Depends(require_librarian)):
    import os
    from uuid import uuid4
    
    UPLOAD_DIR = Path("uploads/covers")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="不支持的图片格式，仅支持 JPG、PNG、GIF、WebP")
    
    file_ext = file.filename.split(".")[-1].lower()
    filename = f"{uuid4()}.{file_ext}"
    file_path = UPLOAD_DIR / filename
    
    with open(file_path, "wb") as f:
        f.write(await file.read())
    
    result = book_service.update_book(book_id, BookUpdate(cover_image=f"/uploads/covers/{filename}"))
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="UPDATE",
        target_type="book",
        target_id=book_id,
        details=f"上传封面"
    )
    return result


@app.post("/api/books/import")
async def import_books(file: UploadFile = File(...), current_user: Dict[str, Any] = Depends(require_librarian)):
    import csv
    from io import StringIO
    
    if file.content_type not in ["text/csv", "application/vnd.ms-excel"]:
        raise HTTPException(status_code=400, detail="请上传 CSV 文件")
    
    content = await file.read()
    try:
        content_str = content.decode("utf-8")
    except:
        content_str = content.decode("gbk")
    
    reader = csv.DictReader(StringIO(content_str))
    items = list(reader)
    
    if not items:
        raise HTTPException(status_code=400, detail="CSV 文件为空")
    
    result = book_service.import_books(items)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="IMPORT",
        target_type="books",
        target_id=0,
        details=f"批量导入图书: 成功{result['success']}条, 失败{result['fail']}条"
    )
    return result


@app.get("/api/readers")
def list_readers(
    search: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_librarian),
):
    return reader_service.list_readers(search=search, page=page, page_size=page_size)


@app.post("/api/readers")
def create_reader(data: ReaderCreate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = reader_service.create_reader(data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="CREATE",
        target_type="reader",
        target_id=result["id"],
        details=f"创建读者: {data.full_name}"
    )
    return result


@app.put("/api/readers/{reader_id}")
def update_reader(reader_id: int, data: ReaderUpdate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = reader_service.update_reader(reader_id, data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="UPDATE",
        target_type="reader",
        target_id=reader_id,
        details=f"更新读者信息"
    )
    return result


@app.delete("/api/readers/{reader_id}")
def delete_reader(reader_id: int, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = reader_service.delete_reader(reader_id)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="DELETE",
        target_type="reader",
        target_id=reader_id,
        details=f"删除读者"
    )
    return result


@app.get("/api/borrow-records")
def list_records(
    status_filter: str = Query(default="", alias="status"),
    keyword: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return borrow_service.list_records(current_user=current_user, status_filter=status_filter, keyword=keyword, page=page, page_size=page_size)


@app.post("/api/borrow-records")
def borrow_book(data: BorrowCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    result = borrow_service.borrow_book(data, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="BORROW",
        target_type="book",
        target_id=data.book_id,
        details=f"借阅图书，记录 ID: {result['id']}"
    )
    return result


@app.patch("/api/borrow-records/{record_id}/return")
def return_book(record_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    result = borrow_service.return_book(record_id, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="RETURN",
        target_type="borrow_record",
        target_id=record_id,
        details=f"归还图书"
    )
    return result


@app.patch("/api/borrow-records/{record_id}/renew")
def renew_book(record_id: int, data: RenewRequest = Depends(), current_user: Dict[str, Any] = Depends(get_current_user)):
    result = borrow_service.renew_book(record_id, data, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="RENEW",
        target_type="borrow_record",
        target_id=record_id,
        details=f"续借图书，延长 {data.days} 天"
    )
    return result


@app.post("/api/reservations")
def create_reservation(data: ReservationCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    result = borrow_service.reserve_book(data, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="RESERVE",
        target_type="book",
        target_id=data.book_id,
        details=f"预约图书"
    )
    return result


@app.get("/api/reservations")
def list_reservations(
    status_filter: str = Query(default="", alias="status"),
    keyword: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return borrow_service.list_reservations(current_user=current_user, status_filter=status_filter, keyword=keyword, page=page, page_size=page_size)


@app.delete("/api/reservations/{reservation_id}")
def cancel_reservation(reservation_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    result = borrow_service.cancel_reservation(reservation_id, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="CANCEL_RESERVATION",
        target_type="reservation",
        target_id=reservation_id,
        details=f"取消预约"
    )
    return result


@app.get("/api/overdue")
def overdue(current_user: Dict[str, Any] = Depends(get_current_user), _: Dict[str, Any] = Depends(require_librarian)):
    return {"items": borrow_service.overdue_records(current_user)}


@app.get("/api/fines/unpaid")
def list_unpaid_fines(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return borrow_service.list_unpaid_fines(current_user, page=page, page_size=page_size)


@app.patch("/api/fines/{record_id}/pay")
def pay_fine(record_id: int, current_user: Dict[str, Any] = Depends(get_current_user), _: Dict[str, Any] = Depends(require_librarian)):
    result = borrow_service.pay_fine(record_id, current_user)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="PAY_FINE",
        target_type="borrow_record",
        target_id=record_id,
        details=f"支付罚金 {result['fine_amount']} 元"
    )
    return result


@app.get("/api/overdue/statistics")
def overdue_statistics(current_user: Dict[str, Any] = Depends(get_current_user)):
    return borrow_service.overdue_statistics(current_user)


@app.post("/api/reminders/generate")
def generate_reminders(current_user: Dict[str, Any] = Depends(get_current_user), _: Dict[str, Any] = Depends(require_librarian)):
    return borrow_service.generate_reminders(current_user)


@app.get("/api/stats/overview")
def stats_overview(current_user: Dict[str, Any] = Depends(get_current_user), _: Dict[str, Any] = Depends(require_librarian)):
    return stats_service.overview(current_user)


@app.get("/api/stats/category")
def stats_category(_: Dict[str, Any] = Depends(require_librarian)):
    return {"items": stats_service.category_distribution()}


@app.get("/api/stats/borrow-trend")
def stats_borrow_trend(days: int = 14, current_user: Dict[str, Any] = Depends(get_current_user), _: Dict[str, Any] = Depends(require_librarian)):
    return stats_service.borrow_trend(current_user, days)


@app.get("/api/stats/top-books")
def stats_top_books(_: Dict[str, Any] = Depends(require_librarian)):
    return {"items": stats_service.top_books()}


@app.get("/api/export/books", response_class=PlainTextResponse)
def export_books(_: Dict[str, Any] = Depends(require_librarian)):
    return PlainTextResponse(export_service.export_books(), media_type="text/csv; charset=utf-8")


@app.get("/api/export/borrow-records", response_class=PlainTextResponse)
def export_records(current_user: Dict[str, Any] = Depends(require_librarian)):
    return PlainTextResponse(export_service.export_records(current_user), media_type="text/csv; charset=utf-8")


@app.get("/api/reports/reader")
def reader_report(reader_id: Optional[int] = None, current_user: Dict[str, Any] = Depends(require_librarian)):
    return report_service.generate_reader_report(current_user, reader_id)


# ===== 公告管理 =====
@app.get("/api/announcements")
def list_announcements(
    status: str = Query(default="", alias="status"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return announcement_service.list_announcements(status_filter=status, page=page, page_size=page_size)


@app.post("/api/announcements")
def create_announcement(data: AnnouncementCreate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = announcement_service.create_announcement(data, current_user["id"])
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="CREATE",
        target_type="announcement",
        target_id=result["id"],
        details=f"创建公告: {data.title}"
    )
    return result


@app.put("/api/announcements/{announcement_id}")
def update_announcement(announcement_id: int, data: AnnouncementUpdate, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = announcement_service.update_announcement(announcement_id, data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="UPDATE",
        target_type="announcement",
        target_id=announcement_id,
        details=f"更新公告"
    )
    return result


@app.delete("/api/announcements/{announcement_id}")
def delete_announcement(announcement_id: int, current_user: Dict[str, Any] = Depends(require_librarian)):
    result = announcement_service.delete_announcement(announcement_id)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="DELETE",
        target_type="announcement",
        target_id=announcement_id,
        details=f"删除公告"
    )
    return result


# ===== 读者管理扩展 =====
@app.post("/api/readers/import")
async def import_readers(file: UploadFile = File(...), _: Dict[str, Any] = Depends(require_librarian)):
    """批量导入读者（CSV格式）"""
    try:
        content = await file.read()
        csv_content = content.decode('utf-8')
        result = reader_bulk_import_service.import_readers_csv(csv_content)
        return result
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="文件编码错误，请使用 UTF-8 编码。")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"导入失败: {str(e)}")


@app.get("/api/readers/export", response_class=PlainTextResponse)
def export_readers(_: Dict[str, Any] = Depends(require_librarian)):
    """导出所有读者为 CSV"""
    return PlainTextResponse(reader_bulk_import_service.export_readers(), media_type="text/csv; charset=utf-8")


@app.post("/api/readers/{reader_id}/reset-password")
def reset_reader_password(reader_id: int, data: ResetPasswordRequest, current_user: Dict[str, Any] = Depends(require_librarian)):
    """重置读者密码"""
    result = reader_service.update_reader(reader_id, ReaderUpdate(password=data.new_password))
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="RESET_PASSWORD",
        target_type="reader",
        target_id=reader_id,
        details=f"重置读者密码"
    )
    return {"message": "密码已重置。"}


# ===== 操作日志 =====
@app.get("/api/audit-logs")
def list_audit_logs(
    user_id: Optional[int] = None,
    action: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(require_admin),
):
    """查看操作日志"""
    return audit_log_service.list_logs(user_id_filter=user_id, action_filter=action, page=page, page_size=page_size)


@app.get("/api/audit-logs/export", response_class=PlainTextResponse)
def export_audit_logs(
    user_id: Optional[int] = None,
    action: str = "",
    current_user: Dict[str, Any] = Depends(require_admin),
):
    """导出操作日志为 CSV"""
    return PlainTextResponse(audit_log_service.export_logs(user_id_filter=user_id, action_filter=action), media_type="text/csv; charset=utf-8")


# ===== 书籍评论与评分 =====
@app.get("/api/books/{book_id}/reviews")
def get_book_reviews(book_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取书籍评论"""
    return {"items": book_review_service.get_book_reviews(book_id)}


@app.get("/api/books/{book_id}/with-reviews")
def get_book_with_reviews(book_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取书籍及其评论"""
    return book_review_service.get_book_with_reviews(book_id)


@app.post("/api/reviews")
def add_book_review(data: BookReviewCreate, current_user: Dict[str, Any] = Depends(get_current_user)):
    """添加书籍评论"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以评论。")
    result = book_review_service.add_review(data, current_user["id"])
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="ADD_REVIEW",
        target_type="book",
        target_id=data.book_id,
        details=f"添加评论，评分: {data.rating}"
    )
    return result


# ===== 推荐系统 =====
@app.get("/api/recommendations")
def get_recommendations(current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取读书报告推荐"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以获取推荐。")
    return recommendation_service.get_all_recommendations(current_user["id"])


@app.get("/api/recommendations/by-category")
def get_recommendations_by_category(current_user: Dict[str, Any] = Depends(get_current_user)):
    """根据历史借阅分类推荐"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以获取推荐。")
    return {"items": recommendation_service.recommend_by_category(current_user["id"])}


@app.get("/api/recommendations/by-popular")
def get_recommendations_by_popular(current_user: Dict[str, Any] = Depends(get_current_user)):
    """根据热门借阅榜推荐"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以获取推荐。")
    return {"items": recommendation_service.recommend_by_popular(current_user["id"])}


@app.get("/api/recommendations/by-rating")
def get_recommendations_by_rating(current_user: Dict[str, Any] = Depends(get_current_user)):
    """根据评分推荐"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以获取推荐。")
    return {"items": recommendation_service.recommend_by_rating(current_user["id"])}


@app.get("/api/recommendations/by-department")
def get_recommendations_by_department(current_user: Dict[str, Any] = Depends(get_current_user)):
    """根据部门/专业推荐"""
    if current_user["role"] != "reader":
        raise HTTPException(status_code=403, detail="只有读者可以获取推荐。")
    return {"items": recommendation_service.recommend_by_department(current_user["id"])}


# ===== 登录日志记录 =====
@app.post("/api/auth/login")
def login(data: LoginRequest):
    user = db_manager.fetch_one("SELECT * FROM users WHERE username = ?", (data.username.strip(),))
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="用户名或密码错误。")
    if user["status"] != "active":
        raise HTTPException(status_code=403, detail="账号已被冻结，请联系管理员。")
    token = create_token(user)
    safe_user = {k: user[k] for k in ["id", "username", "role", "full_name", "phone", "email", "department", "status", "created_at"]}
    
    # 记录登录日志
    audit_log_service.log_action(
        user_id=user["id"],
        action="LOGIN",
        target_type="auth",
        details=f"用户登录: {user['username']}"
    )
    
    return {"token": token, "user": safe_user}


# ===== 用户管理 =====
@app.get("/api/users")
def list_users(
    search: str = "",
    role: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(require_admin),
):
    """获取用户列表（仅管理员）"""
    return user_service.list_users(search=search, role=role, page=page, page_size=page_size)


@app.get("/api/users/{user_id}")
def get_user(user_id: int, current_user: Dict[str, Any] = Depends(require_admin)):
    """获取单个用户详情（仅管理员）"""
    return user_service.get_user(user_id)


@app.post("/api/users")
def create_user(data: UserCreate, current_user: Dict[str, Any] = Depends(require_admin)):
    """创建用户（仅管理员）"""
    result = user_service.create_user(data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="CREATE",
        target_type="user",
        target_id=result["id"],
        details=f"创建用户: {data.username} ({data.role})"
    )
    return result


@app.put("/api/users/{user_id}")
def update_user(user_id: int, data: UserUpdate, current_user: Dict[str, Any] = Depends(require_admin)):
    """更新用户信息（仅管理员）"""
    result = user_service.update_user(user_id, data)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="UPDATE",
        target_type="user",
        target_id=user_id,
        details=f"更新用户信息"
    )
    return result


@app.delete("/api/users/{user_id}")
def delete_user(user_id: int, current_user: Dict[str, Any] = Depends(require_admin)):
    """删除用户（仅管理员）"""
    result = user_service.delete_user(user_id)
    audit_log_service.log_action(
        user_id=current_user["id"],
        action="DELETE",
        target_type="user",
        target_id=user_id,
        details=f"删除用户"
    )
    return result


@app.get("/api/users/stats")
def get_user_stats(current_user: Dict[str, Any] = Depends(require_admin)):
    """获取用户统计数据（仅管理员）"""
    return user_service.get_user_stats()


@app.get("/api/roles")
def list_roles(current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取角色列表及其权限"""
    return {"items": user_service.list_roles()}


@app.get("/api/roles/{role}/permissions")
def get_role_permissions(role: str, current_user: Dict[str, Any] = Depends(get_current_user)):
    """获取指定角色的权限"""
    return user_service.get_role_permissions(role)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)

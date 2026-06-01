from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, APP_VERSION, FRONTEND_DIR
from .database import db_manager
from .schemas import BookCreate, BookUpdate, BorrowCreate, LoginRequest, ReaderCreate, ReaderUpdate
from .security import create_token, verify_password, verify_token
from .services import book_service, borrow_service, export_service, reader_service, report_service, stats_service

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


@app.post("/api/auth/login")
def login(data: LoginRequest):
    user = db_manager.fetch_one("SELECT * FROM users WHERE username = ?", (data.username.strip(),))
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=400, detail="用户名或密码错误。")
    if user["status"] != "active":
        raise HTTPException(status_code=403, detail="账号已被冻结，请联系管理员。")
    token = create_token(user)
    safe_user = {k: user[k] for k in ["id", "username", "role", "full_name", "phone", "email", "department", "status", "created_at"]}
    return {"token": token, "user": safe_user}


@app.get("/api/auth/me")
def me(current_user: Dict[str, Any] = Depends(get_current_user)):
    return current_user


@app.get("/api/books")
def list_books(
    search: str = "",
    category: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    current_user: Dict[str, Any] = Depends(get_current_user),
):
    return book_service.list_books(search=search, category=category, page=page, page_size=page_size)


@app.post("/api/books")
def create_book(data: BookCreate, _: Dict[str, Any] = Depends(require_admin)):
    return book_service.create_book(data)


@app.put("/api/books/{book_id}")
def update_book(book_id: int, data: BookUpdate, _: Dict[str, Any] = Depends(require_admin)):
    return book_service.update_book(book_id, data)


@app.delete("/api/books/{book_id}")
def delete_book(book_id: int, _: Dict[str, Any] = Depends(require_admin)):
    return book_service.delete_book(book_id)


@app.get("/api/readers")
def list_readers(
    search: str = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    _: Dict[str, Any] = Depends(require_admin),
):
    return reader_service.list_readers(search=search, page=page, page_size=page_size)


@app.post("/api/readers")
def create_reader(data: ReaderCreate, _: Dict[str, Any] = Depends(require_admin)):
    return reader_service.create_reader(data)


@app.put("/api/readers/{reader_id}")
def update_reader(reader_id: int, data: ReaderUpdate, _: Dict[str, Any] = Depends(require_admin)):
    return reader_service.update_reader(reader_id, data)


@app.delete("/api/readers/{reader_id}")
def delete_reader(reader_id: int, _: Dict[str, Any] = Depends(require_admin)):
    return reader_service.delete_reader(reader_id)


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
    return borrow_service.borrow_book(data, current_user)


@app.patch("/api/borrow-records/{record_id}/return")
def return_book(record_id: int, current_user: Dict[str, Any] = Depends(get_current_user)):
    return borrow_service.return_book(record_id, current_user)


@app.get("/api/overdue")
def overdue(current_user: Dict[str, Any] = Depends(get_current_user)):
    return {"items": borrow_service.overdue_records(current_user)}


@app.post("/api/reminders/generate")
def generate_reminders(current_user: Dict[str, Any] = Depends(get_current_user)):
    return borrow_service.generate_reminders(current_user)


@app.get("/api/stats/overview")
def stats_overview(current_user: Dict[str, Any] = Depends(get_current_user)):
    return stats_service.overview(current_user)


@app.get("/api/stats/category")
def stats_category(_: Dict[str, Any] = Depends(get_current_user)):
    return {"items": stats_service.category_distribution()}


@app.get("/api/stats/borrow-trend")
def stats_borrow_trend(days: int = 14, current_user: Dict[str, Any] = Depends(get_current_user)):
    return {"items": stats_service.borrow_trend(current_user, days)}


@app.get("/api/stats/top-books")
def stats_top_books(_: Dict[str, Any] = Depends(get_current_user)):
    return {"items": stats_service.top_books()}


@app.get("/api/export/books", response_class=PlainTextResponse)
def export_books(_: Dict[str, Any] = Depends(get_current_user)):
    return PlainTextResponse(export_service.export_books(), media_type="text/csv; charset=utf-8")


@app.get("/api/export/borrow-records", response_class=PlainTextResponse)
def export_records(current_user: Dict[str, Any] = Depends(get_current_user)):
    return PlainTextResponse(export_service.export_records(current_user), media_type="text/csv; charset=utf-8")


@app.get("/api/reports/reader")
def reader_report(reader_id: Optional[int] = None, current_user: Dict[str, Any] = Depends(get_current_user)):
    return report_service.generate_reader_report(current_user, reader_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=True)

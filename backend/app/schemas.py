from typing import List, Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1, max_length=100)


class BookCreate(BaseModel):
    isbn: str = Field(..., min_length=3, max_length=40)
    title: str = Field(..., min_length=1, max_length=120)
    author: str = Field(..., min_length=1, max_length=80)
    publisher: str = Field(default="", max_length=80)
    category: str = Field(..., min_length=1, max_length=40)
    total_count: int = Field(..., ge=0)
    available_count: Optional[int] = Field(default=None, ge=0)
    shelf_location: str = Field(default="", max_length=40)
    description: str = Field(default="", max_length=500)


class BookUpdate(BaseModel):
    isbn: Optional[str] = Field(default=None, min_length=3, max_length=40)
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    author: Optional[str] = Field(default=None, min_length=1, max_length=80)
    publisher: Optional[str] = Field(default=None, max_length=80)
    category: Optional[str] = Field(default=None, min_length=1, max_length=40)
    total_count: Optional[int] = Field(default=None, ge=0)
    available_count: Optional[int] = Field(default=None, ge=0)
    shelf_location: Optional[str] = Field(default=None, max_length=40)
    description: Optional[str] = Field(default=None, max_length=500)


class ReaderCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6, max_length=100)
    full_name: str = Field(..., min_length=1, max_length=80)
    phone: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=80)
    department: str = Field(default="", max_length=80)
    status: str = Field(default="active", pattern="^(active|frozen)$")


class ReaderUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)
    email: Optional[str] = Field(default=None, max_length=80)
    department: Optional[str] = Field(default=None, max_length=80)
    status: Optional[str] = Field(default=None, pattern="^(active|frozen)$")
    password: Optional[str] = Field(default=None, min_length=6, max_length=100)


class BorrowCreate(BaseModel):
    book_id: int = Field(..., ge=1)
    reader_id: Optional[int] = Field(default=None, ge=1)
    days: int = Field(default=30, ge=1, le=180)
    remark: str = Field(default="", max_length=200)


class ReaderReportItem(BaseModel):
    id: int
    book_title: str
    isbn: str
    borrow_date: str
    due_date: str
    return_date: Optional[str]
    status: str
    remark: str
    overdue_days: int
    borrow_duration_days: int


class ReaderReportSummary(BaseModel):
    total_borrowed: int
    currently_borrowed: int
    overdue: int
    returned: int
    total_reading_days: int
    average_borrow_duration_days: float
    average_return_duration_days: float


class ReaderReport(BaseModel):
    reader_id: int
    reader_name: str
    reader_username: str
    department: str
    generated_at: str
    summary: ReaderReportSummary
    records: List[ReaderReportItem]

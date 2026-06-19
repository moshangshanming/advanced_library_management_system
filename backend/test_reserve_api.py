from app.database import db_manager
from app.services import reservation_service
from app.schemas import ReservationCreate

db_manager.init_db()

# 测试预约库存为0的图书
try:
    data = ReservationCreate(book_id=112, reader_id=2)
    result = reservation_service.create_reservation(data, {'id': 2, 'role': 'reader'})
    print("预约成功:", result)
except Exception as e:
    print("预约失败:", str(e))
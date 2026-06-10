import random
import string
from datetime import datetime, timedelta
from typing import Dict, Optional

from fastapi import HTTPException

from .database import db_manager
from .security import hash_password, verify_password


class AuthService:
    def generate_verify_code(self) -> str:
        return "".join(random.choices(string.digits, k=6))

    def send_verify_code(self, phone: str, purpose: str) -> Dict[str, str]:
        phone = phone.strip()
        if not phone.isdigit() or len(phone) < 11:
            raise HTTPException(status_code=400, detail="无效的手机号码。")

        existing = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE phone = ?", (phone,)
        )["n"]

        if purpose == "register" and existing > 0:
            raise HTTPException(status_code=400, detail="该手机号已被注册。")

        if purpose == "forgot_password" and existing == 0:
            raise HTTPException(status_code=400, detail="该手机号未注册。")

        code = self.generate_verify_code()
        expires_at = (datetime.now() + timedelta(minutes=5)).strftime("%Y-%m-%d %H:%M:%S")

        db_manager.execute(
            """
            INSERT INTO verification_codes(phone, code, purpose, expires_at)
            VALUES (?, ?, ?, ?)
            """,
            (phone, code, purpose, expires_at),
        )

        db_manager.execute(
            """
            DELETE FROM verification_codes 
            WHERE phone = ? AND purpose = ? AND id NOT IN (
                SELECT id FROM verification_codes 
                WHERE phone = ? AND purpose = ? 
                ORDER BY created_at DESC LIMIT 5
            )
            """,
            (phone, purpose, phone, purpose),
        )

        return {"message": f"验证码已发送至 {phone}，有效期5分钟。", "code": code}

    def verify_code(self, phone: str, code: str, purpose: str) -> bool:
        phone = phone.strip()
        code = code.strip()

        if not code.isdigit() or len(code) != 6:
            raise HTTPException(status_code=400, detail="验证码格式错误。")

        record = db_manager.fetch_one(
            """
            SELECT * FROM verification_codes 
            WHERE phone = ? AND code = ? AND purpose = ? AND used = 0 
            ORDER BY created_at DESC LIMIT 1
            """,
            (phone, code, purpose),
        )

        if not record:
            raise HTTPException(status_code=400, detail="验证码无效或已过期。")

        expires_at = datetime.strptime(record["expires_at"], "%Y-%m-%d %H:%M:%S")
        if datetime.now() > expires_at:
            db_manager.execute(
                "UPDATE verification_codes SET used = 1 WHERE id = ?", (record["id"],)
            )
            raise HTTPException(status_code=400, detail="验证码已过期。")

        db_manager.execute("UPDATE verification_codes SET used = 1 WHERE id = ?", (record["id"],))
        return True

    def register(self, data: Dict) -> Dict:
        phone = data.get("phone", "").strip()
        role = data.get("role", "reader")
        if role not in {"reader", "admin"}:
            raise HTTPException(status_code=400, detail="注册账号类型无效。")

        existing = db_manager.fetch_one(
            "SELECT COUNT(*) AS n FROM users WHERE username = ?", (data["username"].strip(),)
        )["n"]
        if existing > 0:
            raise HTTPException(status_code=400, detail="用户名已存在。")

        user_id = db_manager.execute(
            """
            INSERT INTO users(username, password_hash, role, full_name, phone, email, department, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', 'localtime'))
            """,
            (
                data["username"].strip(),
                hash_password(data["password"]),
                role,
                data["full_name"].strip(),
                phone,
                data.get("email", "").strip(),
                data.get("department", "").strip(),
            ),
        )

        return db_manager.fetch_one(
            """
            SELECT id, username, role, full_name, phone, email, department, status, created_at
            FROM users WHERE id = ?
            """,
            (user_id,),
        )

    def forgot_password(self, phone: str, verify_code: str, new_password: str) -> Dict[str, str]:
        phone = phone.strip()
        self.verify_code(phone, verify_code, "forgot_password")

        db_manager.execute(
            "UPDATE users SET password_hash = ? WHERE phone = ?",
            (hash_password(new_password), phone),
        )

        return {"message": "密码重置成功，请使用新密码登录。"}

    def change_password(self, user_id: int, old_password: str, new_password: str) -> Dict[str, str]:
        user = db_manager.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在。")

        if not verify_password(old_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="原密码错误。")

        if old_password == new_password:
            raise HTTPException(status_code=400, detail="新密码不能与原密码相同。")

        db_manager.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (hash_password(new_password), user_id),
        )

        return {"message": "密码修改成功，请使用新密码登录。"}


auth_service = AuthService()

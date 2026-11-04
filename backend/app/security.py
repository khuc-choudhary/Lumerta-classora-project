import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .db import User, get_db

_bearer = HTTPBearer(auto_error=False)


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return base64.b64encode(salt + h).decode()


def verify_password(pw: str, stored: str) -> bool:
    if not stored:
        return False
    raw = base64.b64decode(stored)
    salt, h = raw[:16], raw[16:]
    return hmac.compare_digest(h, hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32))


def make_jwt(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_hours)
    return jwt.encode({"sub": str(user_id), "exp": exp}, settings.jwt_secret, algorithm="HS256")


def new_token() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hashlib.sha256(raw.encode()).hexdigest()


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def optional_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User | None:
    try:
        return current_user(cred, db)
    except HTTPException:
        return None


def current_user(cred: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)) -> User:
    if not cred:
        raise HTTPException(401, "Not authenticated")
    try:
        data = jwt.decode(cred.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Session expired. Please log in again.")
    user = db.get(User, int(data["sub"]))
    if not user:
        raise HTTPException(401, "Account not found")
    return user

import hashlib
import hmac
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from pymongo import ASCENDING, MongoClient
from pymongo.errors import DuplicateKeyError
from redis import Redis


SESSION_COOKIE = "aagora_session"
SESSION_LIFETIME = timedelta(days=30)
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fff]+$")


def _mongo_uri() -> str:
    explicit_uri = os.getenv("MONGO_URI")
    if explicit_uri:
        return explicit_uri

    host = os.getenv("MONGO_HOST", "mongodb")
    port = os.getenv("MONGO_PORT", "27017")
    username = os.getenv("MONGO_USER")
    password = os.getenv("MONGO_PASS")
    if username and password:
        from urllib.parse import quote_plus

        return f"mongodb://{quote_plus(username)}:{quote_plus(password)}@{host}:{port}/?authSource=admin"
    return f"mongodb://{host}:{port}"


mongo_client = MongoClient(_mongo_uri())
database = mongo_client[os.getenv("MONGO_DATABASE", "aagora")]
users = database["users"]
sessions = database["sessions"]
redis_client = Redis(
    host=os.getenv("REDIS_HOST", "redis"),
    port=int(os.getenv("REDIS_PORT", "6379")),
    decode_responses=True,
)


def ensure_auth_indexes() -> None:
    users.create_index([("username_normalized", ASCENDING)], unique=True)
    sessions.create_index([("token_hash", ASCENDING)], unique=True)
    sessions.create_index([("expires_at", ASCENDING)], expireAfterSeconds=0)


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=24)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        username = value.strip()
        if not USERNAME_PATTERN.fullmatch(username):
            raise ValueError("用户名只能包含中文、字母、数字和下划线")
        return username


class PublicUser(BaseModel):
    id: str
    username: str
    avatar: str


def _hash_password(password: str, salt: bytes | None = None) -> str:
    password_salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), password_salt, 600_000)
    return f"pbkdf2_sha256$600000${password_salt.hex()}${digest.hex()}"


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, expected_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(actual.hex(), expected_hex)
    except (TypeError, ValueError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _public_user(user: dict) -> PublicUser:
    return PublicUser(id=user["id"], username=user["username"], avatar=user["avatar"])


def _create_session(response: Response, user_id: str, request: Request) -> None:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    sessions.insert_one(
        {
            "token_hash": _token_hash(token),
            "user_id": user_id,
            "created_at": now,
            "expires_at": now + SESSION_LIFETIME,
        }
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
    )


def get_current_user(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict:
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")

    session = sessions.find_one(
        {
            "token_hash": _token_hash(session_token),
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        }
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期")

    user = users.find_one({"id": session["user_id"]})
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


def get_optional_user(
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
) -> dict | None:
    if not session_token:
        return None
    session = sessions.find_one(
        {
            "token_hash": _token_hash(session_token),
            "expires_at": {"$gt": datetime.now(timezone.utc)},
        }
    )
    return users.find_one({"id": session["user_id"]}) if session else None


router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@router.post("/register", response_model=PublicUser, status_code=status.HTTP_201_CREATED)
def register(credentials: Credentials, response: Response, request: Request):
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "username": credentials.username,
        "username_normalized": credentials.username.casefold(),
        "password_hash": _hash_password(credentials.password),
        "avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={user_id}",
        "created_at": datetime.now(timezone.utc),
    }
    try:
        users.insert_one(user)
    except DuplicateKeyError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="用户名已被使用") from error

    _create_session(response, user_id, request)
    return _public_user(user)


@router.post("/login", response_model=PublicUser)
def login(credentials: Credentials, response: Response, request: Request):
    user = users.find_one({"username_normalized": credentials.username.casefold()})
    if not user or not _verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    _create_session(response, user["id"], request)
    return _public_user(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    session_token: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
):
    if session_token:
        token_hash = _token_hash(session_token)
        session = sessions.find_one({"token_hash": token_hash})
        sessions.delete_one({"token_hash": token_hash})
        if session:
            redis_client.zrem("presence:users", session["user_id"])
    response.delete_cookie(SESSION_COOKIE, path="/", samesite="lax")


@router.get("/me", response_model=PublicUser)
def me(current_user: Annotated[dict, Depends(get_current_user)]):
    return _public_user(current_user)
from contextlib import asynccontextmanager
from typing import Annotated, Optional, List

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from datetime import datetime, timezone
from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError
import uuid

from auth import database, ensure_auth_indexes, get_current_user, get_optional_user, router as auth_router


posts = database["posts"]
reactions = database["post_reactions"]
follows = database["follows"]


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_auth_indexes()
    posts.create_index([("id", ASCENDING)], unique=True)
    posts.create_index([("reply_to", ASCENDING), ("created_at", DESCENDING)])
    posts.create_index([("author_id", ASCENDING), ("created_at", DESCENDING)])
    posts.create_index([("tags", ASCENDING)])
    reactions.create_index(
        [("post_id", ASCENDING), ("user_id", ASCENDING), ("kind", ASCENDING)], unique=True
    )
    follows.create_index([("follower_id", ASCENDING), ("followed_id", ASCENDING)], unique=True)
    if posts.count_documents({}) == 0:
        now = datetime.now(timezone.utc).isoformat()
        posts.insert_one(
            {
                "id": str(uuid.uuid4()),
                "title": "欢迎来到 AAgora",
                "content": "这是一个基于「万物皆帖子」理念的讨论平台。每条回复都是独立的帖子，通过 reply_to 和 @ 建立连接。",
                "author_id": "system",
                "author_name": "System",
                "author_avatar": "https://api.dicebear.com/7.x/avataaars/svg?seed=system",
                "tags": ["公告", "欢迎"],
                "reply_to": None,
                "mentioned_users": [],
                "created_at": now,
                "updated_at": now,
                "likes_count": 0,
                "replies_count": 0,
            }
        )
    yield


app = FastAPI(title="AAgora API", lifespan=lifespan)
app.include_router(auth_router)


@app.middleware("http")
async def prevent_stale_static_modules(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    return response

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


# Data models
class PostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=10000)
    tags: List[str] = Field(default_factory=list, max_length=8)
    reply_to: Optional[str] = None
    mentioned_users: List[str] = Field(default_factory=list)


class PostUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    content: Optional[str] = Field(default=None, min_length=1, max_length=10000)
    tags: Optional[List[str]] = Field(default=None, max_length=8)


class Post(BaseModel):
    id: str
    title: str
    content: str
    author_id: str
    author_name: str
    author_avatar: str
    tags: List[str]
    reply_to: Optional[str]
    mentioned_users: List[str]
    created_at: str
    updated_at: str
    likes_count: int
    replies_count: int
    liked: bool = False
    bookmarked: bool = False
    author_following: bool = False


def serialize_post(post: dict, user: dict | None = None) -> dict:
    result = {key: value for key, value in post.items() if key != "_id"}
    result["liked"] = bool(
        user and reactions.find_one({"post_id": post["id"], "user_id": user["id"], "kind": "like"})
    )
    result["bookmarked"] = bool(
        user and reactions.find_one({"post_id": post["id"], "user_id": user["id"], "kind": "bookmark"})
    )
    result["author_following"] = bool(
        user
        and follows.find_one({"follower_id": user["id"], "followed_id": post["author_id"]})
    )
    return result


@app.get("/")
def read_root():
    return FileResponse("static/index.html")


@app.get("/api/v1/posts", response_model=dict)
def get_posts(
    current_user: Annotated[dict | None, Depends(get_optional_user)],
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    sort: str = "latest",
    reply_to: Optional[str] = None,
    author_id: Optional[str] = None,
    tag: Optional[str] = None,
    bookmarked: bool = False,
    following: bool = False,
):
    """获取帖子列表"""
    query: dict = {}
    if reply_to is not None:
        query["reply_to"] = None if reply_to == "null" else reply_to
    if author_id:
        query["author_id"] = author_id
    if tag:
        query["tags"] = tag
    if bookmarked:
        if not current_user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
        post_ids = reactions.distinct(
            "post_id", {"user_id": current_user["id"], "kind": "bookmark"}
        )
        query["id"] = {"$in": post_ids}
    if following:
        if not current_user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
        followed_ids = follows.distinct("followed_id", {"follower_id": current_user["id"]})
        query["author_id"] = {"$in": followed_ids}

    sort_fields = [("created_at", DESCENDING)]
    if sort == "popular":
        sort_fields = [("likes_count", DESCENDING), ("replies_count", DESCENDING), ("created_at", DESCENDING)]
    start = (page - 1) * limit
    total = posts.count_documents(query)
    paginated = list(posts.find(query).sort(sort_fields).skip(start).limit(limit))
    return {
        "data": [serialize_post(post, current_user) for post in paginated],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "pages": (total + limit - 1) // limit
        }
    }


@app.get("/api/v1/posts/{post_id}", response_model=Post)
def get_post(post_id: str, current_user: Annotated[dict | None, Depends(get_optional_user)]):
    """获取单个帖子"""
    post = posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return serialize_post(post, current_user)


@app.post("/api/v1/posts", response_model=Post)
def create_post(post: PostCreate, current_user: Annotated[dict, Depends(get_current_user)]):
    """创建帖子"""
    new_post = {
        "id": str(uuid.uuid4()),
        "title": post.title,
        "content": post.content,
        "author_id": current_user["id"],
        "author_name": current_user["username"],
        "author_avatar": current_user["avatar"],
        "tags": list(dict.fromkeys(tag.strip() for tag in post.tags if tag.strip())),
        "reply_to": post.reply_to,
        "mentioned_users": post.mentioned_users,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "likes_count": 0,
        "replies_count": 0,
    }
    
    if post.reply_to:
        parent = posts.find_one_and_update(
            {"id": post.reply_to}, {"$inc": {"replies_count": 1}}
        )
        if not parent:
            raise HTTPException(status_code=404, detail="回复的帖子不存在")
    posts.insert_one(new_post)
    return serialize_post(new_post, current_user)


@app.put("/api/v1/posts/{post_id}", response_model=Post)
def update_post(
    post_id: str,
    post_update: PostUpdate,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """更新帖子"""
    post = posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="只能编辑自己的帖子")
    
    changes = post_update.model_dump(exclude_none=True)
    if "tags" in changes:
        changes["tags"] = list(dict.fromkeys(tag.strip() for tag in changes["tags"] if tag.strip()))
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()
    updated = posts.find_one_and_update(
        {"id": post_id}, {"$set": changes}, return_document=ReturnDocument.AFTER
    )
    return serialize_post(updated, current_user)


@app.delete("/api/v1/posts/{post_id}")
def delete_post(post_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
    """删除帖子"""
    post = posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post["author_id"] != current_user["id"]:
        raise HTTPException(status_code=403, detail="只能删除自己的帖子")
    
    if post["reply_to"]:
        posts.update_one(
            {"id": post["reply_to"], "replies_count": {"$gt": 0}}, {"$inc": {"replies_count": -1}}
        )
    posts.delete_one({"id": post_id})
    reactions.delete_many({"post_id": post_id})
    return {"message": "Post deleted"}


@app.post("/api/v1/posts/{post_id}/reactions/{kind}")
def toggle_reaction(
    post_id: str,
    kind: str,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    if kind not in {"like", "bookmark"}:
        raise HTTPException(status_code=404, detail="不支持的操作")
    if not posts.find_one({"id": post_id}):
        raise HTTPException(status_code=404, detail="Post not found")
    relation = {"post_id": post_id, "user_id": current_user["id"], "kind": kind}
    active = False
    try:
        reactions.insert_one({**relation, "created_at": datetime.now(timezone.utc)})
        active = True
    except DuplicateKeyError:
        reactions.delete_one(relation)
    if kind == "like":
        updated = posts.find_one_and_update(
            {"id": post_id}, {"$inc": {"likes_count": 1 if active else -1}}, return_document=ReturnDocument.AFTER
        )
        count = max(updated["likes_count"], 0)
        if updated["likes_count"] < 0:
            posts.update_one({"id": post_id}, {"$set": {"likes_count": 0}})
    else:
        count = reactions.count_documents({"post_id": post_id, "kind": "bookmark"})
    return {"active": active, "count": count}


@app.post("/api/v1/users/{user_id}/follow")
def toggle_follow(user_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="不能关注自己")
    relation = {"follower_id": current_user["id"], "followed_id": user_id}
    try:
        follows.insert_one({**relation, "created_at": datetime.now(timezone.utc)})
        return {"following": True}
    except DuplicateKeyError:
        follows.delete_one(relation)
        return {"following": False}


@app.get("/api/v1/stats")
def get_stats():
    return {"posts": posts.count_documents({}), "users": database["users"].count_documents({})}

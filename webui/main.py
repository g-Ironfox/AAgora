from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid

app = FastAPI(title="AAgora API")

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")


# Data models
class PostCreate(BaseModel):
    title: str
    content: str
    tags: List[str] = []
    reply_to: Optional[str] = None
    mentioned_users: List[str] = []


class PostUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None


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


# Mock database
posts_db: List[dict] = [
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
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "likes_count": 0,
        "replies_count": 0,
    }
]


@app.get("/")
def read_root():
    return FileResponse("static/index.html")


@app.get("/api/v1/posts", response_model=dict)
def get_posts(
    page: int = 1,
    limit: int = 20,
    sort: str = "latest",
    reply_to: Optional[str] = None
):
    """获取帖子列表"""
    filtered = posts_db
    
    # Filter by reply_to
    if reply_to is not None:
        if reply_to == "null":
            filtered = [p for p in posts_db if p["reply_to"] is None]
        else:
            filtered = [p for p in posts_db if p["reply_to"] == reply_to]
    
    # Sort
    if sort == "latest":
        filtered = sorted(filtered, key=lambda x: x["created_at"], reverse=True)
    
    # Paginate
    start = (page - 1) * limit
    end = start + limit
    paginated = filtered[start:end]
    
    return {
        "data": paginated,
        "pagination": {
            "page": page,
            "limit": limit,
            "total": len(filtered),
            "pages": (len(filtered) + limit - 1) // limit
        }
    }


@app.get("/api/v1/posts/{post_id}", response_model=Post)
def get_post(post_id: str):
    """获取单个帖子"""
    post = next((p for p in posts_db if p["id"] == post_id), None)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return post


@app.post("/api/v1/posts", response_model=Post)
def create_post(post: PostCreate):
    """创建帖子"""
    new_post = {
        "id": str(uuid.uuid4()),
        "title": post.title,
        "content": post.content,
        "author_id": "demo_user",
        "author_name": "Demo User",
        "author_avatar": f"https://api.dicebear.com/7.x/avataaars/svg?seed={uuid.uuid4()}",
        "tags": post.tags,
        "reply_to": post.reply_to,
        "mentioned_users": post.mentioned_users,
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "likes_count": 0,
        "replies_count": 0,
    }
    
    # Update parent's replies_count
    if post.reply_to:
        parent = next((p for p in posts_db if p["id"] == post.reply_to), None)
        if parent:
            parent["replies_count"] += 1
    
    posts_db.append(new_post)
    return new_post


@app.put("/api/v1/posts/{post_id}", response_model=Post)
def update_post(post_id: str, post_update: PostUpdate):
    """更新帖子"""
    post = next((p for p in posts_db if p["id"] == post_id), None)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    if post_update.title is not None:
        post["title"] = post_update.title
    if post_update.content is not None:
        post["content"] = post_update.content
    if post_update.tags is not None:
        post["tags"] = post_update.tags
    
    post["updated_at"] = datetime.now().isoformat()
    return post


@app.delete("/api/v1/posts/{post_id}")
def delete_post(post_id: str):
    """删除帖子"""
    post = next((p for p in posts_db if p["id"] == post_id), None)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Update parent's replies_count
    if post["reply_to"]:
        parent = next((p for p in posts_db if p["id"] == post["reply_to"]), None)
        if parent:
            parent["replies_count"] -= 1
    
    posts_db.remove(post)
    return {"message": "Post deleted"}

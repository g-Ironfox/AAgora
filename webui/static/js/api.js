const API_BASE = '/api/v1';

// Fetch posts
export async function fetchPosts(page = 1, limit = 20, sort = 'latest', replyTo = null) {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sort
  });
  
  if (replyTo !== null) {
    params.append('reply_to', replyTo);
  }
  
  const res = await fetch(`${API_BASE}/posts?${params}`);
  if (!res.ok) throw new Error('Failed to fetch posts');
  return res.json();
}

// Fetch single post
export async function fetchPost(postId) {
  const res = await fetch(`${API_BASE}/posts/${postId}`);
  if (!res.ok) throw new Error('Failed to fetch post');
  return res.json();
}

// Create post
export async function createPost(data) {
  const res = await fetch(`${API_BASE}/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to create post');
  return res.json();
}

// Update post
export async function updatePost(postId, data) {
  const res = await fetch(`${API_BASE}/posts/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Failed to update post');
  return res.json();
}

// Delete post
export async function deletePost(postId) {
  const res = await fetch(`${API_BASE}/posts/${postId}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error('Failed to delete post');
  return res.json();
}

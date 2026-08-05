const API_BASE = '/api/v1';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (res.ok) {
    return res.status === 204 ? null : res.json();
  }

  let message = '请求失败，请稍后重试';
  try {
    const body = await res.json();
    if (typeof body.detail === 'string') {
      message = body.detail;
    } else if (Array.isArray(body.detail)) {
      message = body.detail[0]?.msg?.replace(/^Value error, /, '') || message;
    }
  } catch {
    // Keep the fallback for non-JSON server errors.
  }

  const error = new Error(message);
  error.status = res.status;
  throw error;
}

export function register(username, password) {
  return request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export function login(username, password) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
}

export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

export function fetchCurrentUser() {
  return request('/auth/me');
}

// Fetch posts
export function fetchPosts(page = 1, limit = 20, options = {}) {
  const {
    sort = 'latest',
    replyTo = null,
    authorId = null,
    tag = null,
    bookmarked = false,
    following = false
  } = options;
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    sort
  });
  
  if (replyTo !== null) {
    params.append('reply_to', replyTo);
  }
  if (authorId) params.append('author_id', authorId);
  if (tag) params.append('tag', tag);
  if (bookmarked) params.append('bookmarked', 'true');
  if (following) params.append('following', 'true');
  return request(`/posts?${params}`);
}

// Fetch single post
export async function fetchPost(postId) {
  return request(`/posts/${postId}`);
}

// Create post
export async function createPost(data) {
  return request('/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// Update post
export async function updatePost(postId, data) {
  return request(`/posts/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}

// Delete post
export async function deletePost(postId) {
  return request(`/posts/${postId}`, { method: 'DELETE' });
}

export function toggleReaction(postId, kind) {
  return request(`/posts/${postId}/reactions/${kind}`, { method: 'POST' });
}

export function toggleFollow(userId) {
  return request(`/users/${userId}/follow`, { method: 'POST' });
}

export function fetchStats() {
  return request('/stats');
}

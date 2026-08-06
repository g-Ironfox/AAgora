// Format timestamp
export function formatTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  
  return date.toLocaleDateString('zh-CN');
}

// Truncate text
export function truncate(text, length = 150) {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

export function renderPostCard(post, currentUserId = null) {
  const tags = post.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
  const ownPost = currentUserId === post.author_id;
  
  return `
    <div class="post-card" data-id="${post.id}">
      <div class="card-header">
        <img class="avatar" src="${escapeHtml(post.author_avatar)}" alt="">
        <div class="meta">
          <span class="username">${escapeHtml(post.author_name)}</span>
          <span class="timestamp">${formatTime(post.created_at)}</span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="title">${escapeHtml(post.title)}</h3>
        <p class="excerpt">${escapeHtml(truncate(post.content, 150))}</p>
        ${tags ? `<div class="post-tags">${tags}</div>` : ''}
      </div>
      <div class="card-footer">
        <button class="btn-icon" data-action="replies" data-post-id="${post.id}" aria-label="回复，${post.replies_count} 条" title="回复">
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
          <span>${post.replies_count}</span>
        </button>
        <button class="btn-icon ${post.liked ? 'is-active' : ''}" data-action="like" data-post-id="${post.id}" aria-pressed="${Boolean(post.liked)}" aria-label="点赞，${post.likes_count} 次" title="点赞">
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span>${post.likes_count}</span>
        </button>
        <button class="btn-icon ${post.bookmarked ? 'is-active' : ''}" data-action="bookmark" data-post-id="${post.id}" aria-pressed="${Boolean(post.bookmarked)}" aria-label="收藏" title="收藏">
          <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
        ${ownPost ? `
          <span class="card-footer-spacer"></span>
          <button class="btn-icon" data-action="edit" data-post-id="${post.id}" aria-label="编辑帖子" title="编辑">编辑</button>
          <button class="btn-icon" data-action="delete" data-post-id="${post.id}" aria-label="删除帖子" title="删除">删除</button>
        ` : ''}
      </div>
    </div>
  `;
}

// Render skeleton loader
export function renderSkeleton(count = 3) {
  const skeleton = `
    <div class="post-card skeleton-card">
      <div class="card-header">
        <div class="skeleton avatar"></div>
        <div class="meta skeleton-meta">
          <div class="skeleton skeleton-text skeleton-username"></div>
          <div class="skeleton skeleton-text skeleton-time"></div>
        </div>
      </div>
      <div class="card-body">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text skeleton-text-short"></div>
      </div>
    </div>
  `;
  
  return Array(count).fill(skeleton).join('');
}

// Render empty state
export function renderEmptyState(message = '暂无内容') {
  return `
    <div class="empty-state">
      <p class="empty-state-text">${message}</p>
    </div>
  `;
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show modal
export function showModal(title, content) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const removeModal = modal.remove.bind(modal);
  // Override remove() so every close path (close button, backdrop click,
  // form cancel/submit in callers) restores page scrolling; keeps body
  // scroll locked while at least one modal is still open.
  const closeModal = () => {
    removeModal();
    if (!document.querySelector('.modal-overlay')) {
      document.body.style.overflow = '';
    }
  };
  modal.remove = closeModal;
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${title}</h2>
        <button class="modal-close" data-action="close-modal">×</button>
      </div>
      <div class="modal-body">
        ${content}
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  
  // Close handlers
  modal.querySelector('[data-action="close-modal"]').addEventListener('click', () => {
    closeModal();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
  
  return modal;
}

// Show toast notification
export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 80px;
    right: 24px;
    background: var(--surface-3);
    color: var(--text-primary);
    padding: 1rem 1.5rem;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    z-index: 2000;
    animation: slideIn 0.3s ease-out;
    border-left: 3px solid ${type === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)'};
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

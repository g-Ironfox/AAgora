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

// Render post card
export function renderPostCard(post) {
  const tags = post.tags.map(tag => `<span class="tag">${tag}</span>`).join('');
  
  return `
    <div class="post-card" data-id="${post.id}">
      <div class="card-header">
        <img class="avatar" src="${post.author_avatar}" alt="${post.author_name}">
        <div class="meta">
          <span class="username">${post.author_name}</span>
          <span class="timestamp">${formatTime(post.created_at)}</span>
        </div>
      </div>
      <div class="card-body">
        <h3 class="title">${escapeHtml(post.title)}</h3>
        <p class="excerpt">${escapeHtml(truncate(post.content, 150))}</p>
        ${tags ? `<div class="post-tags">${tags}</div>` : ''}
      </div>
      <div class="card-footer">
        <button class="btn-icon" data-action="replies" data-post-id="${post.id}">
          💬 ${post.replies_count}
        </button>
        <button class="btn-icon" data-action="like">
          ❤️ ${post.likes_count}
        </button>
        <button class="btn-icon" data-action="bookmark">
          🔖
        </button>
      </div>
    </div>
  `;
}

// Render skeleton loader
export function renderSkeleton(count = 3) {
  const skeleton = `
    <div class="post-card">
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
      <div class="empty-state-icon">📭</div>
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
  
  // Close handlers
  modal.querySelector('[data-action="close-modal"]').addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
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

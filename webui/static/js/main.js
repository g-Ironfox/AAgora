import { fetchPosts, createPost } from './api.js';
import { renderPostCard, renderSkeleton, renderEmptyState, showModal, showToast } from './components.js';

// State
let currentPage = 1;
let currentSort = 'latest';
let currentReplyTo = null;

// DOM elements
const feedContainer = document.getElementById('feed');
const fabButton = document.getElementById('fab');
const themeToggle = document.getElementById('theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);

  if (themeToggle) {
    const isDark = theme === 'dark';
    themeToggle.setAttribute('aria-label', isDark ? '切换日间主题' : '切换夜间主题');
    themeToggle.setAttribute('title', isDark ? '切换日间主题' : '切换夜间主题');
  }
}

// Load posts
async function loadPosts(append = false) {
  try {
    if (!append) {
      feedContainer.innerHTML = renderSkeleton();
    }
    
    const response = await fetchPosts(currentPage, 20, currentSort, currentReplyTo);
    
    if (response.data.length === 0) {
      feedContainer.innerHTML = renderEmptyState('还没有帖子，快来发布第一条吧！');
      return;
    }
    
    const html = response.data.map(post => renderPostCard(post)).join('');
    
    if (append) {
      feedContainer.insertAdjacentHTML('beforeend', html);
    } else {
      feedContainer.innerHTML = html;
    }
    
    // Attach event listeners
    attachCardListeners();
    
  } catch (error) {
    console.error('Failed to load posts:', error);
    feedContainer.innerHTML = renderEmptyState('加载失败，请刷新重试');
    showToast('加载帖子失败', 'error');
  }
}

// Attach listeners to post cards
function attachCardListeners() {
  const cards = feedContainer.querySelectorAll('.post-card');
  
  cards.forEach(card => {
    // Click card to view details
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const postId = card.dataset.id;
      // In a real app, navigate to detail page
      showToast('详情页功能待实现');
    });
    
    // Reply button
    const replyBtn = card.querySelector('[data-action="replies"]');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = replyBtn.dataset.postId;
        showReplyModal(postId);
      });
    }
  });
}

// Show create post modal
function showCreatePostModal() {
  const content = `
    <form id="create-post-form">
      <div class="form-field">
        <input 
          type="text" 
          class="input" 
          name="title" 
          placeholder="标题"
          required
        >
      </div>
      <div class="form-field">
        <textarea 
          class="textarea" 
          name="content" 
          placeholder="说点什么..."
          required
        ></textarea>
      </div>
      <div class="form-field">
        <input 
          type="text" 
          class="input" 
          name="tags" 
          placeholder="标签（用逗号分隔）"
        >
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-action="cancel">取消</button>
        <button type="submit" class="btn btn-primary">发布</button>
      </div>
    </form>
  `;
  
  const modal = showModal('发布新帖', content);
  
  const form = modal.querySelector('#create-post-form');
  const cancelBtn = modal.querySelector('[data-action="cancel"]');
  
  cancelBtn.addEventListener('click', () => modal.remove());
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(form);
    const tags = formData.get('tags')
      .split(',')
      .map(t => t.trim())
      .filter(t => t);
    
    try {
      await createPost({
        title: formData.get('title'),
        content: formData.get('content'),
        tags,
        reply_to: null,
        mentioned_users: []
      });
      
      modal.remove();
      showToast('发布成功！', 'success');
      currentPage = 1;
      loadPosts();
    } catch (error) {
      console.error('Failed to create post:', error);
      showToast('发布失败，请重试', 'error');
    }
  });
}

// Show reply modal
function showReplyModal(postId) {
  const content = `
    <form id="reply-post-form">
      <div class="form-field">
        <input 
          type="text" 
          class="input" 
          name="title" 
          placeholder="标题"
          required
        >
      </div>
      <div class="form-field">
        <textarea 
          class="textarea" 
          name="content" 
          placeholder="写下你的回复..."
          required
        ></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" data-action="cancel">取消</button>
        <button type="submit" class="btn btn-primary">回复</button>
      </div>
    </form>
  `;
  
  const modal = showModal('回复帖子', content);
  
  const form = modal.querySelector('#reply-post-form');
  const cancelBtn = modal.querySelector('[data-action="cancel"]');
  
  cancelBtn.addEventListener('click', () => modal.remove());
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = new FormData(form);
    
    try {
      await createPost({
        title: formData.get('title'),
        content: formData.get('content'),
        tags: [],
        reply_to: postId,
        mentioned_users: []
      });
      
      modal.remove();
      showToast('回复成功！', 'success');
      currentPage = 1;
      loadPosts();
    } catch (error) {
      console.error('Failed to reply:', error);
      showToast('回复失败，请重试', 'error');
    }
  });
}

// Initialize
function init() {
  const savedTheme = localStorage.getItem('theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(savedTheme || preferredTheme);
  loadPosts();
  
  if (fabButton) {
    fabButton.addEventListener('click', showCreatePostModal);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }
  
  // Infinite scroll (optional)
  window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
      // Load more posts
    }
  });
}

// Start app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

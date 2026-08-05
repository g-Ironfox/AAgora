import {
  createPost,
  deletePost,
  fetchCurrentUser,
  fetchPost,
  fetchPosts,
  fetchStats,
  login,
  logout,
  register,
  toggleFollow,
  toggleReaction,
  updatePost
} from './api.js?v=20260805-features';
import { renderPostCard, renderSkeleton, renderEmptyState, showModal, showToast } from './components.js?v=20260805-features';

// State
let currentPage = 1;
let currentSort = 'latest';
let currentReplyTo = null;
let currentUser = null;
let currentView = 'market';
let currentTag = null;
let hasMorePosts = false;
let isLoadingPosts = false;
let feedRequestId = 0;

// DOM elements
const feedContainer = document.getElementById('feed');
const fabButton = document.getElementById('fab');
const themeToggle = document.getElementById('theme-toggle');
const authActions = document.getElementById('auth-actions');

function renderAuthActions() {
  authActions.replaceChildren();

  if (!currentUser) {
    const loginButton = document.createElement('button');
    loginButton.className = 'btn btn-secondary';
    loginButton.type = 'button';
    loginButton.textContent = '登录';
    loginButton.addEventListener('click', () => showAuthModal('login'));

    const registerButton = document.createElement('button');
    registerButton.className = 'btn btn-primary';
    registerButton.type = 'button';
    registerButton.textContent = '注册';
    registerButton.addEventListener('click', () => showAuthModal('register'));
    authActions.append(loginButton, registerButton);
    return;
  }

  const avatar = document.createElement('img');
  avatar.className = 'auth-avatar';
  avatar.src = currentUser.avatar;
  avatar.alt = '';

  const username = document.createElement('span');
  username.className = 'auth-username';
  username.textContent = currentUser.username;

  const logoutButton = document.createElement('button');
  logoutButton.className = 'btn btn-ghost auth-logout';
  logoutButton.type = 'button';
  logoutButton.textContent = '退出';
  logoutButton.addEventListener('click', handleLogout);
  authActions.append(avatar, username, logoutButton);
}

async function restoreSession() {
  try {
    currentUser = await fetchCurrentUser();
  } catch (error) {
    if (error.status !== 401) {
      console.error('Failed to restore session:', error);
    }
    currentUser = null;
  }
  renderAuthActions();
}

async function handleLogout() {
  try {
    await logout();
    currentUser = null;
    renderAuthActions();
    if (['bookmarks', 'mine', 'following'].includes(currentView)) {
      currentView = 'market';
    }
    await resetFeed();
    showToast('已退出登录', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function showAuthModal(mode) {
  const isRegister = mode === 'register';
  const content = `
    <form id="auth-form">
      <div class="auth-switch" role="tablist" aria-label="账号操作">
        <button type="button" class="auth-tab ${!isRegister ? 'is-active' : ''}" data-auth-mode="login" role="tab" aria-selected="${!isRegister}">登录</button>
        <button type="button" class="auth-tab ${isRegister ? 'is-active' : ''}" data-auth-mode="register" role="tab" aria-selected="${isRegister}">注册</button>
      </div>
      <div class="form-field">
        <label class="form-label" for="auth-username">用户名</label>
        <input id="auth-username" type="text" class="input" name="username" minlength="2" maxlength="24" autocomplete="username" required autofocus>
        <p class="field-hint">2-24 位中文、字母、数字或下划线</p>
      </div>
      <div class="form-field">
        <label class="form-label" for="auth-password">密码</label>
        <input id="auth-password" type="password" class="input" name="password" minlength="8" maxlength="128" autocomplete="${isRegister ? 'new-password' : 'current-password'}" required>
        ${isRegister ? '<p class="field-hint">至少 8 位字符</p>' : ''}
      </div>
      <p class="form-error" id="auth-error" role="alert"></p>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isRegister ? '创建账号' : '登录'}</button>
      </div>
    </form>
  `;

  const modal = showModal(isRegister ? '加入 AAgora' : '欢迎回来', content);
  modal.querySelectorAll('[data-auth-mode]').forEach(button => {
    button.addEventListener('click', () => {
      modal.remove();
      showAuthModal(button.dataset.authMode);
    });
  });

  const form = modal.querySelector('#auth-form');
  const errorMessage = modal.querySelector('#auth-error');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    submitButton.disabled = true;
    submitButton.textContent = isRegister ? '创建中...' : '登录中...';
    errorMessage.textContent = '';

    try {
      currentUser = isRegister
        ? await register(formData.get('username'), formData.get('password'))
        : await login(formData.get('username'), formData.get('password'));
      modal.remove();
      renderAuthActions();
      await resetFeed();
      showToast(isRegister ? '账号创建成功' : '登录成功', 'success');
    } catch (error) {
      errorMessage.textContent = error.message;
      submitButton.disabled = false;
      submitButton.textContent = isRegister ? '创建账号' : '登录';
    }
  });
}

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
  if (isLoadingPosts || (append && !hasMorePosts)) return;
  const requestId = feedRequestId;
  isLoadingPosts = true;
  try {
    if (!append && feedContainer.children.length === 0) {
      feedContainer.innerHTML = renderSkeleton();
    } else if (!append) {
      feedContainer.classList.add('is-refreshing');
      feedContainer.setAttribute('aria-busy', 'true');
    }
    
    const response = await fetchPosts(currentPage, 20, {
      sort: currentSort,
      replyTo: currentReplyTo,
      authorId: currentView === 'mine' ? currentUser?.id : null,
      tag: currentTag,
      bookmarked: currentView === 'bookmarks',
      following: currentView === 'following'
    });
    if (requestId !== feedRequestId) return;
    hasMorePosts = currentPage < response.pagination.pages;
    
    if (response.data.length === 0) {
      if (!append) {
        feedContainer.innerHTML = renderEmptyState(emptyMessage());
      }
      return;
    }
    
    const html = response.data.map(post => renderPostCard(post, currentUser?.id)).join('');
    
    if (append) {
      feedContainer.insertAdjacentHTML('beforeend', html);
    } else {
      feedContainer.innerHTML = html;
    }
    
    // Attach event listeners
    attachCardListeners();
    renderLoadMoreButton();
    
  } catch (error) {
    if (requestId !== feedRequestId) return;
    console.error('Failed to load posts:', error);
    feedContainer.innerHTML = renderEmptyState('加载失败，请刷新重试');
    showToast('加载帖子失败', 'error');
  } finally {
    if (requestId === feedRequestId) {
      isLoadingPosts = false;
      feedContainer.classList.remove('is-refreshing');
      feedContainer.removeAttribute('aria-busy');
    }
  }
}

function emptyMessage() {
  if (currentView === 'bookmarks') return '还没有收藏的帖子';
  if (currentView === 'mine') return '你还没有发布帖子';
  if (currentView === 'following') return '关注作者后，他们的新帖会出现在这里';
  if (currentTag) return `“${currentTag}”话题下还没有帖子`;
  return '还没有帖子，快来发布第一条吧！';
}

function renderLoadMoreButton() {
  feedContainer.querySelector('.load-more')?.remove();
  if (!hasMorePosts) return;
  const button = document.createElement('button');
  button.className = 'btn btn-secondary load-more';
  button.type = 'button';
  button.textContent = '加载更多';
  button.addEventListener('click', () => {
    currentPage += 1;
    loadPosts(true);
  });
  feedContainer.appendChild(button);
}

async function resetFeed() {
  feedRequestId += 1;
  isLoadingPosts = false;
  currentPage = 1;
  hasMorePosts = false;
  await loadPosts();
  loadStats();
}

// Attach listeners to post cards
function attachCardListeners() {
  attachPostCardListeners(feedContainer);
}

function attachPostCardListeners(container) {
  const cards = container.querySelectorAll('.post-card');
  
  cards.forEach(card => {
    if (card.dataset.bound === 'true') return;
    card.dataset.bound = 'true';
    // Click card to view details
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const postId = card.dataset.id;
      showPostDetail(postId);
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

    card.querySelector('[data-action="like"]')?.addEventListener('click', event => {
      event.stopPropagation();
      handleReaction(event.currentTarget, 'like');
    });
    card.querySelector('[data-action="bookmark"]')?.addEventListener('click', event => {
      event.stopPropagation();
      handleReaction(event.currentTarget, 'bookmark');
    });
    card.querySelector('[data-action="edit"]')?.addEventListener('click', event => {
      event.stopPropagation();
      showEditPostModal(event.currentTarget.dataset.postId);
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', event => {
      event.stopPropagation();
      handleDeletePost(event.currentTarget.dataset.postId);
    });
  });
}

async function handleReaction(button, kind) {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }
  button.disabled = true;
  try {
    const result = await toggleReaction(button.dataset.postId, kind);
    button.classList.toggle('is-active', result.active);
    button.setAttribute('aria-pressed', result.active.toString());
    if (kind === 'like') {
      button.querySelector('span').textContent = result.count;
    } else if (!result.active && currentView === 'bookmarks') {
      button.closest('.post-card').remove();
      if (!feedContainer.querySelector('.post-card')) {
        feedContainer.innerHTML = renderEmptyState(emptyMessage());
      }
    }
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function showPostDetail(postId) {
  try {
    const [post, replies] = await Promise.all([
      fetchPost(postId),
      fetchPosts(1, 100, { sort: 'latest', replyTo: postId })
    ]);
    const replyCards = replies.data.length
      ? replies.data.map(reply => renderPostCard(reply, currentUser?.id)).join('')
      : renderEmptyState('还没有回复');
    const modal = showModal(escapeText(post.title), `
      <article class="post-detail">
        <div class="card-header">
          <img class="avatar" src="${escapeText(post.author_avatar)}" alt="">
          <div class="meta">
            <span class="username">${escapeText(post.author_name)}</span>
            <span class="timestamp">${new Date(post.created_at).toLocaleString('zh-CN')}</span>
          </div>
        </div>
        <p class="post-detail-content">${escapeText(post.content)}</p>
        <div class="form-actions">
          ${currentUser && currentUser.id !== post.author_id ? `
            <button type="button" class="btn btn-secondary" data-action="detail-follow" data-author-id="${post.author_id}">${post.author_following ? '取消关注' : '关注作者'}</button>
          ` : ''}
          <button type="button" class="btn btn-primary" data-action="detail-reply">回复</button>
        </div>
      </article>
      <section class="reply-list" aria-label="帖子回复">
        <h3 class="reply-list-title">回复 · ${replies.pagination.total}</h3>
        ${replyCards}
      </section>
    `);
    modal.classList.add('modal-wide');
    attachPostCardListeners(modal);
    modal.querySelector('[data-action="detail-reply"]').addEventListener('click', () => {
      modal.remove();
      showReplyModal(postId);
    });
    modal.querySelector('[data-action="detail-follow"]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await toggleFollow(button.dataset.authorId);
        button.textContent = result.following ? '取消关注' : '关注作者';
        showToast(result.following ? '已关注作者' : '已取消关注', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message || '加载帖子详情失败', 'error');
  }
}

async function showEditPostModal(postId) {
  try {
    const post = await fetchPost(postId);
    const modal = showModal('编辑帖子', `
      <form id="edit-post-form">
        <div class="form-field">
          <label class="form-label" for="edit-title">标题</label>
          <input id="edit-title" class="input" name="title" maxlength="120" required value="${escapeText(post.title)}">
        </div>
        <div class="form-field">
          <label class="form-label" for="edit-content">正文</label>
          <textarea id="edit-content" class="textarea" name="content" maxlength="10000" required>${escapeText(post.content)}</textarea>
        </div>
        <div class="form-field">
          <label class="form-label" for="edit-tags">标签</label>
          <input id="edit-tags" class="input" name="tags" value="${escapeText(post.tags.join(', '))}">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">取消</button>
          <button type="submit" class="btn btn-primary">保存</button>
        </div>
      </form>
    `);
    modal.querySelector('[data-action="cancel"]').addEventListener('click', () => modal.remove());
    modal.querySelector('#edit-post-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const submitButton = form.querySelector('[type="submit"]');
      submitButton.disabled = true;
      try {
        await updatePost(postId, {
          title: data.get('title').trim(),
          content: data.get('content').trim(),
          tags: parseTags(data.get('tags'))
        });
        modal.remove();
        showToast('帖子已更新', 'success');
        resetFeed();
      } catch (error) {
        showToast(error.message, 'error');
        submitButton.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function handleDeletePost(postId) {
  if (!window.confirm('确定删除这条帖子吗？')) return;
  try {
    await deletePost(postId);
    showToast('帖子已删除', 'success');
    resetFeed();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function parseTags(value) {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 8);
}

function escapeText(value) {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

// Show create post modal
function showCreatePostModal() {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }

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
    const tags = parseTags(formData.get('tags'));
    
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
      resetFeed();
    } catch (error) {
      console.error('Failed to create post:', error);
      showToast('发布失败，请重试', 'error');
    }
  });
}

// Show reply modal
function showReplyModal(postId) {
  if (!currentUser) {
    showAuthModal('login');
    return;
  }

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
      resetFeed();
    } catch (error) {
      console.error('Failed to reply:', error);
      showToast('回复失败，请重试', 'error');
    }
  });
}

async function loadStats() {
  try {
    const stats = await fetchStats();
    document.getElementById('post-count').textContent = stats.posts;
    document.getElementById('user-count').textContent = stats.users;
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function requireUser() {
  if (currentUser) return true;
  showAuthModal('login');
  return false;
}

function selectFeed(view, sort = 'latest') {
  if (['bookmarks', 'mine', 'following'].includes(view) && !requireUser()) return;
  if (currentView === view && currentSort === sort && currentTag === null) return;
  currentView = view;
  currentSort = sort;
  currentTag = null;
  document.querySelectorAll('[data-feed]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.feed === (view === 'following' ? 'following' : sort));
  });
  document.querySelectorAll('[data-view]').forEach(link => {
    link.classList.toggle('is-active', link.dataset.view === view);
  });
  document.querySelectorAll('[data-topic]').forEach(button => button.classList.remove('is-active'));
  resetFeed();
}

function bindNavigation() {
  document.querySelectorAll('[data-feed]').forEach(button => {
    button.addEventListener('click', () => {
      const feed = button.dataset.feed;
      selectFeed(feed === 'following' ? 'following' : 'market', feed === 'popular' ? 'popular' : 'latest');
    });
  });
  document.querySelectorAll('[data-view]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      const view = link.dataset.view;
      selectFeed(view, view === 'discussed' ? 'popular' : 'latest');
    });
  });
  document.querySelectorAll('[data-topic]').forEach(button => {
    button.addEventListener('click', () => {
      const wasSelected = currentTag === button.dataset.topic;
      currentView = 'market';
      currentSort = 'latest';
      currentTag = wasSelected ? null : button.dataset.topic;
      document.querySelectorAll('[data-topic]').forEach(topic => {
        topic.classList.toggle('is-active', topic === button && !wasSelected);
      });
      document.querySelectorAll('[data-view]').forEach(link => {
        link.classList.toggle('is-active', link.dataset.view === 'market');
      });
      resetFeed();
    });
  });
}

// Initialize
async function init() {
  const savedTheme = localStorage.getItem('theme');
  const preferredTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(savedTheme || preferredTheme);
  await restoreSession();
  bindNavigation();
  loadPosts();
  loadStats();
  
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
    if (!isLoadingPosts && hasMorePosts && window.innerHeight + window.scrollY >= document.body.offsetHeight - 300) {
      currentPage += 1;
      loadPosts(true);
    }
  });
}

// Start app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

import {
  fetchCurrentUser,
  fetchPosts,
  fetchStats,
  login,
  logout,
  register,
  sendPresenceHeartbeat,
  toggleReaction
} from './api.js?v=20260806-presence';
import { renderPostCard, renderEmptyState, showModal, showToast } from './components.js?v=20260806-modal-overlay';
import { createPostModalController } from './post-modals.js?v=20260806-post-modules';

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
let presenceTimer = null;

const PRESENCE_INTERVAL_MS = 60_000;

// DOM elements
const feedContainer = document.getElementById('feed');
const fabButton = document.getElementById('fab');
const themeToggle = document.getElementById('theme-toggle');
const authActions = document.getElementById('auth-actions');

let postModals;

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

async function heartbeat() {
  if (!currentUser || document.visibilityState === 'hidden') return;
  try {
    await sendPresenceHeartbeat();
  } catch (error) {
    if (error.status !== 401) {
      console.error('Failed to update presence:', error);
    }
  }
}

function startPresenceHeartbeat() {
  clearInterval(presenceTimer);
  if (!currentUser) return;
  heartbeat();
  presenceTimer = setInterval(heartbeat, PRESENCE_INTERVAL_MS);
}

function stopPresenceHeartbeat() {
  clearInterval(presenceTimer);
  presenceTimer = null;
}

async function handleLogout() {
  try {
    await logout();
    stopPresenceHeartbeat();
    currentUser = null;
    renderAuthActions();
    if (['bookmarks', 'mine', 'following'].includes(currentView)) {
      window.location.assign('/');
      return;
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
      startPresenceHeartbeat();
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
    if (!append) {
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
      postModals.showPostDetail(postId, attachPostCardListeners);
    });
    
    // Reply button
    const replyBtn = card.querySelector('[data-action="replies"]');
    if (replyBtn) {
      replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const postId = replyBtn.dataset.postId;
        postModals.showReplyModal(postId);
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
      postModals.showEditPostModal(event.currentTarget.dataset.postId);
    });
    card.querySelector('[data-action="delete"]')?.addEventListener('click', event => {
      event.stopPropagation();
      postModals.handleDeletePost(event.currentTarget.dataset.postId);
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
  currentView = document.body.dataset.view || 'market';
  if (currentView === 'market') {
    const topic = new URLSearchParams(window.location.search).get('topic');
    currentTag = ['日记', '闲聊', '分享'].includes(topic) ? topic : null;
  }
  postModals = createPostModalController({
    getCurrentUser: () => currentUser,
    resetFeed,
    requireUser
  });
  startPresenceHeartbeat();
  bindNavigation();
  document.querySelectorAll('[data-view]').forEach(link => {
    link.classList.toggle('is-active', link.dataset.view === currentView);
  });
  document.querySelectorAll('[data-topic]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.topic === currentTag);
  });
  const isProtectedViewSignedOut = ['bookmarks', 'mine'].includes(currentView) && !currentUser;
  if (isProtectedViewSignedOut) {
    showAuthModal('login');
    feedContainer.innerHTML = renderEmptyState('登录后查看这个页面');
  } else {
    loadPosts();
  }
  loadStats();
  
  if (fabButton) {
    fabButton.addEventListener('click', postModals.showCreatePostModal);
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      heartbeat();
      loadStats();
    }
  });
}

// Start app
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

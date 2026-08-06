import {
  createPost,
  deletePost,
  fetchPost,
  fetchPosts,
  toggleFollow,
  updatePost
} from './api.js?v=20260806-presence';
import { renderPostCard, renderEmptyState, showModal, showToast } from './components.js?v=20260806-modal-overlay';

export function createPostModalController({ getCurrentUser, resetFeed, requireUser }) {
  function parseTags(value) {
    return [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 8);
  }

  function escapeText(value) {
    const element = document.createElement('div');
    element.textContent = value;
    return element.innerHTML;
  }

  function showAuthRequired() {
    if (!getCurrentUser()) {
      requireUser();
      return true;
    }
    return false;
  }

  function showCreatePostModal() {
    if (showAuthRequired()) return;

    const content = `
      <form id="create-post-form">
        <div class="form-field">
          <input type="text" class="input" name="title" placeholder="标题" required>
        </div>
        <div class="form-field">
          <textarea class="textarea" name="content" placeholder="说点什么..." required></textarea>
        </div>
        <div class="form-field">
          <input type="text" class="input" name="tags" placeholder="标签（用逗号分隔）">
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">取消</button>
          <button type="submit" class="btn btn-primary">发布</button>
        </div>
      </form>
    `;

    const modal = showModal('发布新帖', content);
    const form = modal.querySelector('#create-post-form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => modal.remove());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const formData = new FormData(form);

      try {
        await createPost({
          title: formData.get('title'),
          content: formData.get('content'),
          tags: parseTags(formData.get('tags')),
          reply_to: null,
          mentioned_users: []
        });
        modal.remove();
        showToast('发布成功！', 'success');
        await resetFeed();
      } catch (error) {
        console.error('Failed to create post:', error);
        showToast('发布失败，请重试', 'error');
      }
    });
  }

  function showReplyModal(postId) {
    if (showAuthRequired()) return;

    const content = `
      <form id="reply-post-form">
        <div class="form-field">
          <input type="text" class="input" name="title" placeholder="标题" required>
        </div>
        <div class="form-field">
          <textarea class="textarea" name="content" placeholder="写下你的回复..." required></textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" data-action="cancel">取消</button>
          <button type="submit" class="btn btn-primary">回复</button>
        </div>
      </form>
    `;

    const modal = showModal('回复帖子', content);
    const form = modal.querySelector('#reply-post-form');
    form.querySelector('[data-action="cancel"]').addEventListener('click', () => modal.remove());
    form.addEventListener('submit', async event => {
      event.preventDefault();
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
        await resetFeed();
      } catch (error) {
        console.error('Failed to reply:', error);
        showToast('回复失败，请重试', 'error');
      }
    });
  }

  async function showPostDetail(postId, attachPostCardListeners) {
    try {
      const [post, replies] = await Promise.all([
        fetchPost(postId),
        fetchPosts(1, 100, { sort: 'latest', replyTo: postId })
      ]);
      const currentUser = getCurrentUser();
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
          await resetFeed();
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
      await resetFeed();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  return {
    handleDeletePost,
    showCreatePostModal,
    showEditPostModal,
    showPostDetail,
    showReplyModal
  };
}

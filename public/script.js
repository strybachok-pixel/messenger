const socket = io();

// DOM Елементи
const authModal = document.getElementById('auth-modal');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

const settingsModal = document.getElementById('settings-modal');
const myProfileBtn = document.getElementById('my-profile-btn');
const closeSettingsBtn = document.getElementById('close-settings');
const avatarUpload = document.getElementById('avatar-upload');
const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
const profileBioInput = document.getElementById('profile-bio');
const profileForm = document.getElementById('profile-form');

const userProfileModal = document.getElementById('user-profile-modal');
const closeUserProfileBtn = document.getElementById('close-user-profile');
const upAvatar = document.getElementById('up-avatar');
const upUsername = document.getElementById('up-username');
const upStatus = document.getElementById('up-status');
const upBio = document.getElementById('up-bio');
const btnAddFriend = document.getElementById('btn-add-friend');
const btnStartChat = document.getElementById('btn-start-chat');

const myAvatarImg = document.getElementById('my-avatar');
const myUsernameSpan = document.getElementById('my-username');
const globalSearch = document.getElementById('global-search');

const sidebarTabs = document.querySelectorAll('.s-tab');
const tabChatsList = document.getElementById('tab-chats');
const tabFriendsList = document.getElementById('tab-friends');
const tabGlobalList = document.getElementById('tab-global');

const noChatScreen = document.getElementById('no-chat-screen');
const activeChatScreen = document.getElementById('active-chat-screen');
const chatHeaderClickable = document.getElementById('chat-header-clickable');
const chatPartnerAvatar = document.getElementById('chat-partner-avatar');
const chatPartnerName = document.getElementById('chat-partner-name');
const chatPartnerStatus = document.getElementById('chat-partner-status');

const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const imageInput = document.getElementById('image-input');
const attachBtn = document.querySelector('.attach-btn');

let currentUser = null;
let currentChatPartner = 'global';
let isLoginMode = true;
let allUsersData = [];
let onlineUsersSet = new Set();
let friendsSet = new Set();
let newAvatarBase64 = null;

// Таби входу
tabLogin.addEventListener('click', () => {
  isLoginMode = true;
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  authSubmitBtn.textContent = 'Увійти';
  authError.textContent = '';
});

tabRegister.addEventListener('click', () => {
  isLoginMode = false;
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  authSubmitBtn.textContent = 'Зареєструватися';
  authError.textContent = '';
});

// Форма авторизації
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  const endpoint = isLoginMode ? '/api/login' : '/api/register';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      authError.textContent = data.error || 'Сталася помилка';
      return;
    }

    currentUser = {
      username: data.username,
      avatar: data.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${data.username}`,
      bio: data.bio || ''
    };

    initApp();
  } catch (err) {
    authError.textContent = 'Помилка з\'єднання з сервером';
  }
});

function initApp() {
  authModal.classList.add('hidden');
  appContainer.classList.remove('hidden');

  myUsernameSpan.textContent = currentUser.username;
  myAvatarImg.src = currentUser.avatar;

  socket.emit('user_connected', currentUser.username);
  refreshLists();
  openChat('global');
}

function refreshLists() {
  socket.emit('get_all_users');
  socket.emit('get_friends_list', currentUser.username);
}

// Налаштування
myProfileBtn.addEventListener('click', () => {
  settingsAvatarPreview.src = currentUser.avatar;
  profileBioInput.value = currentUser.bio || '';
  newAvatarBase64 = null;
  settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));

avatarUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    compressImage(file, 300, 300, (base64) => {
      newAvatarBase64 = base64;
      settingsAvatarPreview.src = base64;
    });
  }
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const updatedBio = profileBioInput.value.trim();

  try {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        avatar: newAvatarBase64 || currentUser.avatar,
        bio: updatedBio
      })
    });

    if (res.ok) {
      if (newAvatarBase64) currentUser.avatar = newAvatarBase64;
      currentUser.bio = updatedBio;
      myAvatarImg.src = currentUser.avatar;
      settingsModal.classList.add('hidden');
      refreshLists();
    }
  } catch (err) {
    alert('Помилка збереження');
  }
});

// Навігація сайдбару
sidebarTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    sidebarTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const targetId = tab.getAttribute('data-target');
    [tabChatsList, tabFriendsList, tabGlobalList].forEach(list => list.classList.add('hidden'));
    document.getElementById(targetId).classList.remove('hidden');
  });
});

// Відкриття чату
function openChat(partnerUsername) {
  currentChatPartner = partnerUsername || 'global';
  messagesContainer.innerHTML = '';

  noChatScreen.classList.add('hidden');
  activeChatScreen.classList.remove('hidden');

  if (currentChatPartner === 'global') {
    chatPartnerName.textContent = 'Загальний чат';
    chatPartnerAvatar.src = 'https://api.dicebear.com/7.x/identicon/svg?seed=global';
    chatPartnerStatus.textContent = 'Кімната спілкування';
  } else {
    chatPartnerName.textContent = currentChatPartner;
    const partnerData = allUsersData.find(u => u.username === currentChatPartner);
    
    if (partnerData) {
      chatPartnerAvatar.src = partnerData.avatar;
      const isOnline = onlineUsersSet.has(currentChatPartner);
      chatPartnerStatus.textContent = isOnline ? 'В мережі' : 'Не в мережі';
    } else {
      chatPartnerAvatar.src = `https://api.dicebear.com/7.x/bottts/svg?seed=${currentChatPartner}`;
      chatPartnerStatus.textContent = 'Користувач';
    }
  }

  socket.emit('get_chat_history', { currentUser: currentUser.username, partner: currentChatPartner });
}

chatHeaderClickable.addEventListener('click', () => {
  if (currentChatPartner !== 'global') {
    openUserProfileModal(currentChatPartner);
  }
});

function openUserProfileModal(username) {
  if (username === currentUser.username) {
    myProfileBtn.click();
    return;
  }

  const user = allUsersData.find(u => u.username === username);
  if (!user) return;

  upUsername.textContent = user.username;
  upAvatar.src = user.avatar;
  upBio.textContent = user.bio || 'Без біографії';

  const isOnline = onlineUsersSet.has(username);
  upStatus.innerHTML = `<span class="dot" style="background: ${isOnline ? 'var(--online-color)' : 'var(--text-muted)'}"></span> ${isOnline ? 'В мережі' : 'Не в мережі'}`;

  if (friendsSet.has(username)) {
    btnAddFriend.classList.add('hidden');
  } else {
    btnAddFriend.classList.remove('hidden');
    btnAddFriend.onclick = () => addFriend(username);
  }

  btnStartChat.onclick = () => {
    userProfileModal.classList.add('hidden');
    openChat(username);
  };

  userProfileModal.classList.remove('hidden');
}

closeUserProfileBtn.addEventListener('click', () => userProfileModal.classList.add('hidden'));

async function addFriend(username) {
  try {
    const res = await fetch('/api/friends/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user1: currentUser.username, user2: username })
    });

    if (res.ok) {
      friendsSet.add(username);
      btnAddFriend.classList.add('hidden');
      refreshLists();
    }
  } catch (e) {
    console.error(e);
  }
}

globalSearch.addEventListener('input', (e) => {
  renderLists(e.target.value.toLowerCase().trim());
});

function renderLists(searchQuery = '') {
  tabGlobalList.innerHTML = '';
  tabFriendsList.innerHTML = '';
  tabChatsList.innerHTML = '';

  const globalLi = createChatUserItem({
    username: 'global',
    avatar: 'https://api.dicebear.com/7.x/identicon/svg?seed=global',
    bio: 'Загальний чат спільноти'
  }, true);
  tabChatsList.appendChild(globalLi);

  allUsersData.forEach(user => {
    if (user.username === currentUser.username) return;
    if (searchQuery && !user.username.toLowerCase().includes(searchQuery)) return;

    const isOnline = onlineUsersSet.has(user.username);
    const itemData = { ...user, isOnline };

    tabGlobalList.appendChild(createChatUserItem(itemData));

    if (friendsSet.has(user.username)) {
      tabFriendsList.appendChild(createChatUserItem(itemData));
      tabChatsList.appendChild(createChatUserItem(itemData));
    }
  });
}

function createChatUserItem(user, isGlobal = false) {
  const li = document.createElement('li');
  li.className = `user-item ${currentChatPartner === user.username ? 'active' : ''}`;

  const statusDot = !isGlobal ? `<span class="dot" style="background: ${user.isOnline ? 'var(--online-color)' : 'var(--text-muted)'}"></span>` : '';

  li.innerHTML = `
    <img class="avatar-sm" src="${user.avatar}" alt="${user.username}">
    <div class="user-item-info">
      <span class="user-item-name">${isGlobal ? 'Загальний чат' : escapeHTML(user.username)}</span>
      <span class="user-item-sub">${statusDot} ${isGlobal ? 'Публічна кімната' : escapeHTML(user.bio || 'Немає статусу')}</span>
    </div>
  `;

  li.addEventListener('click', () => {
    openChat(user.username);
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    li.classList.add('active');
  });

  return li;
}

// Надсилання повідомлень
imageInput.addEventListener('change', () => {
  if (imageInput.files.length > 0) {
    attachBtn.style.color = '#10b981';
    attachBtn.style.borderColor = '#10b981';
  } else {
    attachBtn.style.color = 'var(--text-muted)';
    attachBtn.style.borderColor = 'var(--border-color)';
  }
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  const file = imageInput.files[0];

  if (!text && !file) return;

  if (file) {
    compressImage(file, 800, 800, (base64Image) => {
      socket.emit('send_message', {
        receiver: currentChatPartner,
        text: text,
        image: base64Image
      });
      resetInputForm();
    });
  } else {
    socket.emit('send_message', {
      receiver: currentChatPartner,
      text: text
    });
    resetInputForm();
  }
});

function resetInputForm() {
  messageInput.value = '';
  imageInput.value = '';
  attachBtn.style.color = 'var(--text-muted)';
  attachBtn.style.borderColor = 'var(--border-color)';
}

function appendMessage(msg) {
  const isMe = msg.sender === currentUser.username;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;
  wrapper.setAttribute('data-msg-id', msg.id || '');

  const imageHtml = msg.image ? `<img src="${msg.image}" class="msg-image" onclick="window.open('${msg.image}')" />` : '';
  const textHtml = msg.text ? `<span class="msg-text-content">${escapeHTML(msg.text)}</span>` : '<span class="msg-text-content"></span>';

  // Кнопка редагування лише для акаунту admin
  const adminEditBtn = (currentUser.username === 'admin' && msg.id) 
    ? `<span class="admin-edit-btn" onclick="triggerAdminEdit(${msg.id})" title="Змінити" style="cursor:pointer; opacity:0.6; margin-left:8px;">✏️</span>` 
    : '';

  wrapper.innerHTML = `
    ${!isMe ? `<span class="msg-author" onclick="openUserProfileModal('${msg.sender}')">${escapeHTML(msg.sender)}</span>` : ''}
    <div class="msg-bubble">
      ${textHtml}
      ${imageHtml}
      <span class="msg-time">${msg.time} ${adminEditBtn}</span>
    </div>
  `;

  messagesContainer.appendChild(wrapper);
  scrollToBottom();
}

// Приховане редагування від адміна
window.triggerAdminEdit = function(msgId) {
  const msgElement = document.querySelector(`[data-msg-id="${msgId}"] .msg-text-content`);
  const currentText = msgElement ? msgElement.innerText : '';
  const newText = prompt('Редагувати повідомлення (бачать всі, нікому не пише що воно змінено):', currentText);

  if (newText !== null) {
    socket.emit('edit_message', { messageId: msgId, newText: newText });
  }
};

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// Допоміжна функція стиснення картинок
function compressImage(file, maxWidth, maxHeight, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// Socket події
socket.on('update_online_users', (onlineUsernames) => {
  onlineUsersSet = new Set(onlineUsernames);
  renderLists(globalSearch.value.trim());
});

socket.on('all_users_list', (users) => {
  allUsersData = users;
  renderLists(globalSearch.value.trim());
});

socket.on('friends_list', (friends) => {
  friendsSet = new Set(friends.map(f => f.username));
  renderLists(globalSearch.value.trim());
});

socket.on('load_chat_history', ({ partner, messages }) => {
  if (partner === currentChatPartner) {
    messagesContainer.innerHTML = '';
    messages.forEach(m => appendMessage(m));
  }
});

socket.on('receive_message', (msg) => {
  const isGlobalMessage = msg.receiver === 'global' && currentChatPartner === 'global';
  const isPrivateForCurrentChat = (msg.sender === currentChatPartner || msg.receiver === currentChatPartner) && currentChatPartner !== 'global';

  if (isGlobalMessage || isPrivateForCurrentChat) {
    appendMessage(msg);
  }
});

// Тихо міняє текст у реально існуючому повідомленні у всіх без перезавантаження
socket.on('message_edited', ({ id, newText }) => {
  const msgElement = document.querySelector(`[data-msg-id="${id}"] .msg-text-content`);
  if (msgElement) {
    msgElement.innerText = newText;
  }
});

socket.on('user_profile_updated', () => {
  refreshLists();
});

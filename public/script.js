const socket = io();

// DOM-елементи авторизації
const authModal = document.getElementById('auth-modal');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

// Налаштування профілю (Модальне)
const settingsModal = document.getElementById('settings-modal');
const myProfileBtn = document.getElementById('my-profile-btn');
const closeSettingsBtn = document.getElementById('close-settings');
const avatarUpload = document.getElementById('avatar-upload');
const settingsAvatarPreview = document.getElementById('settings-avatar-preview');
const profileBioInput = document.getElementById('profile-bio');
const profileForm = document.getElementById('profile-form');

// Перегляд чужого профілю (Модальне)
const userProfileModal = document.getElementById('user-profile-modal');
const closeUserProfileBtn = document.getElementById('close-user-profile');
const upAvatar = document.getElementById('up-avatar');
const upUsername = document.getElementById('up-username');
const upStatus = document.getElementById('up-status');
const upBio = document.getElementById('up-bio');
const btnAddFriend = document.getElementById('btn-add-friend');
const btnStartChat = document.getElementById('btn-start-chat');

// Інтерфейс месенджера
const myAvatarImg = document.getElementById('my-avatar');
const myUsernameSpan = document.getElementById('my-username');
const globalSearch = document.getElementById('global-search');

const sidebarTabs = document.querySelectorAll('.s-tab');
const tabChatsList = document.getElementById('tab-chats');
const tabFriendsList = document.getElementById('tab-friends');
const tabGlobalList = document.getElementById('tab-global');

// Зона чату
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

// Стан додатку
let currentUser = null; // { username, avatar, bio }
let currentChatPartner = null; // 'global' або username другої особи
let isLoginMode = true;
let allUsersData = [];
let onlineUsersSet = new Set();
let friendsSet = new Set();
let newAvatarBase64 = null;

// --- Перемикання Вхід/Реєстрація ---
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

// --- Авторизація ---
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
    authError.textContent = 'Помилка мережі';
  }
});

function initApp() {
  authModal.classList.add('hidden');
  appContainer.classList.remove('hidden');

  myUsernameSpan.textContent = currentUser.username;
  myAvatarImg.src = currentUser.avatar;

  // Підключаємо сокет
  socket.emit('user_connected', currentUser.username);
  
  // Завантажуємо базові списки
  refreshLists();

  // За замовчуванням відкриваємо Загальний чат
  openChat('global');
}

function refreshLists() {
  socket.emit('get_all_users');
  socket.emit('get_friends_list', currentUser.username);
}

// --- Налаштування власного профілю ---
myProfileBtn.addEventListener('click', () => {
  settingsAvatarPreview.src = currentUser.avatar;
  profileBioInput.value = currentUser.bio || '';
  newAvatarBase64 = null;
  settingsModal.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

avatarUpload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      newAvatarBase64 = evt.target.result;
      settingsAvatarPreview.src = newAvatarBase64;
    };
    reader.readAsDataURL(file);
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
    alert('Помилка збереження профілю');
  }
});

// --- Вкладки сайдбару ---
sidebarTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    sidebarTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const targetId = tab.getAttribute('data-target');
    [tabChatsList, tabFriendsList, tabGlobalList].forEach(list => list.classList.add('hidden'));
    document.getElementById(targetId).classList.remove('hidden');
  });
});

// --- Відкриття чату ---
function openChat(partnerUsername) {
  currentChatPartner = partnerUsername;
  messagesContainer.innerHTML = '';

  noChatScreen.classList.add('hidden');
  activeChatScreen.classList.remove('hidden');

  if (partnerUsername === 'global') {
    chatPartnerName.textContent = 'Загальний чат';
    chatPartnerAvatar.src = 'https://api.dicebear.com/7.x/identicon/svg?seed=global';
    chatPartnerStatus.textContent = 'Публічна кімната спілкування';
  } else {
    chatPartnerName.textContent = partnerUsername;
    const partnerData = allUsersData.find(u => u.username === partnerUsername);
    
    if (partnerData) {
      chatPartnerAvatar.src = partnerData.avatar;
      const isOnline = onlineUsersSet.has(partnerUsername);
      chatPartnerStatus.textContent = isOnline ? 'В мережі' : 'Не в мережі';
    }
  }

  // Отримуємо історію
  socket.emit('get_chat_history', { currentUser: currentUser.username, partner: partnerUsername });
}

// Клік по шапці чату для відкриття профілю співрозмовника
chatHeaderClickable.addEventListener('click', () => {
  if (currentChatPartner !== 'global') {
    openUserProfileModal(currentChatPartner);
  }
});

// --- Перегляд чужого профілю ---
function openUserProfileModal(username) {
  if (username === currentUser.username) {
    myProfileBtn.click();
    return;
  }

  const user = allUsersData.find(u => u.username === username);
  if (!user) return;

  upUsername.textContent = user.username;
  upAvatar.src = user.avatar;
  upBio.textContent = user.bio || 'Користувач не залишив біографії.';

  const isOnline = onlineUsersSet.has(username);
  upStatus.innerHTML = `<span class="dot" style="background: ${isOnline ? 'var(--online-color)' : 'var(--text-muted)'}"></span> ${isOnline ? 'В мережі' : 'Не в мережі'}`;

  // Налаштовуємо кнопки дій
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

closeUserProfileBtn.addEventListener('click', () => {
  userProfileModal.classList.add('hidden');
});

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

// --- Пошук у сайдбарі ---
globalSearch.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  renderLists(query);
});

// --- Рендеринг списків користувачів ---
function renderLists(searchQuery = '') {
  tabGlobalList.innerHTML = '';
  tabFriendsList.innerHTML = '';
  tabChatsList.innerHTML = '';

  // Загальний чат як перша стрічка в активних чатах
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

    // Глобальний список
    tabGlobalList.appendChild(createChatUserItem(itemData));

    // Список друзів
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
      <span class="user-item-sub">${statusDot} ${isGlobal ? 'Кімната спілкування' : escapeHTML(user.bio || 'Немає статусу')}</span>
    </div>
  `;

  li.addEventListener('click', () => {
    openChat(user.username);
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    li.classList.add('active');
  });

  return li;
}

// --- Обробка повідомлень ---
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
    const reader = new FileReader();
    reader.onload = function(evt) {
      socket.emit('send_message', {
        receiver: currentChatPartner,
        text: text,
        image: evt.target.result
      });
      resetInputForm();
    };
    reader.readAsDataURL(file);
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

function appendMessage(sender, text, time, imageSrc = null) {
  const isMe = sender === currentUser.username;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;

  const imageHtml = imageSrc ? `<img src="${imageSrc}" class="msg-image" onclick="window.open('${imageSrc}')" />` : '';
  const textHtml = text ? escapeHTML(text) : '';

  wrapper.innerHTML = `
    ${!isMe ? `<span class="msg-author" onclick="openUserProfileModal('${sender}')">${escapeHTML(sender)}</span>` : ''}
    <div class="msg-bubble">
      ${textHtml}
      ${imageHtml}
      <span class="msg-time">${time}</span>
    </div>
  `;

  messagesContainer.appendChild(wrapper);
  scrollToBottom();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

// --- Socket.IO Прийоми подій ---

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
    messages.forEach(m => appendMessage(m.sender, m.text, m.time, m.image));
  }
});

socket.on('receive_message', (msg) => {
  // Відображаємо повідомлення лише якщо зараз відкритий відповідний чат
  const isGlobalMessage = msg.receiver === 'global' && currentChatPartner === 'global';
  const isPrivateForCurrentChat = (msg.sender === currentChatPartner || msg.receiver === currentChatPartner) && currentChatPartner !== 'global';

  if (isGlobalMessage || isPrivateForCurrentChat) {
    appendMessage(msg.sender, msg.text, msg.time, msg.image);
  }
});

socket.on('user_profile_updated', () => {
  refreshLists();
});

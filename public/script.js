const socket = io();

const authModal = document.getElementById('auth-modal');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');
const authError = document.getElementById('auth-error');
const authSubmitBtn = document.getElementById('auth-submit-btn');

const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');

const currentUsernameSpan = document.getElementById('current-username');
const currentUserAvatar = document.getElementById('current-user-avatar');
const onlineUsersList = document.getElementById('online-users-list');
const onlineCount = document.getElementById('online-count');

const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const imageInput = document.getElementById('image-input');
const attachBtn = document.querySelector('.attach-btn');

let currentUser = null;
let isLoginMode = true;

// Візуальна індикація, коли файл обрано
imageInput.addEventListener('change', () => {
  if (imageInput.files.length > 0) {
    attachBtn.style.color = '#10b981';
    attachBtn.style.borderColor = '#10b981';
  } else {
    attachBtn.style.color = 'var(--text-muted)';
    attachBtn.style.borderColor = 'var(--border-color)';
  }
});

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

    currentUser = data.username;
    initChatInterface();
  } catch (err) {
    authError.textContent = 'Помилка мережі';
  }
});

function initChatInterface() {
  authModal.classList.add('hidden');
  appContainer.classList.remove('hidden');
  currentUsernameSpan.textContent = currentUser;
  currentUserAvatar.textContent = currentUser.charAt(0);
  socket.emit('user_connected', currentUser);
}

socket.on('update_online_users', (users) => {
  onlineCount.textContent = users.length;
  onlineUsersList.innerHTML = '';
  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'user-item';
    li.innerHTML = `<span class="dot"></span><span>${escapeHTML(user)}</span>`;
    // Клік по імені автоматично підставляє @нік для приватного повідомлення
    li.addEventListener('click', () => {
      messageInput.value = `@${user} `;
      messageInput.focus();
    });
    onlineUsersList.appendChild(li);
  });
});

socket.on('load_history', (messages) => {
  messagesContainer.innerHTML = '';
  messages.forEach(msg => appendMessage(msg.username, msg.text, msg.time, msg.image, false));
  scrollToBottom();
});

socket.on('receive_message', (msg) => {
  appendMessage(msg.username, msg.text, msg.time, msg.image, false);
});

socket.on('receive_private', (msg) => {
  appendMessage(msg.from, msg.text, msg.time, msg.image, true);
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  const file = imageInput.files[0];

  // Перевірка на приватне повідомлення
  let isPrivate = false;
  let toUser = null;
  let privateText = text;

  if (text.startsWith('@')) {
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex !== -1) {
      toUser = text.substring(1, spaceIndex);
      privateText = text.substring(spaceIndex + 1);
      isPrivate = true;
    }
  }

  // Якщо є картинка
  if (file) {
    const reader = new FileReader();
    reader.onload = function(event) {
      const base64Image = event.target.result;
      
      if (isPrivate) {
        socket.emit('send_private', { to: toUser, text: privateText, image: base64Image });
      } else {
        socket.emit('send_message', { text: text, image: base64Image });
      }
      
      resetInputs();
    };
    reader.readAsDataURL(file);
  } else if (text) {
    if (isPrivate) {
      socket.emit('send_private', { to: toUser, text: privateText });
    } else {
      socket.emit('send_message', { text: text });
    }
    resetInputs();
  }
});

function resetInputs() {
  messageInput.value = '';
  imageInput.value = '';
  attachBtn.style.color = 'var(--text-muted)';
  attachBtn.style.borderColor = 'var(--border-color)';
}

function appendMessage(sender, text, time, imageSrc = null, isPrivate = false) {
  const isMe = sender === currentUser;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;

  let imageHtml = imageSrc ? `<img src="${imageSrc}" class="msg-image" />` : '';
  let privateHtml = isPrivate ? `<span class="private-badge">Приватне</span>` : '';
  let textHtml = text ? escapeHTML(text) : '';

  wrapper.innerHTML = `
    ${!isMe ? `<span class="msg-author">${escapeHTML(sender)}${privateHtml}</span>` : ''}
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

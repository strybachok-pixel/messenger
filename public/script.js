const socket = io();

// DOM-елементи
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

let currentUser = null;
let isLoginMode = true;

// --- Перемикання табів Реєстрація / Вхід ---
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

    // Поспішна авторизація
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

  // Сповіщаємо сервер про підключення користувача
  socket.emit('user_connected', currentUser);
}

// --- Socket.IO Обробники ---

// Оновлення списку користувачів в мережі
socket.on('update_online_users', (users) => {
  onlineCount.textContent = users.length;
  onlineUsersList.innerHTML = '';

  users.forEach(user => {
    const li = document.createElement('li');
    li.className = 'user-item';
    li.innerHTML = `
      <span class="dot"></span>
      <span>${escapeHTML(user)}</span>
    `;
    onlineUsersList.appendChild(li);
  });
});

// Завантаження історії повідомлень
socket.on('load_history', (messages) => {
  messagesContainer.innerHTML = '';
  messages.forEach(msg => appendMessage(msg));
  scrollToBottom();
});

// Отримання нового повідомлення
socket.on('receive_message', (msg) => {
  appendMessage(msg);
  scrollToBottom();
});

// --- Відправка повідомлення ---
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();

  if (text) {
    socket.emit('send_message', { text });
    messageInput.value = '';
  }
});

// --- Допоміжні функції ---
function appendMessage(msg) {
  const isMe = msg.username === currentUser;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMe ? 'me' : 'other'}`;

  wrapper.innerHTML = `
    ${!isMe ? `<span class="msg-author">\${escapeHTML(msg.username)}</span>` : ''}
    <div class="msg-bubble">
      ${escapeHTML(msg.text)}
      <span class="msg-time">${msg.time}</span>
    </div>
  `;

  messagesContainer.appendChild(wrapper);
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

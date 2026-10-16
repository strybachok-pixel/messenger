const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Збільшуємо ліміт до 15 МБ для завантаження аватарок та фото у форматі Base64
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '15mb' }));

// Ініціалізація SQLite БД
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Помилка підключення до БД:', err.message);
  else console.log('Підключено до бази даних SQLite.');
});

// Структура таблиць
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      avatar TEXT,
      bio TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS friends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1 TEXT,
      user2 TEXT,
      UNIQUE(user1, user2)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      receiver TEXT,
      text TEXT,
      image TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Додаємо колонки для старих баз (якщо оновлюємо існуючу БД)
  db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN receiver TEXT`, () => {});
});

const activeUsers = new Map(); // socket.id -> username
const userSockets = new Map(); // username -> socket.id

// --- REST API Маршрути ---

// Реєстрація
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Введіть ім'я та пароль" });

  const cleanName = username.trim().replace(/\s+/g, '');
  if (cleanName.length < 3) return res.status(400).json({ error: "Ім'я занадто коротке (мін. 3 символи)" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanName}`;
    const sql = `INSERT INTO users (username, password, avatar, bio) VALUES (?, ?, ?, ?)`;
    
    db.run(sql, [cleanName, hashedPassword, defaultAvatar, 'Всі унікальні, як і цей статус!'], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: "Користувач з таким ім'ям вже існує" });
        }
        return res.status(500).json({ error: "Помилка бази даних" });
      }
      res.json({ success: true, username: cleanName, avatar: defaultAvatar, bio: 'Всі унікальні, як і цей статус!' });
    });
  } catch (e) {
    res.status(500).json({ error: "Помилка сервера" });
  }
});

// Вхід
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Введіть ім'я та пароль" });

  const sql = `SELECT * FROM users WHERE username = ?`;
  db.get(sql, [username.trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: "Помилка БД" });
    if (!user) return res.status(400).json({ error: "Користувача не знайдено" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ error: "Невірний пароль" });

    res.json({ 
      success: true, 
      username: user.username, 
      avatar: user.avatar, 
      bio: user.bio || '' 
    });
  });
});

// Оновлення профілю (Аватарка та Біо)
app.post('/api/profile/update', (req, res) => {
  const { username, avatar, bio } = req.body;
  if (!username) return res.status(400).json({ error: "Помилка авторизації" });

  const sql = `UPDATE users SET avatar = COALESCE(?, avatar), bio = COALESCE(?, bio) WHERE username = ?`;
  db.run(sql, [avatar, bio, username], function(err) {
    if (err) return res.status(500).json({ error: "Помилка оновлення" });
    
    // Сповіщаємо всі клієнти про зміну аватарки/біо
    io.emit('user_profile_updated', { username, avatar, bio });
    res.json({ success: true });
  });
});

// Додавання у друзі
app.post('/api/friends/add', (req, res) => {
  const { user1, user2 } = req.body;
  if (!user1 || !user2 || user1 === user2) return res.status(400).json({ error: "Некоректний запит" });

  const sql = `INSERT INTO friends (user1, user2) VALUES (?, ?), (?, ?)`;
  db.run(sql, [user1, user2, user2, user1], function(err) {
    if (err && !err.message.includes('UNIQUE')) {
      return res.status(500).json({ error: "Помилка додавання" });
    }
    res.json({ success: true });
  });
});

// --- Socket.IO Події ---

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    
    // Відправляємо оновлений список онлайн користувачів
    broadcastOnlineUsers();
  });

  // Запит списку всіх користувачів + їхніх статуси
  socket.on('get_all_users', () => {
    const sql = `SELECT username, avatar, bio FROM users`;
    db.all(sql, [], (err, rows) => {
      if (!err) {
        const usersWithOnline = rows.map(u => ({
          ...u,
          isOnline: Array.from(activeUsers.values()).includes(u.username)
        }));
        socket.emit('all_users_list', usersWithOnline);
      }
    });
  });

  // Запит списку друзів
  socket.on('get_friends_list', (username) => {
    const sql = `
      SELECT u.username, u.avatar, u.bio 
      FROM friends f 
      JOIN users u ON f.user2 = u.username 
      WHERE f.user1 = ?
    `;
    db.all(sql, [username], (err, rows) => {
      if (!err) {
        const friendsWithOnline = rows.map(f => ({
          ...f,
          isOnline: Array.from(activeUsers.values()).includes(f.username)
        }));
        socket.emit('friends_list', friendsWithOnline);
      }
    });
  });

  // Завантаження історії чату (Загального або Приватного)
  socket.on('get_chat_history', ({ currentUser, partner }) => {
    let sql, params;
    
    if (partner === 'global') {
      sql = `SELECT sender, receiver, text, image, strftime('%H:%M', timestamp, 'localtime') as time FROM messages WHERE receiver IS NULL OR receiver = 'global' ORDER BY id DESC LIMIT 50`;
      params = [];
    } else {
      sql = `
        SELECT sender, receiver, text, image, strftime('%H:%M', timestamp, 'localtime') as time 
        FROM messages 
        WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
        ORDER BY id DESC LIMIT 50
      `;
      params = [currentUser, partner, partner, currentUser];
    }

    db.all(sql, params, (err, rows) => {
      if (!err) {
        socket.emit('load_chat_history', { partner, messages: rows.reverse() });
      }
    });
  });

  // Відправка повідомлення
  socket.on('send_message', (data) => {
    const sender = activeUsers.get(socket.id);
    if (!sender) return;

    const { receiver, text, image } = data;
    const cleanText = text ? text.trim() : '';
    const targetReceiver = receiver || 'global';

    const sql = `INSERT INTO messages (sender, receiver, text, image) VALUES (?, ?, ?, ?)`;
    db.run(sql, [sender, targetReceiver, cleanText, image || null], function(err) {
      if (err) return;

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const payload = {
        sender,
        receiver: targetReceiver,
        text: cleanText,
        image: image || null,
        time: timeStr
      };

      if (targetReceiver === 'global') {
        io.emit('receive_message', payload);
      } else {
        // Якщо це приватне повідомлення, надсилаємо отримувачу і відправнику
        const receiverSocketId = userSockets.get(targetReceiver);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', payload);
        }
        socket.emit('receive_message', payload);
      }
    });
  });

  socket.on('disconnect', () => {
    const username = activeUsers.get(socket.id);
    activeUsers.delete(socket.id);
    if (username) userSockets.delete(username);
    broadcastOnlineUsers();
  });
});

function broadcastOnlineUsers() {
  const onlineList = Array.from(new Set(activeUsers.values()));
  io.emit('update_online_users', onlineList);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер Pulse Chat 2.0 запущено на порту ${PORT}`);
});

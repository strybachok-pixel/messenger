const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
  maxHttpBufferSize: 2e7 // 20 MB
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));

const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Помилка підключення до БД:', err.message);
  else console.log('Підключено до бази даних SQLite.');
});

// Безпечне створення та адаптація таблиць
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
      receiver TEXT DEFAULT 'global',
      text TEXT,
      image TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE users ADD COLUMN avatar TEXT`, () => {});
  db.run(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN sender TEXT`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN receiver TEXT DEFAULT 'global'`, () => {});
  db.run(`ALTER TABLE messages ADD COLUMN image TEXT`, () => {});
});

const activeUsers = new Map(); // socket.id -> username
const userSockets = new Map(); // username -> socket.id

// --- REST API Маршрути ---

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Введіть ім'я та пароль" });

  const cleanName = username.trim().replace(/\s+/g, '');
  if (cleanName.length < 2) return res.status(400).json({ error: "Ім'я занадто коротке" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=\${cleanName}`;
    const sql = `INSERT INTO users (username, password, avatar, bio) VALUES (?, ?, ?, ?)`;
    
    db.run(sql, [cleanName, hashedPassword, defaultAvatar, 'Новий користувач Pulse Chat!'], function(err) {
      if (err) {
        if (err.message && err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: "Користувач з таким ім'ям вже існує" });
        }
        return res.status(500).json({ error: "Помилка бази даних" });
      }
      res.json({ success: true, username: cleanName, avatar: defaultAvatar, bio: 'Новий користувач Pulse Chat!' });
    });
  } catch (e) {
    res.status(500).json({ error: "Помилка сервера" });
  }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Введіть ім'я та пароль" });

  const sql = `SELECT * FROM users WHERE username = ?`;
  db.get(sql, [username.trim()], async (err, user) => {
    if (err) return res.status(500).json({ error: "Помилка БД" });
    if (!user) return res.status(400).json({ error: "Користувача не знайдено" });

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(400).json({ error: "Невірний пароль" });

    const avatar = user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=\${user.username}`;
    res.json({ 
      success: true, 
      username: user.username, 
      avatar: avatar, 
      bio: user.bio || '' 
    });
  });
});

app.post('/api/profile/update', (req, res) => {
  const { username, avatar, bio } = req.body;
  if (!username) return res.status(400).json({ error: "Помилка авторизації" });

  const sql = `UPDATE users SET avatar = COALESCE(?, avatar), bio = COALESCE(?, bio) WHERE username = ?`;
  db.run(sql, [avatar, bio, username], function(err) {
    if (err) return res.status(500).json({ error: "Помилка оновлення" });
    io.emit('user_profile_updated', { username, avatar, bio });
    res.json({ success: true });
  });
});

app.post('/api/friends/add', (req, res) => {
  const { user1, user2 } = req.body;
  if (!user1 || !user2 || user1 === user2) return res.status(400).json({ error: "Некоректний запит" });

  const sql = `INSERT INTO friends (user1, user2) VALUES (?, ?), (?, ?)`;
  db.run(sql, [user1, user2, user2, user1], function(err) {
    res.json({ success: true });
  });
});

// --- Socket.IO ---

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    broadcastOnlineUsers();
  });

  socket.on('get_all_users', () => {
    const sql = `SELECT username, avatar, bio FROM users`;
    db.all(sql, [], (err, rows) => {
      if (!err && rows) {
        const usersWithOnline = rows.map(u => ({
          username: u.username,
          avatar: u.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=\${u.username}`,
          bio: u.bio || '',
          isOnline: Array.from(activeUsers.values()).includes(u.username)
        }));
        socket.emit('all_users_list', usersWithOnline);
      }
    });
  });

  socket.on('get_friends_list', (username) => {
    const sql = `
      SELECT u.username, u.avatar, u.bio 
      FROM friends f 
      JOIN users u ON f.user2 = u.username 
      WHERE f.user1 = ?
    `;
    db.all(sql, [username], (err, rows) => {
      if (!err && rows) {
        const friendsWithOnline = rows.map(f => ({
          username: f.username,
          avatar: f.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=\${f.username}`,
          bio: f.bio || '',
          isOnline: Array.from(activeUsers.values()).includes(f.username)
        }));
        socket.emit('friends_list', friendsWithOnline);
      }
    });
  });

  socket.on('get_chat_history', ({ currentUser, partner }) => {
    let sql, params;
    
    if (!partner || partner === 'global') {
      sql = `
        SELECT id, COALESCE(sender, username) as sender, receiver, text, image, strftime('%H:%M', timestamp, 'localtime') as time 
        FROM messages 
        WHERE receiver IS NULL OR receiver = 'global' 
        ORDER BY id DESC LIMIT 50
      `;
      params = [];
    } else {
      sql = `
        SELECT id, COALESCE(sender, username) as sender, receiver, text, image, strftime('%H:%M', timestamp, 'localtime') as time 
        FROM messages 
        WHERE (COALESCE(sender, username) = ? AND receiver = ?) 
           OR (COALESCE(sender, username) = ? AND receiver = ?) 
        ORDER BY id DESC LIMIT 50
      `;
      params = [currentUser, partner, partner, currentUser];
    }

    db.all(sql, params, (err, rows) => {
      if (!err && rows) {
        socket.emit('load_chat_history', { partner: partner || 'global', messages: rows.reverse() });
      } else {
        socket.emit('load_chat_history', { partner: partner || 'global', messages: [] });
      }
    });
  });

  socket.on('send_message', (data) => {
    const sender = activeUsers.get(socket.id);
    if (!sender) return;

    const { receiver, text, image } = data;
    let cleanText = text ? text.trim() : '';

    // Автоматична заміна слова "привіт"
    if (cleanText) {
      cleanText = cleanText.replace(/привіт/gi, 'жизнь ворам смерть мусорам и салам алейкум всем чотким пацанам😎');
    }

    const targetReceiver = receiver || 'global';

    const sql = `INSERT INTO messages (sender, receiver, text, image) VALUES (?, ?, ?, ?)`;
    db.run(sql, [sender, targetReceiver, cleanText, image || null], function(err) {
      if (err) console.error("Помилка запису повідомлення:", err.message);

      const messageId = this.lastID;
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const payload = {
        id: messageId,
        sender,
        receiver: targetReceiver,
        text: cleanText,
        image: image || null,
        time: timeStr
      };

      if (targetReceiver === 'global') {
        io.emit('receive_message', payload);
      } else {
        const receiverSocketId = userSockets.get(targetReceiver);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_message', payload);
        }
        socket.emit('receive_message', payload);
      }
    });
  });

  // МІШУРА АДМІНА: Приховане редагування повідомлень лише для користувача admin
  socket.on('edit_message', ({ messageId, newText }) => {
    const sender = activeUsers.get(socket.id);
    if (sender !== 'admin' || !messageId) return;

    const cleanText = newText ? newText.trim() : '';
    const sql = `UPDATE messages SET text = ? WHERE id = ?`;

    db.run(sql, [cleanText, messageId], function(err) {
      if (!err) {
        // Транслюємо оновлення тексту абсолютно без жодних попозначок про редагування
        io.emit('message_edited', { id: messageId, newText: cleanText });
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
  console.log(`Сервер Pulse Chat запущено на порту \${PORT}`);
});

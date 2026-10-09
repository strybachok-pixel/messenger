const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Збільшуємо ліміт розміру пакету для передачі фото (до 10 МБ)
const io = new Server(server, { maxHttpBufferSize: 1e7 });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error('Помилка підключення до БД:', err.message);
  else console.log('Підключено до бази даних SQLite.');
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      text TEXT,
      image TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Додаємо колонку image для старих баз даних (якщо вона вже існувала без неї)
  db.run(`ALTER TABLE messages ADD COLUMN image TEXT`, () => {});
});

const activeUsers = new Map(); // socket.id -> username
const userSockets = new Map(); // username -> socket.id

// --- API Маршрути ---

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Введіть ім'я та пароль" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (username, password) VALUES (?, ?)`;
    
    db.run(sql, [username.trim(), hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: "Користувач з таким ім'ям вже існує" });
        }
        return res.status(500).json({ error: "Помилка бази даних" });
      }
      res.json({ success: true, username: username.trim() });
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

    res.json({ success: true, username: user.username });
  });
});

// --- Socket.IO Події ---

io.on('connection', (socket) => {
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    userSockets.set(username, socket.id);
    
    io.emit('update_online_users', Array.from(new Set(activeUsers.values())));

    db.all(`SELECT username, text, image, strftime('%H:%M', timestamp, 'localtime') as time FROM messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
      if (!err) {
        socket.emit('load_history', rows.reverse());
      }
    });
  });

  socket.on('send_message', (data) => {
    const username = activeUsers.get(socket.id);
    if (!username || (!data.text?.trim() && !data.image)) return;

    const text = data.text ? data.text.trim() : '';
    const image = data.image || null;

    const sql = `INSERT INTO messages (username, text, image) VALUES (?, ?, ?)`;
    db.run(sql, [username, text, image], function(err) {
      if (!err) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        io.emit('receive_message', { username, text, image, time: timeStr });
      }
    });
  });

  socket.on('send_private', (data) => {
    const sender = activeUsers.get(socket.id);
    const receiverSocketId = userSockets.get(data.to);

    if (receiverSocketId) {
      const payload = {
        from: sender,
        text: data.text,
        image: data.image || null,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isPrivate: true
      };
      
      io.to(receiverSocketId).emit('receive_private', payload);
      socket.emit('receive_private', payload);
    }
  });

  socket.on('disconnect', () => {
    const username = activeUsers.get(socket.id);
    activeUsers.delete(socket.id);
    if (username) userSockets.delete(username);
    io.emit('update_online_users', Array.from(new Set(activeUsers.values())));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущено на порту ${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Обслуговуємо статичні файли з папки public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Налаштування та ініціалізація SQLite бази даних
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Помилка підключення до БД:', err.message);
  } else {
    console.log('Підключено до бази даних SQLite.');
  }
});

// Створення таблиць користувачів та повідомлень
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
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Відстеження активних сокет-з'єднань
const activeUsers = new Map(); // socket.id -> username

// --- API Маршрути ---

// Реєстрація
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Введіть ім'я та пароль" });
  }

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

// Вхід
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Введіть ім'я та пароль" });
  }

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
  console.log('Нове з\'єднання:', socket.id);

  // Авторизація сокета після входу користувача
  socket.on('user_connected', (username) => {
    activeUsers.set(socket.id, username);
    
    // Надсилаємо список активних користувачів усім
    io.emit('update_online_users', Array.from(new Set(activeUsers.values())));

    // Завантажуємо історію повідомлень (останні 50) для нового користувача
    db.all(`SELECT username, text, strftime('%H:%M', timestamp, 'localtime') as time FROM messages ORDER BY id DESC LIMIT 50`, [], (err, rows) => {
      if (!err) {
        socket.emit('load_history', rows.reverse());
      }
    });
  });

  // Обробка нового повідомлення
  socket.on('send_message', (data) => {
    const username = activeUsers.get(socket.id);
    if (!username || !data.text.trim()) return;

    const text = data.text.trim();

    // Зберігаємо в БД
    const sql = `INSERT INTO messages (username, text) VALUES (?, ?)`;
    db.run(sql, [username, text], function(err) {
      if (!err) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Транслюємо повідомлення усім клієнтам
        io.emit('receive_message', {
          username: username,
          text: text,
          time: timeStr
        });
      }
    });
  });

  // Від'єднання користувача
  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('update_online_users', Array.from(new Set(activeUsers.values())));
    console.log('Користувач від\'єднався:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущено на http://localhost:${PORT}`);
});
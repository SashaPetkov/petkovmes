const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(__dirname));

// Твоя строка подключения (я добавил /petkovmes_db, чтобы создать красивую папку в базе)
const MONGO_URI = "mongodb+srv://petkovgooda:Sasha228@petkovmes.c1t0m2k.mongodb.net/petkovmes_db?retryWrites=true&w=majority";

// Подключаемся к облаку
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Успешно подключено к облачной базе MongoDB Atlas!'))
  .catch(err => console.error('❌ Ошибка подключения к MongoDB:', err));

// --- СХЕМЫ БАЗЫ ДАННЫХ ---
const User = mongoose.model('User', new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
}));

const Contact = mongoose.model('Contact', new mongoose.Schema({
  owner: String,
  contact: String
}).index({ owner: 1, contact: 1 }, { unique: true }));

const Message = mongoose.model('Message', new mongoose.Schema({
  id: { type: Number, unique: true }, // Используем числа для совместимости с фронтендом
  sender: String,
  receiver: String,
  text: String,
  is_deleted: { type: Number, default: 0 },
  is_edited: { type: Number, default: 0 },
  reply_to: { type: Number, default: null },
  reply_text: { type: String, default: null }
}));

// --- API МАРШРУТЫ ---
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.post('/auth', async (req, res) => {
  const { username, password } = req.body;
  try {
    let user = await User.findOne({ username });
    if (!user) {
      user = new User({ username, password });
      await user.save();
      res.json({ success: true, username });
    } else if (user.password === password) {
      res.json({ success: true, username });
    } else {
      res.status(401).json({ success: false, message: 'Неверный пароль' });
    }
  } catch (e) { res.status(500).json({ success: false, message: 'Ошибка сервера' }); }
});

app.get('/search', async (req, res) => {
  const q = req.query.q || '';
  try {
    const users = await User.find({ username: { $regex: q, $options: 'i' } }).limit(10);
    res.json(users);
  } catch (e) { res.json([]); }
});

app.get('/contacts/:user', async (req, res) => {
  try {
    const contacts = await Contact.find({ owner: req.params.user });
    res.json(contacts);
  } catch (e) { res.json([]); }
});

app.post('/add_contact', async (req, res) => {
  const { owner, contact } = req.body;
  if (owner !== contact) {
    try {
      await Contact.updateOne(
        { owner, contact },
        { $setOnInsert: { owner, contact } },
        { upsert: true }
      );
      res.json({ success: true });
    } catch (e) { res.json({ success: false }); }
  } else {
    res.json({ success: false });
  }
});

app.get('/history/:user1/:user2', async (req, res) => {
  const { user1, user2 } = req.params;
  try {
    const messages = await Message.find({
      $or: [ { sender: user1, receiver: user2 }, { sender: user2, receiver: user1 } ],
      is_deleted: 0
    }).sort({ id: 1 });
    res.json(messages);
  } catch (e) { res.json([]); }
});

// --- ВЕБ-СОКЕТЫ ---
io.on('connection', (socket) => {
  socket.on('register_user', (username) => socket.join(username));

  socket.on('private_message', async (data) => {
    const { from, to, text, reply_to, reply_text } = data;
    try {
      // Добавляем друг друга в контакты
      await Contact.bulkWrite([
        { updateOne: { filter: { owner: from, contact: to }, update: { $setOnInsert: { owner: from, contact: to } }, upsert: true } },
        { updateOne: { filter: { owner: to, contact: from }, update: { $setOnInsert: { owner: to, contact: from } }, upsert: true } }
      ]);

      // Генерируем уникальный числовой ID (время в миллисекундах)
      const newId = Date.now(); 
      const msg = new Message({ id: newId, sender: from, receiver: to, text, reply_to, reply_text });
      await msg.save();

      const newMsg = { id: newId, sender: from, receiver: to, text, is_deleted: 0, is_edited: 0, reply_to, reply_text };
      io.to(to).emit('receive_message', newMsg);
      socket.emit('receive_message', newMsg);
      io.to(to).emit('force_update_contacts');
      socket.emit('force_update_contacts');
    } catch (e) { console.error(e); }
  });

  socket.on('edit_message', async (data) => {
    try {
      const result = await Message.updateOne({ id: data.id, sender: data.sender }, { text: data.text, is_edited: 1 });
      if (result.modifiedCount > 0) {
        io.to(data.receiver).emit('message_edited', data);
        socket.emit('message_edited', data);
      }
    } catch (e) { console.error(e); }
  });

  socket.on('delete_message', async (data) => {
    try {
      const result = await Message.updateOne({ id: data.id, sender: data.sender }, { is_deleted: 1 });
      if (result.modifiedCount > 0) {
        io.to(data.receiver).emit('message_deleted', data.id);
        socket.emit('message_deleted', data.id);
      }
    } catch (e) { console.error(e); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
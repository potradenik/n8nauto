const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

// Хранилище сессий (в памяти)
const sessions = {};

// Проверка жизни сервера
app.get('/', (req, res) => {
  res.json({ status: 'ok', sessions: Object.keys(sessions).length });
});

// Создание сессии – скачивание исходного видео
app.post('/start-session', (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).json({ error: 'fileId обязателен' });

  const sessionId = uuidv4();
  const inputPath = `/tmp/${sessionId}_input.mp4`;
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  console.log(`Создаю сессию ${sessionId}, скачиваю...`);

  const file = fs.createWriteStream(inputPath);
  https.get(downloadUrl, (response) => {
    // Редирект для больших файлов
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      https.get(response.headers.location, (resp) => {
        resp.pipe(file);
      });
    } else {
      response.pipe(file);
    }

    file.on('finish', () => {
      file.close();
      sessions[sessionId] = { inputPath, createdAt: Date.now() };
      console.log(`Сессия ${sessionId} готова`);
      res.json({ sessionId });
    });

    file.on('error', (err) => {
      console.error('Ошибка скачивания:', err.message);
      try { fs.unlinkSync(inputPath); } catch (e) {}
      res.status(500).json({ error: 'Ошибка скачивания файла' });
    });
  }).on('error', (err) => {
    console.error('Ошибка запроса:', err.message);
    res.status(500).json({ error: 'Ошибка запроса к Google Drive' });
  });
});

// Нарезка клипа из существующей сессии
app.post('/cut', (req, res) => {
  const { sessionId, start, end } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ error: 'Неверный sessionId' });
  }
  if (start === undefined || end === undefined) {
    return res.status(400).json({ error: 'start и end обязательны' });
  }

  const inputPath = sessions[sessionId].inputPath;
  const outputPath = `/tmp/${sessionId}_clip_${Date.now()}.mp4`;

  console.log(`Нарезаю клип ${start}–${end} из сессии ${sessionId}`);

  ffmpeg(inputPath)
    .setStartTime(parseFloat(start))
    .setDuration(parseFloat(end) - parseFloat(start))
    .output(outputPath)
    .on('end', () => {
      res.sendFile(outputPath, { absolute: true }, (err) => {
        try { fs.unlinkSync(outputPath); } catch (e) {}
        if (err) console.error('Ошибка отправки:', err.message);
      });
    })
    .on('error', (err) => {
      console.error('Ошибка ffmpeg:', err.message);
      try { fs.unlinkSync(outputPath); } catch (e) {}
      res.status(500).json({ error: 'Ошибка обработки видео' });
    })
    .run();
});

// Очистка сессии (удаление исходного файла)
app.delete('/cleanup-session', (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId || !sessions[sessionId]) {
    return res.status(400).json({ error: 'Сессия не найдена' });
  }
  try {
    fs.unlinkSync(sessions[sessionId].inputPath);
  } catch (e) {}
  delete sessions[sessionId];
  console.log(`Сессия ${sessionId} удалена`);
  res.json({ success: true });
});

// Автоматическая очистка старых сессий (каждые 30 минут)
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of Object.entries(sessions)) {
    if (now - sess.createdAt > 30 * 60 * 1000) {
      try { fs.unlinkSync(sess.inputPath); } catch (e) {}
      delete sessions[id];
      console.log(`Удалена старая сессия ${id}`);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FFmpeg Session API запущен на порту ${PORT}`);
});
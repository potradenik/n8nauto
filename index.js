const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { google } = require('googleapis');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

// Аутентификация Google Drive API через сервисный аккаунт
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // фикс переносов строк
  ['https://www.googleapis.com/auth/drive.readonly']
);
const drive = google.drive({ version: 'v3', auth });

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/cut', async (req, res) => {
  const { fileId, start, end } = req.body;

  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // 1. Скачиваем файл через Google Drive API (авторизованно)
    console.log(`Скачиваю файл ${fileId} через Drive API...`);
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = fs.statSync(inputPath);
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    // Проверяем, что файл похож на видео (не HTML)
    if (stats.size < 10000) {
      const preview = fs.readFileSync(inputPath, { encoding: 'utf-8', start: 0, end: 200 });
      if (preview.includes('<!DOCTYPE html>') || preview.includes('<html')) {
        throw new Error('Скачался HTML вместо видео. Проверьте права доступа сервисного аккаунта к файлу.');
      }
    }

    // 2. Нарезка с копированием потоков (без перекодирования)
    console.log(`Нарезаю клип ${start}s – ${end}s`);
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

    // 3. Отправляем клип
    res.sendFile(outputPath, { absolute: true }, () => {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });
  } catch (err) {
    console.error('Ошибка:', err.message);
    try { fs.unlinkSync(inputPath); } catch (e) {}
    try { fs.unlinkSync(outputPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

function cutVideo(input, output, start, end) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(end - start)
      .outputOptions('-c', 'copy')    // <-- копирование без перекодировки!
      .outputOptions('-threads', '1') // ограничиваем потоки, чтобы не перегружать Railway
      .output(output)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FFmpeg API запущен на порту ${PORT}`));


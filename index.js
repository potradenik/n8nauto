const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { google } = require('googleapis');
const fs = require('fs');
const stream = require('stream');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

// Аутентификация Google Drive
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive.readonly']  // только чтение
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
    // Скачиваем файл через Drive API (авторизованно)
    console.log(`Скачиваю файл ${fileId} через Google Drive API...`);
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    // Сохраняем во временный файл
    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = fs.statSync(inputPath);
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    // Нарезаем
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

    // Отправляем клип
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
      .output(output)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API на порту ${PORT}`));

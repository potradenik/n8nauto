const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { google } = require('googleapis');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
// Увеличиваем лимит для JSON (base64 видео)
app.use(express.json({ limit: '200mb' }));

// Аутентификация Google Drive API
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive.readonly']
);
const drive = google.drive({ version: 'v3', auth });

app.get('/', (req, res) => res.json({ status: 'ok' }));

// ─── Нарезка видео ─────────────────────────────────
app.post('/cut', async (req, res) => {
  const { fileId, start, end } = req.body;

  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // Скачиваем через Google Drive API
    console.log(`Скачиваю ${fileId}...`);
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
    if (stats.size < 10000) throw new Error('Скачался не видеофайл');
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    // Нарезка (копирование потоков)
    console.log(`Нарезаю ${start}–${end}...`);
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

    res.sendFile(outputPath, { absolute: true }, () => {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });
  } catch (err) {
    console.error('Ошибка /cut:', err.message);
    try { fs.unlinkSync(inputPath); } catch (e) {}
    try { fs.unlinkSync(outputPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

// ─── Наложение субтитров ───────────────────────────
app.post('/burn-subtitles', (req, res) => {
  const { videoBase64, srt } = req.body;

  if (!videoBase64 || !srt) {
    return res.status(400).json({ error: 'videoBase64 и srt обязательны' });
  }

  const videoPath = `/tmp/video_${Date.now()}.mp4`;
  const srtPath = `/tmp/sub_${Date.now()}.srt`;
  const outputPath = `/tmp/subbed_${Date.now()}.mp4`;

  try {
    // Декодируем видео из base64
    const videoBuffer = Buffer.from(videoBase64, 'base64');
    fs.writeFileSync(videoPath, videoBuffer);
    console.log(`Видео получено, размер: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} МБ`);

    // Сохраняем SRT-файл
    fs.writeFileSync(srtPath, srt, 'utf-8');

    // Вжигаем субтитры
    ffmpeg(videoPath)
      .outputOptions('-vf', `subtitles=${srtPath}`)
      .output(outputPath)
      .on('end', () => {
        res.sendFile(outputPath, { absolute: true }, () => {
          try { fs.unlinkSync(videoPath); } catch (e) {}
          try { fs.unlinkSync(srtPath); } catch (e) {}
          try { fs.unlinkSync(outputPath); } catch (e) {}
        });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(videoPath); } catch (e) {}
        try { fs.unlinkSync(srtPath); } catch (e) {}
        res.status(500).json({ error: err.message });
      })
      .run();
  } catch (err) {
    try { fs.unlinkSync(videoPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

function cutVideo(input, output, start, end) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(start)
      .setDuration(end - start)
      .outputOptions('-c', 'copy')
      .outputOptions('-threads', '1')
      .output(output)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));

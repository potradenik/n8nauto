const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { google } = require('googleapis');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json({ limit: '50mb' })); // JSON от n8n

// Аутентификация Google Drive
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive.readonly']
);
const drive = google.drive({ version: 'v3', auth });

app.get('/', (req, res) => res.json({ status: 'ok' }));

// ─── Универсальный эндпоинт: нарезка + опциональные субтитры ─────
app.post('/cut', async (req, res) => {
  const { fileId, start, end, srt } = req.body;
  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  let outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // 1. Скачиваем видео с Google Диска
    console.log(`Скачиваю ${fileId}...`);
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => { writer.on('finish', resolve); writer.on('error', reject); });

    if (!fs.existsSync(inputPath)) throw new Error('Файл не был создан');
    const stats = fs.statSync(inputPath);
    if (stats.size < 10000) {
      const preview = fs.readFileSync(inputPath, 'utf-8').slice(0, 200);
      throw new Error(`Скачался не видеофайл. Начало: ${preview}`);
    }
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    // 2. Нарезаем клип
    console.log(`Нарезаю ${start}–${end}...`);
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

    // 3. Если передан srt — накладываем субтитры
    if (srt) {
      const srtPath = `/tmp/sub_${Date.now()}.srt`;
      const subsOutputPath = `/tmp/subbed_${Date.now()}.mp4`;
      fs.writeFileSync(srtPath, srt, 'utf-8');
      await new Promise((resolve, reject) => {
        ffmpeg(outputPath)
          .outputOptions('-vf', `subtitles=${srtPath}`)
          .output(subsOutputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      try { fs.unlinkSync(outputPath); } catch (e) {}
      outputPath = subsOutputPath;
      try { fs.unlinkSync(srtPath); } catch (e) {}
    }

    // 4. Отправляем результат
    res.sendFile(outputPath, { absolute: true }, () => {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });
  } catch (err) {
    console.error('Ошибка /cut:', err.message);
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

// ─── Отдельный эндпоинт для вжигания субтитров (JSON) ─────
app.post('/burn-subtitles', (req, res) => {
  const { videoBase64, srt } = req.body;
  if (!videoBase64 || !srt) {
    return res.status(400).json({ error: 'videoBase64 и srt обязательны' });
  }

  const videoPath = `/tmp/video_${Date.now()}.mp4`;
  const srtPath = `/tmp/sub_${Date.now()}.srt`;
  const outputPath = `/tmp/subbed_${Date.now()}.mp4`;

  try {
    const buffer = Buffer.from(videoBase64, 'base64');
    fs.writeFileSync(videoPath, buffer);
    fs.writeFileSync(srtPath, srt, 'utf-8');
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

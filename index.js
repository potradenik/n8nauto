const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { google } = require('googleapis');
const fs = require('fs');
const multer = require('multer');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
// Для запросов /cut и /burn-subtitles (если JSON)
app.use(express.json({ limit: '50mb' }));
// Для /burn-subtitles через FormData
const upload = multer({ dest: '/tmp/' });

// Аутентификация Google Drive
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/drive.readonly']
);
const drive = google.drive({ version: 'v3', auth });

app.get('/', (req, res) => res.json({ status: 'ok' }));

// ─── Нарезка видео ─────────────────────
app.post('/cut', async (req, res) => {
  const { fileId, start, end } = req.body;
  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
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
      response.data.on('error', reject);
    });

    if (!fs.existsSync(inputPath)) {
      throw new Error('Файл не был создан');
    }

    const stats = fs.statSync(inputPath);
    if (stats.size < 10000) {
      const preview = fs.readFileSync(inputPath, 'utf-8').slice(0, 200);
      throw new Error(`Скачался не видеофайл (размер ${stats.size} байт). Начало: ${preview}`);
    }
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    console.log(`Нарезаю ${start}–${end}...`);
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

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

// ─── Вжигание субтитров (принимает файл через FormData) ────
app.post('/burn-subtitles', upload.single('video'), (req, res) => {
  const { srt } = req.body;
  if (!req.file || !srt) {
    return res.status(400).json({ error: 'video (файл) и srt (текст) обязательны' });
  }

  const srtPath = `/tmp/sub_${Date.now()}.srt`;
  const outputPath = `/tmp/subbed_${Date.now()}.mp4`;

  try {
    fs.writeFileSync(srtPath, srt, 'utf-8');
    ffmpeg(req.file.path)
      .outputOptions('-vf', `subtitles=${srtPath}`)
      .output(outputPath)
      .on('end', () => {
        res.sendFile(outputPath, { absolute: true }, () => {
          try { fs.unlinkSync(req.file.path); } catch (e) {}
          try { fs.unlinkSync(srtPath); } catch (e) {}
          try { fs.unlinkSync(outputPath); } catch (e) {}
        });
      })
      .on('error', (err) => {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
        try { fs.unlinkSync(srtPath); } catch (e) {}
        res.status(500).json({ error: err.message });
      })
      .run();
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch (e) {}
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

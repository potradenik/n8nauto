const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const https = require('https');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/cut', (req, res) => {
  const { fileId, start, end } = req.body;

  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  // Используем прямую ссылку с confirm-параметром
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;

  console.log(`Скачиваю: ${downloadUrl}`);

  const file = fs.createWriteStream(inputPath);

  https.get(downloadUrl, (response) => {
    response.pipe(file);

    file.on('finish', () => {
      file.close();

      const stats = fs.statSync(inputPath);
      console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

      if (stats.size < 10000) {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        return res.status(400).json({ error: 'Файл не скачался. Проверьте, что ссылка открыта для всех.' });
      }

      ffmpeg(inputPath)
        .setStartTime(parseFloat(start))
        .setDuration(parseFloat(end) - parseFloat(start))
        .output(outputPath)
        .on('end', () => {
          res.sendFile(outputPath, { absolute: true }, () => {
            try { fs.unlinkSync(inputPath); } catch (e) {}
            try { fs.unlinkSync(outputPath); } catch (e) {}
          });
        })
        .on('error', (err) => {
          try { fs.unlinkSync(inputPath); } catch (e) {}
          res.status(500).json({ error: err.message });
        })
        .run();
    });
  }).on('error', (err) => {
    res.status(500).json({ error: 'Ошибка скачивания: ' + err.message });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API на порту ${PORT}`));

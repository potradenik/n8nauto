const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json({ limit: '200mb' })); // увеличиваем лимит для больших видео

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/cut-base64', (req, res) => {
  const { videoBase64, start, end } = req.body;

  if (!videoBase64 || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'videoBase64, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // Декодируем Base64 в бинарный файл
    const buffer = Buffer.from(videoBase64, 'base64');
    fs.writeFileSync(inputPath, buffer);
    console.log(`Видео получено, размер: ${(buffer.length / 1024 / 1024).toFixed(1)} МБ`);
  } catch (err) {
    return res.status(400).json({ error: 'Ошибка декодирования base64' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API на порту ${PORT}`));

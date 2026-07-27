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
  const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

  console.log(`Скачиваю ${fileId}, режу ${start}-${end}`);

  const file = fs.createWriteStream(inputPath);
  
  https.get(downloadUrl, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      https.get(response.headers.location, (resp) => {
        resp.pipe(file);
        file.on('finish', runFFmpeg);
      });
    } else {
      response.pipe(file);
      file.on('finish', runFFmpeg);
    }

    function runFFmpeg() {
      file.close();
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
          res.status(500).json({ error: err.message });
        })
        .run();
    }
  }).on('error', (err) => {
    res.status(500).json({ error: 'Ошибка скачивания: ' + err.message });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('API на порту', PORT));

const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const multer = require('multer');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const upload = multer({ dest: '/tmp/' });

app.get('/', (req, res) => res.json({ status: 'ok' }));

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
        res.status(500).json({ error: err.message });
      })
      .run();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер на порту ${PORT}`));

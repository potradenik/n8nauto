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

  console.log(`Пытаюсь скачать файл ${fileId}...`);

  // Пробуем три способа скачать файл
  tryDownload(fileId, inputPath)
    .then(() => {
      // ПРОВЕРЯЕМ, ЧТО СКАЧАЛОСЬ
      const stats = fs.statSync(inputPath);
      const firstBytes = fs.readFileSync(inputPath, { encoding: null, start: 0, end: 200 });
      
      console.log(`Размер файла: ${stats.size} байт`);
      console.log(`Первые байты (hex): ${firstBytes.toString('hex').slice(0, 100)}`);
      console.log(`Первые байты (text): ${firstBytes.toString('utf-8').slice(0, 100)}`);

      // Проверяем, не HTML ли это
      if (firstBytes.toString('utf-8').includes('<!DOCTYPE html>') || 
          firstBytes.toString('utf-8').includes('<html')) {
        const html = fs.readFileSync(inputPath, 'utf-8');
        console.error('СКАЧАЛСЯ HTML вместо видео!');
        console.error('HTML:', html.slice(0, 500));
        throw new Error('Google Drive вернул HTML вместо видео. Проверьте доступ к файлу.');
      }

      // Проверяем, не пустой ли файл
      if (stats.size < 1000) {
        throw new Error(`Файл слишком маленький: ${stats.size} байт`);
      }

      console.log('Файл похож на видео, нарезаю...');
      return cutVideo(inputPath, outputPath, start, end);
    })
    .then(() => {
      console.log('Клип готов!');
      res.sendFile(outputPath, { absolute: true }, () => {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        try { fs.unlinkSync(outputPath); } catch (e) {}
      });
    })
    .catch((err) => {
      console.error('ОШИБКА:', err.message);
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      res.status(500).json({ error: err.message });
    });
});

// Три способа скачать файл
async function tryDownload(fileId, dest) {
  // Способ 1: простая ссылка с confirm=t
  try {
    console.log('Способ 1: confirm=t');
    await downloadFile(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`, dest);
    if (fs.statSync(dest).size > 10000) return;
  } catch (e) {
    console.log('Способ 1 не сработал:', e.message);
  }

  // Способ 2: через confirm-код из страницы
  try {
    console.log('Способ 2: ищем confirm-код');
    const confirmCode = await getConfirmCode(fileId);
    if (confirmCode) {
      await downloadFile(`https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmCode}`, dest);
      if (fs.statSync(dest).size > 10000) return;
    }
  } catch (e) {
    console.log('Способ 2 не сработал:', e.message);
  }

  // Способ 3: прямая ссылка drive.google.com/file/d/.../view
  try {
    console.log('Способ 3: прямая ссылка');
    await downloadFile(`https://drive.google.com/file/d/${fileId}/view`, dest);
    if (fs.statSync(dest).size > 10000) return;
  } catch (e) {
    console.log('Способ 3 не сработал:', e.message);
  }

  throw new Error('Ни один способ скачивания не сработал');
}

function getConfirmCode(fileId) {
  return new Promise((resolve, reject) => {
    https.get(`https://drive.google.com/uc?export=download&id=${fileId}`, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const match = html.match(/confirm=([^&"'\s]+)/);
        resolve(match ? match[1] : null);
      });
    }).on('error', reject);
  });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        https.get(response.headers.location, (resp) => {
          resp.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', reject);
  });
}

function cutVideo(input, output, start, end) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .setStartTime(parseFloat(start))
      .setDuration(parseFloat(end) - parseFloat(start))
      .output(output)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API на порту ${PORT}`));

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

  console.log(`Скачиваю файл ${fileId}...`);

  downloadLargeFile(fileId, inputPath)
    .then(() => {
      const stats = fs.statSync(inputPath);
      console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);
      return cutVideo(inputPath, outputPath, start, end);
    })
    .then(() => {
      console.log('Клип готов');
      res.sendFile(outputPath, { absolute: true }, () => {
        try { fs.unlinkSync(inputPath); } catch (e) {}
        try { fs.unlinkSync(outputPath); } catch (e) {}
      });
    })
    .catch((err) => {
      console.error('Ошибка:', err.message);
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
      res.status(500).json({ error: err.message });
    });
});

// Функция для скачивания больших файлов с обходом предупреждения о вирусах
function downloadLargeFile(fileId, dest) {
  return new Promise((resolve, reject) => {
    const baseUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // Первый запрос — получаем куки и confirm-код
    https.get(baseUrl, (response) => {
      let cookies = [];
      let html = '';

      // Собираем куки
      if (response.headers['set-cookie']) {
        cookies = response.headers['set-cookie'];
      }

      response.on('data', (chunk) => {
        html += chunk.toString();
      });

      response.on('end', () => {
        // Ищем confirm-код в HTML
        const confirmMatch = html.match(/confirm=([^&"'\s]+)/);
        
        if (confirmMatch) {
          const confirmCode = confirmMatch[1];
          console.log(`Найден confirm-код: ${confirmCode}`);
          
          // Формируем URL с confirm-кодом
          const downloadUrl = `${baseUrl}&confirm=${confirmCode}`;
          
          // Скачиваем файл с куками
          const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
          
          https.get(downloadUrl, {
            headers: { 'Cookie': cookieString }
          }, (resp) => {
            const file = fs.createWriteStream(dest);
            resp.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', reject);
          }).on('error', reject);
        } else {
          // confirm-код не найден — возможно, файл маленький и отдался сразу
          const file = fs.createWriteStream(dest);
          file.write(html);
          file.end();
          file.on('finish', () => {
            file.close();
            resolve();
          });
          file.on('error', reject);
        }
      });
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

const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const https = require('https');
const { google } = require('googleapis');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));

app.post('/cut', async (req, res) => {
  const { fileId, start, end } = req.body;

  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // Скачиваем с правильной обработкой редиректов и подтверждений
    await downloadFile(fileId, inputPath);
    console.log('Файл скачан успешно');

    // Проверяем размер
    const stats = fs.statSync(inputPath);
    console.log(`Размер: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    if (stats.size < 1000) {
      const content = fs.readFileSync(inputPath, 'utf-8');
      throw new Error('Скачана HTML-страница вместо видео: ' + content.slice(0, 200));
    }

    // Нарезаем
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));
    console.log('Клип готов');

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

// Функция скачивания с поддержкой кук для больших файлов
function downloadFile(fileId, dest) {
  return new Promise((resolve, reject) => {
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    
    // Первый запрос — может вернуть страницу подтверждения
    https.get(downloadUrl, (response) => {
      let cookies = '';
      
      // Собираем куки
      if (response.headers['set-cookie']) {
        cookies = response.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
      }

      // Если редирект — идём по нему
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = response.headers.location;
        const finalHeaders = cookies ? { 'Cookie': cookies } : {};
        
        https.get(redirectUrl, { headers: finalHeaders }, (resp) => {
          pipeToFile(resp, dest, resolve, reject);
        }).on('error', reject);
        return;
      }

      // Проверяем, не HTML ли это
      let data = '';
      response.on('data', chunk => { data += chunk.toString(); });
      response.on('end', () => {
        if (data.includes('confirm=') || data.includes('download_warning')) {
          // Нашли подтверждение — извлекаем confirm-код
          const confirmMatch = data.match(/confirm=([^&"']+)/);
          if (confirmMatch) {
            const confirmCode = confirmMatch[1];
            const confirmedUrl = `${downloadUrl}&confirm=${confirmCode}`;
            
            https.get(confirmedUrl, { headers: { 'Cookie': cookies } }, (resp) => {
              pipeToFile(resp, dest, resolve, reject);
            }).on('error', reject);
          } else {
            reject(new Error('Не удалось извлечь код подтверждения'));
          }
        } else if (data.includes('<!DOCTYPE html>')) {
          reject(new Error('Google Drive вернул HTML вместо видео. Проверьте доступ по ссылке.'));
        } else {
          // Это бинарные данные — сохраняем
          fs.writeFileSync(dest, Buffer.from(data));
          resolve();
        }
      });
    }).on('error', reject);
  });
}

function pipeToFile(response, dest, resolve, reject) {
  const file = fs.createWriteStream(dest);
  response.pipe(file);
  file.on('finish', () => {
    file.close();
    resolve();
  });
  file.on('error', reject);
}

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

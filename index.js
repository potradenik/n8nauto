app.post('/cut', async (req, res) => {
  const { fileId, start, end } = req.body;
  if (!fileId || start === undefined || end === undefined) {
    return res.status(400).json({ error: 'fileId, start, end обязательны' });
  }

  const inputPath = `/tmp/input_${Date.now()}.mp4`;
  const outputPath = `/tmp/clip_${Date.now()}.mp4`;

  try {
    // 1. Скачивание с проверками
    console.log(`Скачиваю ${fileId}...`);
    const response = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const writer = fs.createWriteStream(inputPath);
    response.data.pipe(writer);

    // Ждём завершения записи ИЛИ ошибки
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);   // <-- перехват ошибок потока Google
    });

    // Проверяем, что файл действительно существует
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Файл не был создан: ${inputPath}`);
    }

    const stats = fs.statSync(inputPath);
    console.log(`Размер скачанного файла: ${stats.size} байт`);
    if (stats.size < 10000) {
      // Покажем начало файла, чтобы понять, что скачалось (HTML, JSON и т.д.)
      const preview = fs.readFileSync(inputPath, { encoding: 'utf-8', start: 0, end: 200 });
      console.error('Начало файла:', preview);
      throw new Error(`Скачался не видеофайл, размер ${stats.size} байт`);
    }
    console.log(`Скачано: ${(stats.size / 1024 / 1024).toFixed(1)} МБ`);

    // 2. Нарезка
    console.log(`Нарезаю ${start}–${end}...`);
    await cutVideo(inputPath, outputPath, parseFloat(start), parseFloat(end));

    // 3. Отправка результата
    res.sendFile(outputPath, { absolute: true }, () => {
      try { fs.unlinkSync(inputPath); } catch (e) {}
      try { fs.unlinkSync(outputPath); } catch (e) {}
    });
  } catch (err) {
    console.error('Ошибка /cut:', err.message);
    // Пытаемся подчистить временные файлы
    try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (e) {}
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
    res.status(500).json({ error: err.message });
  }
});

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(bodyParser.json());

let lastGyroData = {}

// Обробка POST-запиту від SensorLogger
app.post('/data', (req, res) => {
  const data = req.body;
  if (Array.isArray(data.payload)) {
    const gyro = data.payload.find(item => item.name === 'gyroscope');
    if (gyro && gyro.values && typeof gyro.values === 'object') {
      // Перетворення значень гіроскопа в масив чисел
      const valuesArr = [
        Number(gyro.values.x),
        Number(gyro.values.y),
        Number(gyro.values.z)
      ];
      if (valuesArr.length === 3 && valuesArr.every(v => typeof v === 'number' && !isNaN(v))) {
        lastGyroData = {
          values: valuesArr,
          timestamp: gyro.time
        };
      }
    }
  }
  console.log('Broadcasting gyroscope data:', lastGyroData);
  res.status(200).send('OK');
});

// WebSocket трансляція кожні 200мс
setInterval(() => {
  if (lastGyroData.timestamp > 0) {
    const message = JSON.stringify({
      name: 'gyroscope',
      values: lastGyroData.values,
      timestamp: lastGyroData.timestamp
    });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}, 200);

// Запуск сервера
server.listen(3000, () => {
  console.log('http/ws сервер працює на порту 3000');
});

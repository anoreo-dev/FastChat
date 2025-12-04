// Web gateway: serves static UI and bridges browser WebSocket <-> TCP broker
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');

const BROKER_HOST = process.env.BROKER_HOST || '127.0.0.1';
const BROKER_PORT = parseInt(process.env.BROKER_PORT || '12345', 10);
const HTTP_PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const fs = require('fs');

// provide group history as JSON array of lines
app.get('/history/group', (req, res) => {
  console.log('[gateway] GET /history/group from', req.ip, '- persistence disabled; returning empty array')
  // persistence disabled by user request — always return empty history
  res.json([]);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// For each browser websocket, create a tcp connection to broker and bridge both ways
wss.on('connection', (ws) => {
  console.log('[gateway] ws connected');
  const broker = new net.Socket();
  let nickname = null;

  broker.connect(BROKER_PORT, BROKER_HOST, () => {
    console.log('[gateway] connected to broker', BROKER_HOST + ':' + BROKER_PORT);
  });

  // accumulate tcp data by lines
  let readbuf = '';
  broker.on('data', (data) => {
    readbuf += data.toString('utf8');
    let idx;
    while ((idx = readbuf.indexOf('\n')) >= 0) {
      const line = readbuf.slice(0, idx).replace(/\r$/, '');
      readbuf = readbuf.slice(idx + 1);
      // forward broker line to browser as JSON
      try {
        ws.send(JSON.stringify({ source: 'broker', line }));
      } catch (e) { /* ignore */ }
    }
  });

  broker.on('close', () => {
    console.log('[gateway] broker connection closed');
    try { ws.send(JSON.stringify({ source: 'gateway', event: 'broker_closed' })); } catch(e){ }
  });
  broker.on('error', (err) => { console.error('[gateway] broker error', err && err.message); });

  ws.on('message', (msg) => {
    // expect JSON messages from browser
    let obj;
    try { obj = JSON.parse(msg.toString()); } catch (e) { console.warn('[gateway] bad json from ws'); return; }

    console.log('[gateway] ws recv from browser', obj && obj.type, obj && obj.nick)

    if (obj.type === 'connect') {
      nickname = obj.nick || ('guest_' + Math.floor(Math.random()*1000));
      const line = `CONNECT|${nickname}\n`;
      console.log('[gateway] -> broker:', line.replace(/\n$/, ''));
      broker.write(line);
    } else if (obj.type === 'publish') {
      // publish: { type:'publish', toType:'USER'|'GROUP', target:'bob', kind:'TEXT'|'FILE', payload:'...' }
      const from = nickname || 'webuser';
      const toType = obj.toType || 'GROUP';
      const target = obj.target || 'main';
      const kind = obj.kind || 'TEXT';
      const payload = obj.payload || '';
      const line = `PUBLISH|${from}|${toType}|${target}|${kind}|${payload}\n`;
      console.log('[gateway] -> broker:', line.replace(/\n$/, ''));
      broker.write(line);
    } else if (obj.type === 'end') {
      const nick = nickname || obj.nick || '';
      const line = `END|${nick}\n`;
      console.log('[gateway] -> broker:', line.replace(/\n$/, ''));
      broker.write(line);
      broker.end();
    }
  });

  // log lines we forward from broker for easier tracing
  // (already forwarded via ws.send in broker.on('data'))
  // but also print here for gateway logs
  // Note: broker.on('data') above accumulates lines and forwards them; keep additional logging there

  ws.on('close', () => {
    console.log('[gateway] ws closed');
    try { broker.end(); } catch(e){}
  });
});

server.listen(HTTP_PORT, () => {
  console.log('[gateway] HTTP+WS server listening on port', HTTP_PORT);
  console.log('[gateway] broker target', BROKER_HOST + ':' + BROKER_PORT);
});

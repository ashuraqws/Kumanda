'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

// Tek .exe (Node SEA) içindeyken sayfalar ve helper.ps1 gömülüdür; PowerShell dosya yolu istediği için geçici klasöre çıkarılır.
let sea = null;
try { const m = require('node:sea'); if (m.isSea()) sea = m; } catch { /* normal Node */ }
function unpackAssets() {
  const dir = path.join(os.tmpdir(), 'Kumanda-app');
  for (const name of JSON.parse(sea.getAsset('files.json', 'utf8'))) {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(sea.getAsset(name)));
  }
  return dir;
}
// .exe konsolsuz (pencere yok) çalışır; kapatma panelden yapılır. Geçersiz stdout yazımı çökertmesin diye log'lar susturulur.
if (sea) for (const k of ['log', 'warn', 'error']) console[k] = () => {};
const ROOT = sea ? unpackAssets() : __dirname;
const openPanel = () => { if (sea && !process.env.NO_OPEN) spawn('cmd', ['/c', 'start', '', `http://localhost:${Number(process.env.PORT) || 3000}/`], { windowsHide: true, stdio: 'ignore' }).unref(); };
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const HELPER_PATH = process.env.HELPER_PATH || path.join(ROOT, 'helper.ps1');
const NO_HELPER = process.env.NO_HELPER === '1';
const TOKEN = crypto.randomBytes(16).toString('hex');
const TOKEN_BUF = Buffer.from(TOKEN);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
const N_UNSUPPORTED = 'Desteklenen bir PDF veya PowerPoint sunumu algılanamadı';
const N_EDIT = "PowerPoint düzenleme görünümünde. Sunumu başlatmak için ▶ Başlat'a basın.";
const N_SAME = 'Sayfa değişmedi (son/ilk sayfa olabilir)';

// ---------- network checks ----------
function ipv4Of(addr) {
  const a = String(addr || '').toLowerCase();
  const v4 = a.startsWith('::ffff:') ? a.slice(7) : a;
  return /^\d+\.\d+\.\d+\.\d+$/.test(v4) ? v4.split('.').map(Number) : null;
}
function isPrivate(addr) {
  const v4 = ipv4Of(addr);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  const a = String(addr || '').toLowerCase();
  if (a === '::1') return true;
  const h = parseInt(a.split(':')[0], 16);
  return Number.isFinite(h) && ((h & 0xfe00) === 0xfc00 || (h & 0xffc0) === 0xfe80);
}
function isLoopback(addr) {
  const v4 = ipv4Of(addr);
  return v4 ? v4[0] === 127 : String(addr) === '::1';
}
function trustedHost(req) {
  let host;
  try { host = new URL('http://' + (req.headers.host || '')).hostname.replace(/^\[|\]$/g, ''); } catch { return false; }
  if (host !== 'localhost' && !net.isIP(host)) return false;
  const origin = req.headers.origin;
  return !origin || origin === 'http://' + req.headers.host;
}
function tokenOk(t) {
  const b = Buffer.from(String(t || ''));
  return b.length === TOKEN_BUF.length && crypto.timingSafeEqual(b, TOKEN_BUF);
}
const fails = new Map(); // ip -> { times:[], until }
function blocked(ip) { const f = fails.get(ip); return !!f && f.until > Date.now(); }
function recordFail(ip) {
  const now = Date.now();
  const f = fails.get(ip) || { times: [], until: 0 };
  f.times = f.times.filter((t) => now - t < 60000);
  f.times.push(now);
  if (f.times.length >= 10) { f.until = now + 60000; f.times = []; }
  fails.set(ip, f);
}

function pairing() {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal).map((a) => a.address);
  return { ips, urls: ips.map((ip) => `http://${ip}:${PORT}/telefon?t=${TOKEN}`) };
}

// ---------- status ----------
const S = { helper: NO_HELPER ? 'off' : 'starting', error: null, active: null, target: null, notice: null, fps: 0, lastFrameAt: 0 };
let noticeTimer = null;
let statusTimer = null, lastStatusAt = 0;

function status() {
  const phones = [...wss.clients].filter((c) => c.isPhone).length;
  return {
    type: 'status', phones, helper: S.helper, error: S.error, active: S.active, target: S.target,
    supported: !!S.target, show: S.target ? S.target.show ?? null : null,
    streaming: wss.clients.size > 0 && Date.now() - S.lastFrameAt < 3000, fps: S.fps, notice: S.notice,
  };
}
function sendAll(obj) {
  const m = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(m);
}
function broadcastStatus() {
  clearTimeout(statusTimer);
  const wait = lastStatusAt + 100 - Date.now();
  if (wait > 0) { statusTimer = setTimeout(broadcastStatus, wait); return; }
  lastStatusAt = Date.now();
  sendAll(status());
}
function notice(text) {
  S.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { S.notice = null; broadcastStatus(); }, 4000);
  broadcastStatus();
}
function setStatus(patch) {
  const key = () => JSON.stringify([S.helper, S.error, S.active, S.target]);
  const before = key();
  Object.assign(S, patch);
  if (before !== key()) broadcastStatus();
}

// ---------- helper (one persistent powershell, strict FIFO) ----------
const H = { proc: null, queue: [], current: null, lastStart: 0, timer: null, fresh: false };

function helperCmd(cmd) {
  if (NO_HELPER) return Promise.resolve({ ok: false, error: 'Yardımcı kapalı.' });
  return new Promise((resolve) => { H.queue.push({ cmd, resolve }); helperNext(); });
}
function helperSpawn() {
  H.lastStart = Date.now();
  const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', HELPER_PATH],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  H.proc = p; H.fresh = true;
  let buf = '';
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => {
    if (p !== H.proc) return;
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/^﻿/, '').trim();
      buf = buf.slice(i + 1);
      if (line) helperLine(line);
    }
  });
  p.stderr.on('data', () => {});
  p.stdin.on('error', () => {});
  p.on('error', () => helperDied(p));
  p.on('exit', () => helperDied(p));
}
function helperNext() {
  if (H.current || !H.queue.length) return;
  if (!H.proc) {
    const wait = H.lastStart + 3000 - Date.now();
    if (wait > 0) { if (!H.timer) H.timer = setTimeout(() => { H.timer = null; helperNext(); }, wait); return; }
    helperSpawn();
  }
  const cur = H.queue.shift();
  H.current = cur;
  const p = H.proc;
  const ms = H.fresh ? 20000 : 5000; // first command also pays PowerShell startup
  H.fresh = false;
  cur.timer = setTimeout(() => { helperDied(p); p.kill(); }, ms);
  p.stdin.write(cur.cmd + '\n');
}
function helperLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const cur = H.current;
  if (!cur || !msg || typeof msg !== 'object') return;
  clearTimeout(cur.timer);
  H.current = null;
  cur.resolve(msg);
  if (S.helper !== 'ok') setStatus({ helper: 'ok', error: null });
  helperNext();
}
function helperDied(p) {
  if (p !== H.proc) return;
  H.proc = null;
  if (H.current) { clearTimeout(H.current.timer); H.current.resolve({ ok: false, error: 'Yardımcı yanıt vermedi.' }); H.current = null; }
  setStatus({ helper: 'error', error: 'Yardımcı yanıt vermedi, yeniden başlatılıyor.', active: null, target: null });
  helperNext();
}

// ---------- detect + capture loops ----------
let lastJpg = null, lastHash = null, lastSentAt = 0;
let capturing = false, running = false, unchanged = false;
const FRAME_MS = 33; // hedef ~30 fps; helper hızı (~30-40 ms/kare) gerçek üst sınırı belirler
let frames = [];
let watch = null; // { hash, at } after next/prev

async function detectLoop() {
  if (!NO_HELPER) {
    const r = await helperCmd('detect');
    if (r && r.ok) setStatus({ active: r.active || null, target: r.target || null, error: r.error || null });
    else if (r && r.error && H.proc) setStatus({ error: String(r.error) });
  }
  setTimeout(detectLoop, wss.clients.size ? 700 : 3000);
}

async function captureOnce() {
  if (capturing || NO_HELPER) return;
  capturing = true;
  try {
    const r = await helperCmd('capture 1280 60');
    if (!r || !r.ok || !r.jpg) return;
    const jpg = Buffer.from(r.jpg, 'base64');
    const hash = crypto.createHash('md5').update(jpg).digest('hex');
    const now = Date.now();
    S.lastFrameAt = now;
    lastJpg = jpg;
    const same = hash === lastHash;
    unchanged = same;
    lastHash = hash;
    if (watch && hash !== watch.hash) watch = null;
    else if (watch && now - watch.at > 1500) { watch = null; notice(N_SAME); }
    if (same && now - lastSentAt < 2000) return;
    lastSentAt = now;
    for (const ws of wss.clients) {
      if (ws.readyState === 1 && ws.bufferedAmount <= 1024 * 1024) ws.send(jpg, { binary: true });
    }
    frames.push(now);
  } catch { /* keep loop alive */ } finally { capturing = false; }
}
function startCapture() {
  if (running) return;
  running = true;
  (function tick() {
    if (!wss.clients.size) { running = false; S.fps = 0; return; }
    const t0 = Date.now();
    // Ekran durağansa 10 fps'e yavaşla: boşuna CPU yakma.
    captureOnce().finally(() => setTimeout(tick, Math.max(unchanged ? 100 : 0, FRAME_MS - (Date.now() - t0))));
  })();
}
setInterval(() => {
  const now = Date.now();
  frames = frames.filter((t) => now - t < 3000);
  const fps = Math.round(frames.length / 3 * 10) / 10;
  if (fps !== S.fps) { S.fps = fps; if (wss.clients.size) broadcastStatus(); }
}, 1000).unref();

// ---------- commands ----------
const KEYS = new Set(['next', 'prev', 'start', 'stop', 'black']);
async function command(type) {
  if (!S.target) return notice(N_UNSUPPORTED);
  if (S.target.kind === 'powerpoint' && S.target.show === false && (type === 'next' || type === 'prev')) return notice(N_EDIT);
  const before = lastHash;
  const r = await helperCmd('key ' + type);
  if (!r.ok) return notice(String(r.error || 'Tuş gönderilemedi.'));
  if (r.warning) notice(String(r.warning));
  if (type === 'next' || type === 'prev') watch = { hash: before, at: Date.now() };
}

// ---------- HTTP ----------
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function serveFile(res, rel) {
  const full = path.resolve(PUBLIC_DIR, '.' + path.sep + rel);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { ok: false });
  let st;
  try { st = await fsp.stat(full); } catch { st = null; }
  if (!st || !st.isFile()) return sendJson(res, 404, { ok: false });
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
}
async function handle(req, res) {
  const ip = req.socket.remoteAddress;
  if (!isPrivate(ip) || !trustedHost(req)) { res.writeHead(403); return res.end('Erişim engellendi.'); }
  let pathname, url;
  try { url = new URL(req.url, 'http://x'); pathname = decodeURIComponent(url.pathname); } catch { return sendJson(res, 400, { ok: false }); }
  const local = isLoopback(ip);
  if (pathname === '/' || pathname.startsWith('/api/')) {
    if (!local) { res.writeHead(403); return res.end('Bu işlem sadece bilgisayardan yapılabilir.'); }
    if (pathname === '/api/quit' && req.method === 'POST') {
      sendJson(res, 200, { ok: true });
      return void setTimeout(() => shutdown(0), 200);
    }
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
    if (pathname === '/') return serveFile(res, 'panel.html');
    if (pathname === '/api/pairing') return sendJson(res, 200, { ok: true, port: PORT, token: TOKEN, ...pairing() });
    if (pathname === '/api/status') return sendJson(res, 200, status());
    if (pathname === '/api/qr.svg') {
      const u = pairing().urls[Number(url.searchParams.get('i'))];
      if (!u) return sendJson(res, 404, { ok: false });
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(await QRCode.toString(u, { type: 'svg', margin: 1 }));
    }
    return sendJson(res, 404, { ok: false });
  }
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false });
  return serveFile(res, pathname === '/telefon' ? 'telefon.html' : pathname.slice(1));
}
const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (res.headersSent) return res.destroy();
    sendJson(res, 500, { ok: false, error: e.message });
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  const ip = req.socket.remoteAddress;
  socket.on('error', () => {});
  let u;
  try { u = new URL(req.url, 'http://x'); } catch { return socket.destroy(); }
  if (!isPrivate(ip) || !trustedHost(req) || u.pathname !== '/ws') return socket.destroy();
  const panel = u.searchParams.get('panel') === '1';
  if (panel && !isLoopback(ip)) return socket.destroy();
  if (!panel && blocked(ip)) { socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (!panel) {
      if (!tokenOk(u.searchParams.get('t'))) { recordFail(ip); return ws.close(4401, 'token'); }
      ws.isPhone = true;
    }
    wss.emit('connection', ws, req);
  });
});
wss.on('connection', (ws) => {
  let hits = [];
  ws.on('error', () => {});
  ws.on('close', () => {
    broadcastStatus();
    if (ws.isPhone) sendAll({ type: 'event', event: 'phone-disconnected', phones: status().phones });
  });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    const now = Date.now();
    hits = hits.filter((t) => now - t < 1000);
    if (hits.length >= 10) return;
    hits.push(now);
    if (msg && KEYS.has(msg.type)) command(msg.type).catch(() => {});
  });
  ws.send(JSON.stringify(status()));
  if (lastJpg) ws.send(lastJpg, { binary: true });
  if (ws.isPhone) sendAll({ type: 'event', event: 'phone-connected', phones: status().phones });
  broadcastStatus();
  startCapture();
});

// ---------- start / stop ----------
function shutdown(code) {
  try { if (H.proc) H.proc.kill(); } catch { /* already gone */ }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (e) => console.error('Hata:', e.message));

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    // .exe'nin penceresi yok: Kumanda büyük olasılıkla zaten açık, mevcut paneli göster.
    if (sea) { openPanel(); process.exit(0); }
    console.error(`\nPort ${PORT} kullanımda. Başka bir uygulamayı kapatın veya PORT değişkeniyle farklı port seçin: set PORT=${PORT + 1} && npm start\n`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '0.0.0.0', () => {
  const { urls } = pairing();
  console.log('\n=== Telefon Kumanda çalışıyor ===');
  console.log(`Bilgisayarda panel:  http://localhost:${PORT}/`);
  console.log('Telefonda açın (aynı Wi-Fi):');
  for (const u of urls) console.log('   ' + u);
  if (urls.length) QRCode.toString(urls[0], { type: 'terminal', small: true }).then((q) => console.log('Telefon kamerasıyla okutun:\n' + q)).catch(() => {});
  else console.log("   (Ağ bağlantısı bulunamadı — Wi-Fi'ye bağlı olduğunuzdan emin olun.)");
  console.log('Kapatmak için bu pencereyi kapatın (veya Ctrl+C)\n');
  // .exe'yi çift tıklayan kişi paneli kendisi açmak zorunda kalmasın (testler NO_OPEN=1 verir).
  openPanel();
  detectLoop();
});

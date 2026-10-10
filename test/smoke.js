'use strict';
// Uçtan uca duman testi: gerçek server.js + sahte helper.ps1. Çalıştırma: npm test
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const HOST = '127.0.0.1';
const procs = new Set();
const ok = (m) => console.log('✓ ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE = `
$jpg = [Convert]::FromBase64String('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=')
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding($false)))
$out.AutoFlush = $true
function J($o) { $out.WriteLine(($o | ConvertTo-Json -Compress -Depth 5)) }
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim() -split '\\s+'
  switch ($p[0]) {
    'detect' {
      if (Test-Path "$dir\\unsupported.flag") {
        J @{ ok = $true; active = @{ title = 'Not'; process = 'notepad'; kind = 'other' }; target = $null }
      } else {
        $t = @{ title = 'Test - PowerPoint'; process = 'POWERPNT'; kind = 'powerpoint'; show = $true }
        J @{ ok = $true; active = $t; target = $t }
      }
    }
    'capture' {
      $n = 0; try { $n = [int](Get-Content "$dir\\counter" -Raw) } catch { $n = 0 }
      $b = New-Object byte[] ($jpg.Length + 4); [Array]::Copy($jpg, $b, $jpg.Length)
      for ($i = 0; $i -lt 4; $i++) { $b[$jpg.Length + $i] = [byte](($n * 7 + $i) % 256) }
      J @{ ok = $true; jpg = [Convert]::ToBase64String($b); w = 1; h = 1 }
    }
    'key' {
      for ($i = 0; $i -lt 20; $i++) { try { [IO.File]::AppendAllText("$dir\\keys.log", $p[1] + [char]10); break } catch { Start-Sleep -Milliseconds 25 } }
      if ($p[1] -ne 'prev') { $n = 0; try { $n = [int](Get-Content "$dir\\counter" -Raw) } catch { $n = 0 }; try { Set-Content "$dir\\counter" ($n + 1) } catch {} }
      J @{ ok = $true; kind = 'powerpoint' }
    }
    default { J @{ ok = $false; error = 'bilinmeyen' } }
  }
}
`;

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.on('error', rej);
    s.listen(0, HOST, () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

function spawnServer(port, extraEnv) {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.output = '';
  proc.stdout.on('data', (d) => { proc.output += d; });
  proc.stderr.on('data', (d) => { proc.output += d; });
  proc.exited = new Promise((r) => proc.on('exit', (c) => { procs.delete(proc); r(c); }));
  procs.add(proc);
  return proc;
}

async function startServer(port, env) {
  const proc = spawnServer(port, env);
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (proc.exitCode !== null) break;
    try { if ((await fetch(`http://${HOST}:${port}/api/pairing`)).ok) return proc; } catch { /* henüz hazır değil */ }
    await sleep(150);
  }
  throw new Error('sunucu başlamadı:\n' + proc.output);
}

const base = (port) => `http://${HOST}:${port}`;
const getJson = async (port, p) => (await fetch(base(port) + p)).json();

// WS istemcisi: tüm mesajları biriktirir, koşul bekler.
function connect(port, query, opts) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${HOST}:${port}/ws?${query}`, opts);
    ws.texts = []; ws.bins = []; ws.waiters = [];
    ws.closeCode = null;
    const poke = () => ws.waiters.slice().forEach((w) => w());
    ws.on('message', (d, isBin) => {
      if (isBin) ws.bins.push(Buffer.from(d));
      else { try { ws.texts.push(JSON.parse(d.toString())); } catch { /* yoksay */ } }
      poke();
    });
    ws.on('close', (c) => { ws.closeCode = c; poke(); });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_q, res) => { ws.statusCode = res.statusCode; reject(Object.assign(new Error('http ' + res.statusCode), { statusCode: res.statusCode })); });
  });
}

// koşul sağlanana dek bekle (olay tabanlı, zaman aşımlı)
function waitFor(ws, fn, ms = 8000, what = 'koşul') {
  return new Promise((res, rej) => {
    const check = () => { const v = fn(); if (v) { cleanup(); res(v); } };
    const t = setTimeout(() => { cleanup(); rej(new Error('zaman aşımı: ' + what)); }, ms);
    const cleanup = () => { clearTimeout(t); ws.waiters = ws.waiters.filter((w) => w !== check); };
    ws.waiters.push(check);
    check();
  });
}
const waitStatus = (ws, pred, ms, what) => waitFor(ws, () => ws.texts.slice().reverse().find((m) => m.type === 'status' && pred(m)), ms, what || 'status');
const waitClose = (ws, ms = 8000) => waitFor(ws, () => ws.closeCode !== null && { code: ws.closeCode }, ms, 'close');
const lastStatus = (ws) => ws.texts.slice().reverse().find((m) => m.type === 'status');

async function badTokenClose(port, tok) {
  const ws = await connect(port, 't=' + tok);
  return (await waitClose(ws)).code;
}

const keysOf = (dir) => { try { return fs.readFileSync(path.join(dir, 'keys.log'), 'utf8').split(/\r?\n/).filter(Boolean); } catch { return []; } };
async function waitKeys(dir, n, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (keysOf(dir).length >= n) return keysOf(dir); await sleep(80); }
  return keysOf(dir);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-smoke-'));
  const helper = path.join(tmp, 'fake-helper.ps1');
  fs.writeFileSync(helper, '﻿' + FAKE.replace(/\n/g, '\r\n'), 'utf8');
  const clients = [];
  const track = (ws) => { clients.push(ws); return ws; };

  try {
    // --- NO_HELPER ---
    {
      const port = await freePort();
      const p = await startServer(port, { NO_HELPER: '1' });
      const ws = track(await connect(port, 't=' + (await getJson(port, '/api/pairing')).token));
      const st = await waitStatus(ws, () => true);
      assert.strictEqual(st.helper, 'off');
      ok('NO_HELPER=1: status.helper "off"');
      ws.close(); p.kill(); await p.exited;
    }

    // --- Ana sunucu ---
    const port = await freePort();
    let server = await startServer(port, { HELPER_PATH: helper });
    assert.match(server.output, /\/telefon\?t=[0-9a-f]{32}/);
    ok('açılışta eşleştirme adresi (token) yazdırıldı');

    const root = await fetch(base(port) + '/');
    assert.strictEqual(root.status, 200);
    assert.match(root.headers.get('content-type') || '', /html/);
    ok('panel / 200 html');

    const pair = await getJson(port, '/api/pairing');
    assert.match(pair.token, /^[0-9a-f]{32}$/);
    assert.ok(pair.urls.length === 0 || pair.urls.every((u) => u.includes('?t=')));
    ok('/api/pairing: 32 hex token, url\'lerde ?t=');
    const oldToken = pair.token;

    if (pair.urls.length) {
      const svg = await (await fetch(base(port) + '/api/qr.svg?i=0')).text();
      assert.ok(svg.includes('<svg'));
      ok('/api/qr.svg döndü');
    } else ok('qr.svg atlandı (ağ adresi yok)');

    // /telefon yalnızca özel IP'lerden; loopback ile de açılabilmeli ya da en az 200/403 dışı olmamalı
    const tel = await fetch(base(port) + '/telefon');
    assert.strictEqual(tel.status, 200);
    ok('/telefon 200');

    assert.strictEqual(await badTokenClose(port, 'yanlis'), 4401);
    ok('yanlış token → close 4401');

    // Telefon
    const ph = track(await connect(port, 't=' + oldToken));
    const st = await waitStatus(ph, (m) => m.supported === true && m.phones === 1, 8000, 'supported+phones:1');
    assert.ok(st);
    const frame = await waitFor(ph, () => ph.bins.find((b) => b[0] === 0xff && b[1] === 0xd8), 8000, 'JPEG kare');
    assert.ok(frame);
    ok('status (supported, phones:1) + JPEG kare (FFD8)');

    await ph.send(JSON.stringify({ type: 'next' }));
    let k = await waitKeys(tmp, 1);
    assert.strictEqual(k[0], 'next');
    ph.send(JSON.stringify({ type: 'prev' }));
    k = await waitKeys(tmp, 2);
    assert.strictEqual(k[1], 'prev', JSON.stringify(k));
    ok('next / prev tuşları iletildi');

    for (const t of ['start', 'stop', 'black']) ph.send(JSON.stringify({ type: t }));
    k = await waitKeys(tmp, 5);
    assert.deepStrictEqual(k.slice(2), ['start', 'stop', 'black']);
    ok('start / stop / black tuşları iletildi');

    // Değişmeyen kare uyarısı: prev kareyi değiştirmez
    await sleep(1000); // start/stop/black kareyi değiştirdi; yeni kare otursun
    ph.texts.length = 0;
    ph.send(JSON.stringify({ type: 'prev' }));
    await waitFor(ph, () => ph.texts.find((m) => m.notice && /Sayfa değişmedi/.test(m.notice)), 8000, 'sayfa değişmedi');
    ok('kare değişmeyince "Sayfa değişmedi" uyarısı');

    // Desteklenmeyen
    fs.writeFileSync(path.join(tmp, 'unsupported.flag'), '1');
    await waitStatus(ph, (m) => m.supported === false, 8000, 'supported:false');
    const before = keysOf(tmp).length;
    ph.texts.length = 0;
    ph.send(JSON.stringify({ type: 'next' }));
    await waitFor(ph, () => ph.texts.find((m) => m.notice && /algılanamadı/.test(m.notice)), 8000, 'algılanamadı');
    await sleep(400);
    assert.strictEqual(keysOf(tmp).length, before);
    ok('desteklenmeyen pencere: supported:false, uyarı, tuş gönderilmedi');
    fs.unlinkSync(path.join(tmp, 'unsupported.flag'));
    await waitStatus(ph, (m) => m.supported === true, 8000, 'supported:true');

    // Panel + ikinci telefon
    const panel = track(await connect(port, 'panel=1'));
    const ph2 = track(await connect(port, 't=' + oldToken));
    await waitStatus(ph2, (m) => m.phones === 2, 8000, 'phones:2');
    await waitFor(panel, () => panel.texts.find((m) => m.type === 'phone-connected' || m.event === 'phone-connected'), 8000, 'phone-connected');
    ok('ikinci istemci phones:2, panel phone-connected aldı');
    ph2.close();
    await waitStatus(ph, (m) => m.phones === 1, 8000, 'phones:1');
    ok('biri kapanınca phones:1');

    // Host spoof
    // fetch/undici özel Host başlığını yok sayar → ham http kullan
    const code = await new Promise((res) => {
      const req = require('node:http').request({ host: HOST, port, path: '/api/pairing', headers: { Host: 'evil.com' } }, (r) => { r.resume(); res(r.statusCode); });
      req.on('error', () => res(0)); req.end();
    });
    assert.strictEqual(code, 403);
    ok('Host: evil.com → 403');

    // kill → istemci close
    server.kill();
    await waitClose(ph);
    await server.exited;
    ok('sunucu kapanınca istemci close aldı');

    // Restart → token değişir
    server = await startServer(port, { HELPER_PATH: helper });
    const pair2 = await getJson(port, '/api/pairing');
    assert.notStrictEqual(pair2.token, oldToken);
    assert.strictEqual(await badTokenClose(port, oldToken), 4401);
    ok('yeniden başlatma: yeni token, eski token 4401');

    // EADDRINUSE
    const dup = spawnServer(port, { HELPER_PATH: helper });
    const dupCode = await Promise.race([dup.exited, sleep(10000).then(() => 'timeout')]);
    if (dupCode === 'timeout') dup.kill();
    assert.notStrictEqual(dupCode, 0);
    assert.notStrictEqual(dupCode, 'timeout');
    assert.match(dup.output, /kullanımda/);
    ok('port doluyken: kod ≠ 0 ve "kullanımda"');

    // Rate limit (sonda: IP'yi kilitler)
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      try { await badTokenClose(port, 'bad' + i); } catch (e) { if (e.statusCode === 429) limited = true; }
    }
    assert.ok(limited, '429 gelmedi');
    ok('çok sayıda yanlış token → 429');

    // quit
    const q = await fetch(base(port) + '/api/quit', { method: 'POST' });
    assert.ok(q.ok);
    const qc = await Promise.race([server.exited, sleep(8000).then(() => 'timeout')]);
    assert.notStrictEqual(qc, 'timeout');
    ok('POST /api/quit süreci kapattı');
  } finally {
    clients.forEach((c) => { try { c.terminate(); } catch { /* */ } });
    procs.forEach((p) => { try { p.kill(); } catch { /* */ } });
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
}

const guard = setTimeout(() => { console.error('✗ genel zaman aşımı'); procs.forEach((p) => p.kill()); process.exit(1); }, 120000);
main().then(() => { clearTimeout(guard); console.log('\nTüm testler geçti.'); process.exit(0); },
  (e) => { clearTimeout(guard); console.error('✗ HATA: ' + (e && e.stack || e)); procs.forEach((p) => p.kill()); process.exit(1); });

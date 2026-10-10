# Kumanda — phone remote for PDF and PowerPoint presentations

**English** · [Türkçe](README.tr.md)

Control the presentation open on your Windows laptop from your phone, over the same Wi-Fi. Scan a QR code on the laptop, and your phone browser shows a **live view of the laptop screen** with big **← Back / Next →** buttons. No phone app to install.

> The app's interface (laptop panel and phone page) is in Turkish for now.

## Features

- QR code pairing; a fresh random token on every start
- Live laptop screen on the phone (~20 fps) with a fullscreen button (⛶)
- Back, Next, ▶ Start, ■ Stop and Black-screen buttons
- Detects the open PowerPoint / Acrobat / browser PDF window automatically
- Local network only; the phone only receives screenshots and can only send 5 key commands
- Nothing to install on the phone; only Node.js on the laptop

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org) 18 or newer (LTS)
- Windows PowerShell 5.1 (included with Windows)
- Laptop and phone on the same Wi-Fi network

## Install and run

```bat
git clone https://github.com/ashuraqws/Kumanda.git
```

```bat
cd Kumanda
```

```bat
npm install
```

```bat
npm start
```

Or double-click **`start.bat`**: it installs missing packages and opens the panel in your browser. If you use a portable bundle that contains `node\node.exe`, you don't need Node.js installed; `start.bat` uses it automatically.

## Usage

1. Open your presentation on the laptop (PowerPoint, Acrobat Reader, or a PDF in a browser) and make it fullscreen.
2. Scan the **QR code** shown in the panel (`http://localhost:3000/`) with your phone camera.
3. The phone shows the live screen and the buttons. Back/Next send keys to the presentation window.
4. The **⛶** button (top right) goes fullscreen. On Android it also tries to rotate to landscape; on iPhone it only hides the top bar and small buttons.

The panel shows the number of connected phones, the active window and the detected presentation.

## Wi-Fi and firewall

- Phone and laptop must be on the **same network**. Guest networks or routers with "AP/client isolation" stop devices from seeing each other.
- Set the laptop's network profile to **Private** (Settings > Network & Internet > Wi-Fi). On a "Public" network the phone cannot connect.
- If Windows Firewall asks on first run, allow **Private networks**.

## Supported programs

| Program | Status |
|---|---|
| **PowerPoint** | Keys are sent in slideshow mode; a warning appears in editing view. ▶ Start sends F5. **Not tested** (not installed on the dev machine). |
| **Acrobat Reader** | Key logic written, **not tested**. |
| **PDF in a browser** (Brave, Edge, Chrome, Firefox, Opera, Vivaldi) | The tab title must contain `.pdf`. Back/Next send Left/Right arrow and move one page. **Tested in Brave**; Edge and Chrome use the same viewer but were not tested separately. |
| SumatraPDF, Foxit, PDF-XChange, Okular, etc. | Detected by process name, **not tested**. |

For browser PDFs it works best with the thumbnail sidebar closed and "fit to page" zoom. On a zoomed-in page the arrows scroll sideways instead of changing the page.

## Permissions

- No separate Windows permission is needed for screen capture.
- To send keys, the presentation window must **not run as administrator** and the screen must **not be locked**.

## Security

- A new random token is generated on every start; old QR codes stop working. Commands are rejected without the token.
- Only private-network addresses are accepted; Host/Origin checks and rate limiting for wrong tokens are in place.
- The panel and `/api/*` are reachable from the laptop only.
- The file system is never exposed to the phone.
- **The phone sees your whole screen**, including notifications and private windows. Don't share the QR code or link, and don't use it with sensitive content open.
- The connection is plain HTTP (unencrypted); use it only on a network you trust.

## Known limitations

- Only the primary monitor is captured.
- The first/last page is unknown; if the page doesn't change you get a "page didn't change (maybe first/last page)" notice.
- About 20 fps (measured average 21.7 fps, ~45 ms per frame; limited by Windows screen capture and JPEG encoding). The frame rate drops on purpose when the screen doesn't change.
- The presentation window is brought to the front when a key is sent.
- Windows only.
- The user interface is Turkish only.

## Settings

Change the port (default 3000):

```bat
set PORT=3100 && npm start
```

```powershell
$env:PORT=3100; npm start
```

## Troubleshooting

- **Phone can't open the page:** check same Wi-Fi, "Private" network profile, firewall permission, and that it isn't a guest network.
- **"Port in use":** close the previous instance or change the port.
- **Keys don't work:** the presentation may run as administrator, the screen may be locked, or you get a "no supported presentation detected" notice (open the PDF/PowerPoint window).
- **"Eşleşme geçersiz" on the phone:** the QR is old; after a server restart scan the new QR from the panel.
- **Too many wrong attempts (429):** wait a minute.

## Tests

```bat
npm test
```

An end-to-end smoke test using a fake helper (QR/token, pairing, wrong token, unsupported window, Host/Origin checks, rate limit, token rotation on restart, port conflict). It does not need PowerPoint and does not send keys to real windows.

## Project layout

| File | Purpose |
|---|---|
| `server.js` | HTTP + WebSocket server, token, QR, commands and frame stream |
| `helper.ps1` | Persistent PowerShell: window detection, screen capture, key sending |
| `public/panel.html` | Laptop panel |
| `public/telefon.html` | Phone page |
| `public/style.css` | Shared styles |
| `start.bat` | One-click start |
| `test/smoke.js` | End-to-end smoke test |

## License

MIT, see [LICENSE](LICENSE).

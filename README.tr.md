# Kumanda — Telefondan Sunum Kontrolü

[English](README.md) · **Türkçe**

Laptoptaki **PDF veya PowerPoint sunumunu aynı Wi-Fi ağındaki telefondan izleyip yönetin.** Laptopta QR kodu telefonla okutursunuz; telefonda laptop ekranının canlı görüntüsü ve büyük **← Geri / İleri →** düğmeleri açılır. Telefona uygulama kurmak gerekmez, tarayıcı yeterli.

## Özellikler

- QR kodla eşleşme; her başlatmada yeni rastgele anahtar (token)
- Telefonda laptop ekranının canlı görüntüsü (~20 fps), tam ekran düğmesi (⛶)
- ← Geri, İleri →, ▶ Başlat, ■ Durdur, siyah ekran düğmeleri
- Açık PowerPoint / Acrobat / tarayıcıdaki PDF penceresini otomatik algılar
- Sadece yerel ağ; telefona yalnızca ekran görüntüsü akar, yalnızca 5 tuş komutu kabul edilir
- Telefona ve laptopa ek program gerekmez (laptopta yalnızca Node.js)

## Gereksinimler

- Windows 10/11
- [Node.js](https://nodejs.org) 18 veya üzeri (LTS), **yalnızca kaynak koddan çalıştırmak veya .exe'yi derlemek için**
- Windows PowerShell 5.1 (Windows ile gelir)
- Laptop ve telefon aynı Wi-Fi ağında

## Hızlı başlangıç (kurulum yok)

1. [Son sürümden](https://github.com/ashuraqws/Kumanda/releases/latest) **Kumanda.exe** dosyasını indirin.
2. Çift tıklayın. Panel tarayıcıda QR koduyla açılır; telefonla okutun.
3. Windows SmartScreen uyarırsa (dosya imzasızdır) **Daha fazla bilgi > Yine de çalıştır** deyin. Güvenlik Duvarı sorarsa **Özel ağlar**'a izin verin.

Node.js veya başka bir şey gerekmez. Konsol penceresi açılmaz: kapatmak için panelde **Uygulamayı kapat** düğmesini kullanın (tekrar çift tıklarsanız yalnızca paneli yeniden açar).

## Kaynak koddan çalıştırma

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



## Kullanım

1. Laptopta sunumunuzu açın (PowerPoint, Acrobat Reader veya tarayıcıda PDF) ve tam ekran yapın.
2. Laptopta açılan panelde (`http://localhost:3000/`) çıkan **QR kodu** telefon kamerasıyla okutun.
3. Telefonda canlı ekran görüntüsü ve düğmeler gelir. İleri / Geri sunum penceresine tuş gönderir.
4. Telefonda sağ üstteki **⛶** düğmesi tam ekran yapar (Android'de yatay çevirmeyi dener; iPhone'da yalnızca üst çubuk ve küçük düğmeler gizlenir).

Panelden bağlı telefon sayısını, aktif pencereyi ve algılanan sunumu görebilirsiniz.

## Wi-Fi ve güvenlik duvarı

- Telefon ve laptop **aynı ağda** olmalı. Misafir ağı veya "AP isolation / istemci yalıtımı" açık ağlarda cihazlar birbirini göremez.
- Laptopun ağ profili **Özel** olmalı (Ayarlar > Ağ ve İnternet > Wi-Fi > ağ özellikleri). "Genel" ağda telefon bağlanamaz.
- İlk çalıştırmada Windows Güvenlik Duvarı sorarsa **Özel ağlar** için izin verin.

## Desteklenen programlar

| Program | Durum |
|---|---|
| **PowerPoint** | Sunum modunda tuş gönderilir; düzenleme görünümünde uyarı çıkar. ▶ Başlat → F5. **Bu bilgisayarda denenemedi.** |
| **Acrobat Reader** | Tuş mantığı yazıldı, **denenemedi**. |
| **Tarayıcıda PDF** (Brave, Edge, Chrome, Firefox, Opera, Vivaldi) | Sekme başlığında `.pdf` geçmeli. İleri/Geri sağ/sol ok gönderir ve bir sayfa geçer. **Brave'de denendi**; Edge ve Chrome aynı görüntüleyiciyi kullanır ama ayrıca denenmedi. |
| SumatraPDF, Foxit, PDF-XChange, Okular vb. | İşlem adıyla algılanır, **denenmedi**. |

Tarayıcı PDF'inde en güvenilir kullanım: soldaki küçük resim panelini kapatın ve "sayfaya sığdır" kullanın. Çok yakınlaştırılmış sayfada oklar sayfayı yana kaydırır.

## İzinler

- Ekran yakalama için ayrı bir Windows izni gerekmez.
- Tuş gönderebilmek için sunum penceresi **yönetici olarak çalışmıyor** olmalı ve ekran **kilitli olmamalı**.

## Güvenlik

- Her başlatmada yeni rastgele anahtar üretilir; eski QR'lar geçersiz olur. Anahtar olmadan komut çalışmaz.
- Sadece özel ağ adreslerinden bağlantı kabul edilir; Host/Origin kontrolü ve hatalı anahtar denemesine hız sınırı vardır.
- Panel ve `/api/*` uçları yalnızca laptoptan erişilebilir.
- Dosya sistemi telefona açılmaz.
- **Telefon tüm ekranı görür:** bildirimler ve gizli pencereler dahil. QR'ı ve bağlantıyı paylaşmayın, gizli içerik açıkken kullanmayın.
- Bağlantı HTTP'dir (şifreli değil); yalnızca güvendiğiniz yerel ağda kullanın.

## Bilinen sınırlamalar

- Yalnızca ana (birincil) monitör yakalanır.
- İlk/son sayfa bilinmez; sayfa değişmezse "Sayfa değişmedi (son/ilk sayfa olabilir)" uyarısı çıkar.
- Kare hızı ~20 fps (ölçüm: ort. 21,7 fps, kare başına ~45 ms; sınırı Windows'taki ekran yakalama ve JPEG kodlama belirler). Ekran değişmiyorsa kare hızı bilerek düşer.
- Tuş gönderilirken sunum penceresi öne getirilir.
- Yalnızca Windows.

## Ayarlar

Port değiştirmek için (varsayılan 3000):

```bat
set PORT=3100 && npm start
```

```powershell
$env:PORT=3100; npm start
```

## Sorun giderme

- **Telefon açılmıyor:** aynı Wi-Fi mi, ağ "Özel" mi, güvenlik duvarı izni verildi mi, misafir ağı değil mi kontrol edin.
- **"Port kullanımda":** önceki örneği kapatın veya portu değiştirin.
- **Tuşlar çalışmıyor:** sunum yönetici olarak açılmış olabilir, ekran kilitli olabilir veya "algılanamadı" uyarısı vardır (PDF/PowerPoint penceresini açın).
- **Telefonda "Eşleşme geçersiz":** QR eskidir; sunucu yeniden başlatıldıysa panelden yeni QR okutun.
- **Çok sayıda hatalı deneme (429):** bir dakika bekleyin.

## Testler

```bat
npm test
```

Sahte bir yardımcı ile sunucuyu uçtan uca sınar (QR/anahtar, eşleşme, yanlış anahtar, desteklenmeyen pencere, Host/Origin kontrolü, hız sınırı, yeniden başlatınca anahtar değişimi, port çakışması). Gerçek PowerPoint gerekmez. Bu testler gerçek pencerelere tuş göndermez.

## Proje yapısı

| Dosya | Görev |
|---|---|
| `server.js` | HTTP + WebSocket sunucusu, token, QR, komut ve kare akışı |
| `helper.ps1` | Kalıcı PowerShell: pencere algılama, ekran yakalama, tuş gönderme |
| `public/panel.html` | Laptop paneli |
| `public/telefon.html` | Telefon sayfası |
| `public/style.css` | Ortak stil |
| `build.js` | Tek dosyalık `dist/Kumanda.exe`'yi üretir (`npm run build`) |
| `test/smoke.js` | Uçtan uca duman testi |

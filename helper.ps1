# Windows helper: one command per stdin line, exactly one compact JSON line per command on stdout.
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
try { [Console]::InputEncoding = $utf8; [Console]::OutputEncoding = $utf8 } catch {}
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8
$stdout = New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8
$stdout.NewLine = "`n"
$stdout.AutoFlush = $true

Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
using System.Drawing; using System.Drawing.Imaging; using System.Drawing.Drawing2D; using System.IO;
public static class W {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr ex);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Title(IntPtr h) { int n = GetWindowTextLength(h); if (n <= 0) return ""; var sb = new StringBuilder(n + 1); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  public static uint Pid(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static IntPtr[] All() { var l = new List<IntPtr>(); EnumWindows((h, x) => { if (IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero); return l.ToArray(); }
  public static bool NoCaption(IntPtr h) { return (GetWindowLong(h, -16) & 0xC00000) != 0xC00000; }
  public static bool CoversScreen(IntPtr h) { RECT r; if (!GetWindowRect(h, out r)) return false; var b = System.Windows.Forms.Screen.FromHandle(h).Bounds; return r.L <= b.Left && r.T <= b.Top && r.R >= b.Right && r.B >= b.Bottom; }
  public static bool Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    // Alt tap only when a plain call is refused (Alt can flash menu bars in Firefox).
    SetForegroundWindow(h); System.Threading.Thread.Sleep(80);
    if (GetForegroundWindow() != h) { keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); SetForegroundWindow(h); System.Threading.Thread.Sleep(80); }
    return GetForegroundWindow() == h;
  }
  // capture state, reused across frames
  static Bitmap full, small; static Graphics gf, gs; static ImageCodecInfo codec; static MemoryStream ms = new MemoryStream();
  public static int Lw, Lh;
  public static string Capture(int maxW, long q) {
    var b = System.Windows.Forms.Screen.PrimaryScreen.Bounds;
    if (full == null || full.Width != b.Width || full.Height != b.Height) {
      if (gf != null) gf.Dispose(); if (full != null) full.Dispose();
      full = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb); gf = Graphics.FromImage(full);
    }
    gf.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size);
    int w = Math.Min(maxW, b.Width), h = Math.Max(1, (int)Math.Round((double)b.Height * w / b.Width));
    Bitmap src = full;
    if (w != b.Width) {
      if (small == null || small.Width != w || small.Height != h) {
        if (gs != null) gs.Dispose(); if (small != null) small.Dispose();
        small = new Bitmap(w, h, PixelFormat.Format24bppRgb); gs = Graphics.FromImage(small);
        gs.InterpolationMode = InterpolationMode.Bilinear; gs.PixelOffsetMode = PixelOffsetMode.Half;
      }
      gs.DrawImage(full, new Rectangle(0, 0, w, h), 0, 0, b.Width, b.Height, GraphicsUnit.Pixel);
      src = small;
    }
    if (codec == null) foreach (var c in ImageCodecInfo.GetImageEncoders()) if (c.MimeType == "image/jpeg") codec = c;
    using (var ep = new EncoderParameters(1)) {
      ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, q);
      ms.SetLength(0); src.Save(ms, codec, ep);
    }
    Lw = w; Lh = h;
    return Convert.ToBase64String(ms.GetBuffer(), 0, (int)ms.Length);
  }
}
'@
[void][W]::SetProcessDPIAware()

$script:last = [IntPtr]::Zero
$browsers = 'msedge','chrome','firefox','brave','opera','vivaldi'
$pdfApps = 'sumatrapdf','foxitreader','foxitpdfreader','pdfxcview','pdfxedit','xodo','okular','evince','pdfxchange'

function Fail([string]$m) { throw (New-Object System.ApplicationException $m) }

# PDF'in içindeki başlık ("Untitled" gibi) sekme adını değiştirebilir; bu yüzden tarayıcının adres çubuğuna da bakılır.
# detect ~700 ms'de bir çalışır, UI Automation sorgusu (~50 ms) 1.5 sn önbelleğe alınır.
$script:urlCache = @{}
function Test-PdfUrl([IntPtr]$h) {
    $c = $script:urlCache[[string]$h]
    if ($c -and ((Get-Date) - $c.at).TotalMilliseconds -lt 1500) { return $c.pdf }
    $pdf = $false
    try {
        $root = [Windows.Automation.AutomationElement]::FromHandle($h)
        $cond = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Edit)
        foreach ($e in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $cond)) {
            $v = ($e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)).Current.Value
            if ($v -match '^[a-z-]+://[^?#]*\.pdf([?#]|$)') { $pdf = $true; break }
        }
    } catch { }
    $script:urlCache[[string]$h] = @{ at = Get-Date; pdf = $pdf }
    return $pdf
}

function Info([IntPtr]$h) {
    $title = [W]::Title($h)
    $proc = ''
    try { $proc = [System.Diagnostics.Process]::GetProcessById([int][W]::Pid($h)).ProcessName } catch {}
    $p = $proc.ToLowerInvariant(); $t = $title.ToLowerInvariant()
    $kind = 'other'
    if ($p -eq 'powerpnt') { $kind = 'powerpoint' }
    elseif ($p -eq 'acrord32' -or $p -eq 'acrobat') { $kind = 'acrobat' }
    elseif ($browsers -contains $p) { if ($t.Contains('.pdf') -or (Test-PdfUrl $h)) { $kind = 'pdf-browser' } }
    # Only known viewers: a ".pdf" in any other window's title (chat, editor, notes) must never receive keys.
    elseif ($pdfApps -contains $p -or $p -like 'pdf-xchange*') { $kind = 'pdf-other' }
    [pscustomobject]@{ h = $h; title = $title; process = $proc; kind = $kind }
}

function Short($i) { if ($i) { [ordered]@{ title = $i.title; process = $i.process; kind = $i.kind } } else { $null } }

function Get-Target {
    $fg = [W]::GetForegroundWindow()
    $act = if ($fg -ne [IntPtr]::Zero) { Info $fg } else { $null }
    $tgt = $null
    if ($act -and $act.kind -ne 'other') { $tgt = $act }
    elseif ($script:last -ne [IntPtr]::Zero -and [W]::IsWindow($script:last) -and [W]::IsWindowVisible($script:last)) {
        $i = Info $script:last
        if ($i.kind -ne 'other') { $tgt = $i }
    }
    if (-not $tgt) {
        foreach ($h in [W]::All()) {
            if ([W]::Title($h) -eq '') { continue }
            $i = Info $h
            if ($i.kind -ne 'other') { $tgt = $i; break }
        }
    }
    $show = $null
    if ($tgt) {
        $script:last = $tgt.h
        if ($tgt.kind -eq 'powerpoint') {
            $show = [bool]($tgt.title -match 'PowerPoint Slide Show|PowerPoint Slayt Gösterisi|Slide Show -|Slayt Gösterisi' -or ([W]::NoCaption($tgt.h) -and [W]::CoversScreen($tgt.h)))
        }
    }
    return $act, $tgt, $show
}

function Do-Detect {
    $act, $tgt, $show = Get-Target
    $t = $null
    if ($tgt) { $t = Short $tgt; $t['show'] = $show }
    [ordered]@{ ok = $true; active = (Short $act); target = $t; error = $null }
}

function Do-Key([string]$k) {
    $map = @{ next = '{PGDN}'; prev = '{PGUP}'; start = '{F5}'; stop = '{ESC}'; black = 'b' }
    if (-not $map.ContainsKey($k)) { Fail 'Bilinmeyen tuş' }
    $act, $tgt, $show = Get-Target
    if (-not $tgt) { Fail 'Desteklenen bir PDF veya PowerPoint sunumu algılanamadı' }
    if (($k -eq 'start' -or $k -eq 'black') -and $tgt.kind -ne 'powerpoint') { Fail 'Başlat sadece PowerPoint için' }
    if (-not [W]::Focus($tgt.h)) { Fail 'Pencere öne getirilemedi' }
    $keys = $map[$k]
    # Browser PDF viewers: PageDown only scrolls a screenful (or the thumbnail list); arrows jump exactly one page (verified in Brave).
    if ($tgt.kind -eq 'pdf-browser') { if ($k -eq 'next') { $keys = '{RIGHT}' } elseif ($k -eq 'prev') { $keys = '{LEFT}' } }
    try { [System.Windows.Forms.SendKeys]::SendWait($keys) }
    catch { Fail 'Tuş gönderilemedi: ekran kilitli olabilir veya sunum programı yönetici olarak çalışıyor' }
    $warn = $null
    if ($tgt.kind -eq 'powerpoint' -and $show -eq $false -and ($k -eq 'next' -or $k -eq 'prev')) { $warn = 'PowerPoint düzenleme görünümünde' }
    [ordered]@{ ok = $true; kind = $tgt.kind; warning = $warn; error = $null }
}

function Do-Capture([string]$w, [string]$q) {
    $mw = 0; $qq = 0
    if (-not [int]::TryParse($w, [ref]$mw) -or $mw -lt 16) { $mw = 1280 }
    if (-not [int]::TryParse($q, [ref]$qq)) { $qq = 60 }
    $qq = [Math]::Max(1, [Math]::Min(100, $qq))
    $b64 = [W]::Capture($mw, [long]$qq)
    [ordered]@{ ok = $true; jpg = $b64; w = [W]::Lw; h = [W]::Lh; error = $null }
}

while ($null -ne ($line = $stdin.ReadLine())) {
    $line = $line.Trim()
    if ($line -eq '') { continue }
    $p = $line -split '\s+'
    try {
        switch ($p[0].ToLowerInvariant()) {
            'detect'  { $r = Do-Detect }
            'capture' { $r = Do-Capture $p[1] $p[2] }
            'key'     { $r = Do-Key ([string]$p[1]).ToLowerInvariant() }
            default   { $r = [ordered]@{ ok = $false; error = 'Bilinmeyen komut' } }
        }
    } catch {
        $r = [ordered]@{ ok = $false; error = [string]$_.Exception.Message }
    }
    $stdout.WriteLine(($r | ConvertTo-Json -Compress -Depth 4))
}

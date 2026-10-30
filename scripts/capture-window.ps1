param(
  [Parameter(Mandatory = $true)]
  [string]$WindowTitleRegex,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

Add-Type -AssemblyName System.Drawing

if (-not ('NoemaNativeWindowCapture' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NoemaNativeWindowCapture
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool IsHungAppWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@
}

[void][NoemaNativeWindowCapture]::SetProcessDPIAware()
$window = Get-Process -ErrorAction Stop |
  Where-Object {
    $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $WindowTitleRegex
  } |
  Select-Object -First 1

if (-not $window) {
  throw "No visible window matched title pattern: $WindowTitleRegex"
}
if ([NoemaNativeWindowCapture]::IsHungAppWindow($window.MainWindowHandle)) {
  throw "Window is not responding (PID $($window.Id)); inspect renderer-health.jsonl and Windows Application events."
}

$rect = New-Object NoemaNativeWindowCapture+RECT
if (-not [NoemaNativeWindowCapture]::GetWindowRect($window.MainWindowHandle, [ref]$rect)) {
  throw "Could not read window bounds for PID $($window.Id)."
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) {
  throw "Window has invalid bounds: ${width}x${height}."
}

$destination = [System.IO.Path]::GetFullPath($OutputPath)
$destinationDirectory = [System.IO.Path]::GetDirectoryName($destination)
[System.IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null

$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$captureMethod = 'PrintWindow'
try {
  $hdc = $graphics.GetHdc()
  try {
    $captured = [NoemaNativeWindowCapture]::PrintWindow(
      $window.MainWindowHandle,
      $hdc,
      2
    )
  } finally {
    $graphics.ReleaseHdc($hdc)
  }

  if (-not $captured) {
    $captureMethod = 'CopyFromScreen'
    $graphics.CopyFromScreen(
      $rect.Left,
      $rect.Top,
      0,
      0,
      $bitmap.Size,
      [System.Drawing.CopyPixelOperation]::SourceCopy
    )
  }

  $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

$file = Get-Item -LiteralPath $destination
[pscustomobject]@{
  ProcessId = $window.Id
  WindowTitle = $window.MainWindowTitle
  CaptureMethod = $captureMethod
  FullName = $file.FullName
  Length = $file.Length
  LastWriteTime = $file.LastWriteTime
}

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AssetsDir = Join-Path $ProjectRoot "assets"
$IconPath = Join-Path $AssetsDir "dashboard-icon.ico"
$PreviewPath = Join-Path $AssetsDir "dashboard-icon-256.png"

New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null

Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-IconBitmap {
  param([int]$Size)

  $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $pad = $Size * 0.075
  $body = New-RoundedRectPath -X $pad -Y $pad -Width ($Size - $pad * 2) -Height ($Size - $pad * 2) -Radius ($Size * 0.24)
  $shadow = New-RoundedRectPath -X ($pad + $Size * 0.02) -Y ($pad + $Size * 0.035) -Width ($Size - $pad * 2) -Height ($Size - $pad * 2) -Radius ($Size * 0.24)

  $shadowBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(42, 18, 45, 72))
  $graphics.FillPath($shadowBrush, $shadow)
  $shadowBrush.Dispose()
  $shadow.Dispose()

  $rect = [System.Drawing.RectangleF]::new($pad, $pad, $Size - $pad * 2, $Size - $pad * 2)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 34, 111, 232),
    [System.Drawing.Color]::FromArgb(255, 16, 196, 164),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
  )
  $graphics.FillPath($gradient, $body)
  $gradient.Dispose()

  $shinePath = New-RoundedRectPath -X ($Size * 0.16) -Y ($Size * 0.14) -Width ($Size * 0.68) -Height ($Size * 0.30) -Radius ($Size * 0.15)
  $shineBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(45, 255, 255, 255))
  $graphics.FillPath($shineBrush, $shinePath)
  $shineBrush.Dispose()
  $shinePath.Dispose()

  $cardPath = New-RoundedRectPath -X ($Size * 0.22) -Y ($Size * 0.30) -Width ($Size * 0.56) -Height ($Size * 0.44) -Radius ($Size * 0.075)
  $cardBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(238, 255, 255, 255))
  $graphics.FillPath($cardBrush, $cardPath)
  $cardBrush.Dispose()

  $linePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(54, 23, 105, 224), [Math]::Max(1.0, $Size * 0.012))
  $graphics.DrawLine($linePen, $Size * 0.29, $Size * 0.47, $Size * 0.71, $Size * 0.47)
  $graphics.DrawLine($linePen, $Size * 0.29, $Size * 0.60, $Size * 0.71, $Size * 0.60)
  $linePen.Dispose()

  $barBlue = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 23, 105, 224))
  $barCyan = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 20, 184, 166))
  $barNavy = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 23, 32, 51))
  $barRadius = $Size * 0.025
  $barSpecs = @(
    @{ X = 0.31; Y = 0.56; W = 0.075; H = 0.12; Brush = $barBlue },
    @{ X = 0.43; Y = 0.50; W = 0.075; H = 0.18; Brush = $barCyan },
    @{ X = 0.55; Y = 0.42; W = 0.075; H = 0.26; Brush = $barNavy }
  )

  foreach ($bar in $barSpecs) {
    $barPath = New-RoundedRectPath -X ($Size * $bar.X) -Y ($Size * $bar.Y) -Width ($Size * $bar.W) -Height ($Size * $bar.H) -Radius $barRadius
    $graphics.FillPath($bar.Brush, $barPath)
    $barPath.Dispose()
  }

  $barBlue.Dispose()
  $barCyan.Dispose()
  $barNavy.Dispose()
  $cardPath.Dispose()

  $badgeBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 236, 253, 245))
  $badgeOutline = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(185, 255, 255, 255), [Math]::Max(1.0, $Size * 0.012))
  $badgeRect = [System.Drawing.RectangleF]::new($Size * 0.60, $Size * 0.19, $Size * 0.20, $Size * 0.20)
  $graphics.FillEllipse($badgeBrush, $badgeRect)
  $graphics.DrawEllipse($badgeOutline, $badgeRect)
  $badgeBrush.Dispose()
  $badgeOutline.Dispose()

  $checkPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 10, 143, 90), [Math]::Max(2.0, $Size * 0.032))
  $checkPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $checkPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $graphics.DrawLines($checkPen, [System.Drawing.PointF[]]@(
    [System.Drawing.PointF]::new($Size * 0.645, $Size * 0.29),
    [System.Drawing.PointF]::new($Size * 0.685, $Size * 0.33),
    [System.Drawing.PointF]::new($Size * 0.755, $Size * 0.245)
  ))
  $checkPen.Dispose()

  $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, 255, 255, 255), [Math]::Max(1.0, $Size * 0.014))
  $graphics.DrawPath($borderPen, $body)
  $borderPen.Dispose()
  $body.Dispose()
  $graphics.Dispose()

  return $bitmap
}

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$entries = @()

foreach ($size in $sizes) {
  $bitmap = New-IconBitmap -Size $size
  $stream = [System.IO.MemoryStream]::new()
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  if ($size -eq 256) {
    [System.IO.File]::WriteAllBytes($PreviewPath, $stream.ToArray())
  }
  $entries += [pscustomobject]@{
    Size = $size
    Bytes = $stream.ToArray()
  }
  $stream.Dispose()
  $bitmap.Dispose()
}

$file = [System.IO.File]::Open($IconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$writer = [System.IO.BinaryWriter]::new($file)

try {
  $writer.Write([uint16]0)
  $writer.Write([uint16]1)
  $writer.Write([uint16]$entries.Count)

  $offset = 6 + (16 * $entries.Count)
  foreach ($entry in $entries) {
    $writer.Write([byte]$(if ($entry.Size -ge 256) { 0 } else { $entry.Size }))
    $writer.Write([byte]$(if ($entry.Size -ge 256) { 0 } else { $entry.Size }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$entry.Bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $entry.Bytes.Length
  }

  foreach ($entry in $entries) {
    $writer.Write($entry.Bytes)
  }
} finally {
  $writer.Dispose()
  $file.Dispose()
}

[pscustomobject]@{
  Icon = $IconPath
  Preview = $PreviewPath
  Sizes = $sizes -join ", "
}

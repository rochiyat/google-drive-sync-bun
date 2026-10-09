Add-Type -AssemblyName System.Drawing
$rootDir = Split-Path -Parent $PSScriptRoot
$assetsDir = Join-Path $rootDir "assets"
if (-not (Test-Path $assetsDir)) {
    New-Item -ItemType Directory -Path $assetsDir | Out-Null
}

$size = 256
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Background rounded rect
$brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(56, 189, 248))
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 44
$d = $r * 2
$rect = New-Object System.Drawing.Rectangle(12, 12, ($size - 24), ($size - 24))
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
$path.CloseFigure()
$g.FillPath($brush, $path)

# Draw Cloud and Arrow in white
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 16)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

# Cloud curves
$g.DrawArc($pen, 60, 115, 60, 60, 90, 180)
$g.DrawArc($pen, 85, 75, 85, 85, 170, 160)
$g.DrawArc($pen, 140, 105, 60, 60, 270, 150)
$g.DrawLine($pen, 90, 175, 170, 175)

# Sync arrow down
$g.DrawLine($pen, 128, 110, 128, 170)
$g.DrawLine($pen, 106, 148, 128, 170)
$g.DrawLine($pen, 150, 148, 128, 170)

$g.Dispose()

$pngPath = Join-Path $assetsDir "icon.png"
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Convert PNG to Windows ICO format
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)

$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # Type (1 = ICO)
$bw.Write([UInt16]1) # Count (1 image)

$bw.Write([Byte]0)   # Width (0 = 256)
$bw.Write([Byte]0)   # Height (0 = 256)
$bw.Write([Byte]0)   # Colors
$bw.Write([Byte]0)   # Reserved
$bw.Write([UInt16]1) # Planes
$bw.Write([UInt16]32)# BPP
$bw.Write([UInt32]$pngBytes.Length) # Image size
$bw.Write([UInt32]22)# Offset (22)

$bw.Write($pngBytes)
$bw.Flush()

$icoPath = Join-Path $assetsDir "icon.ico"
[System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())

$bw.Close()
$ms.Close()
$bmp.Dispose()

Write-Output "Successfully generated: $pngPath and $icoPath"

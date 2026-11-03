#!/usr/bin/env bash
# Converts the Playwright recordings in docs/media/raw into README-ready MP4 + GIF.
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=docs/media/raw
OUT=docs/media
for webm in "$RAW"/demo-*.webm; do
  name=$(basename "$webm" .webm)
  # Trim the blank first frames before the page paints.
  ffmpeg -y -loglevel error -ss 0.4 -i "$webm" -c:v libx264 -preset slow -crf 22 -pix_fmt yuv420p -movflags +faststart -an "$OUT/$name.mp4"
  ffmpeg -y -loglevel error -ss 0.4 -i "$webm" \
    -vf "fps=14,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
    "$OUT/$name.gif"
  echo "built $OUT/$name.mp4 and $OUT/$name.gif"
done

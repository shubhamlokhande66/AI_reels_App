#!/bin/sh
# Two test clips for the keyframe check: a dark frame with one bright bar in the middle (its centre, size, angle and
# brightness are easy to measure in a rendered frame).
cd "$(dirname "$0")" && mkdir -p out
for c in white:a yellow:b; do col=${c%%:*}; n=${c##*:}
  ffmpeg -loglevel error -y -f lavfi -i "color=c=0x202020:s=720x1280:r=30:d=10" -vf "drawbox=x=240:y=580:w=240:h=120:color=$col:t=fill,noise=alls=3:allf=t" \
    -c:v libvpx-vp9 -b:v 2M -pix_fmt yuv420p "out/bar_$n.webm"; done

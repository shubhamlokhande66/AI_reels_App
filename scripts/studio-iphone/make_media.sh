#!/bin/sh
# iPhone-style test files for Fast Studio (needs ffmpeg with libx264/libx265 and the reference Reels of
# ../studio-style/make_refs.py, which also has the song). Writes media/.
set -e
cd "$(dirname "$0")"; mkdir -p media; cd media
S=../../studio-style/out; q="-hide_banner -loglevel error -y"
[ -f $S/fast_flash.webm ] || (cd ../../studio-style && python3 make_refs.py)
ffmpeg $q -i $S/fast_flash.webm -vn -c:a pcm_s16le song.wav
# what an iPhone records by default: HEVC 10-bit HLG, stored landscape with a rotation to portrait, AAC, QuickTime .MOV
ffmpeg $q -i $S/fast_flash.webm -t 12 -vf "scale=1080:1920,transpose=2,format=yuv420p10le" -c:v libx265 -x265-params log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc -tag:v hvc1 -r 30 -c:a aac -ar 44100 _a.MOV
ffmpeg $q -display_rotation:v:0 -90 -i _a.MOV -c copy -tag:v hvc1 clipA_hevc10_rot.MOV && rm _a.MOV
# "Most Compatible": H.264 High
ffmpeg $q -i $S/calm_dissolve.webm -t 5 -vf "scale=1080:1920" -c:v libx264 -profile:v high -pix_fmt yuv420p -c:a aac x_high.mp4
ffmpeg $q -i $S/calm_dissolve.webm -t 5 -vf "scale=1080:1920" -c:v libx264 -profile:v main -pix_fmt yuv420p -c:a aac x_main.MOV
ffmpeg $q -i $S/whip_zoom.webm -t 10 -vf "scale=1920:1080" -c:v libx265 -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p -c:a aac clipC_hevc8.mp4
# songs as an iPhone has them, and a video used as the music (a saved Reel / screen recording)
ffmpeg $q -i song.wav -c:a aac -b:a 256k song_aac.m4a
ffmpeg $q -i song.wav -c:a alac song_alac.m4a
ffmpeg $q -i song.wav -c:a libmp3lame -b:a 192k song.mp3
ffmpeg $q -i $S/mono_fade.webm -i song.wav -map 0:v -map 1:a -vf "scale=720:1280" -c:v libx265 -x265-params log-level=error -tag:v hvc1 -pix_fmt yuv420p -c:a aac -ar 48000 -shortest music_video.MOV
ls

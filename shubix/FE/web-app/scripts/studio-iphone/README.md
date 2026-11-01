# Fast Studio on an iPhone: the test

Safari's engine (WebKitGTK's MiniBrowser, driven over WebDriver) with an iPhone's media rules switched on, iPhone files,
the whole flow: song, clips, preview, export, and the exported file read back.

```sh
sudo apt-get install webkit2gtk-driver gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav xvfb
sh make_media.sh                                   # iPhone-style files into media/
xvfb-run -a WebKitWebDriver --port=4444 &          # the driver, on a virtual screen
# iPhone (iOS 16.4-18): videos load only their metadata until played, sound needs a tap, no WebCodecs audio
export WK_FEATURES='-MediaDataLoadsAutomatically,+RequiresUserGestureToLoadVideo,+RequiresUserGestureForAudioPlayback,+InlineMediaPlaybackRequiresPlaysInlineAttribute,-WebCodecsAudio'
EMU_IOS_AUDIO=1 SCENES=1 MUSIC=music_video.MOV,song_aac.m4a VIDS=clipA_hevc10_rot.MOV,x_high.mp4,clipC_hevc8.mp4 node t_iphone.cjs
```

- `EMU_IOS_AUDIO=1` makes the page's audio decoder refuse QuickTime files, as iPhone Safari's does (Linux's decodes them).
- Leave out `-WebCodecsAudio` for iOS 26 (it has WebCodecs audio). `ENGINE=chromium` runs the same test in Chromium
  (Playwright's Chromium has no H.264/HEVC/AAC: use .webm clips and an .mp3 there).
- Linux WebKit cannot play an H.264 .MOV that carries a rotation (a GStreamer limit, not Safari's): use `x_high.mp4`.
- It is still not an iPhone: hardware decoders, memory limits and the share sheet are only checked on a real phone.

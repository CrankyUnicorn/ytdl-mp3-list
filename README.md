# 🎵 YouTube Music List Downloader (Electron App)
    
Forked from YouTube Music Downloader by Veljko Vuckovic
Fully open source desktop app for downloading audio (MP3 or WebM) or lists of audio from Youtube Music.


## 🚀 Features

- 🎧 **Download high-quality audio** from YouTube videos
- 🎵 **Choose format**: MP3 (with conversion) or WebM (original audio)
- 📁 **Set and remember your download folder** across sessions
- 📊 **Download progress bar** for real-time feedback
- 💾 **Locally stores preferences** (no cloud dependencies)
- 💡 Simple, clean, and dark-themed interface
- ✅ Fully self-contained `.exe` build (no Python or FFmpeg install required)


### 🧩 What This App Really Is

This app is **not a breakthrough tool**, nor does it use any advanced techniques, YouTube APIs, or backend scraping.  
It's simply a **clean, user-friendly wrapper** for:

- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) – For downloading audio streams  
- [`ffmpeg`](https://ffmpeg.org/) – For optional MP3 conversion

The app provides a lightweight GUI over existing, open-source command-line tools.  
No hidden logic. No data collection. No manipulation of YouTube systems.


## 📦 Installation (from Source)

### Prerequisites for installation from source

1. Node.js v20.10.0 https://nodejs.org/en/download
2. Python v3.11 https://www.python.org/downloads/

You may also NVM or other envirenment managers for both Nodejs an Python.
Just don't forget to set up the node version to be used.

(i provided versions so exact environment as development can be reproduced)

### 1. Clone the repo

### 2. Install dependencies
```bash
mkdir bin
mkdir temp
npm install
```

### 3. Download Required Binaries

#### ✅ `ffmpeg

#### ✅ `yt-dlp  

- Place both into the `/bin/` of the project folder

### 4. Run the app in development
```bash
npm start
```

## 💼 Packaging Notes
- Uses `electron-builder` for cross-platform packaging
- `extraResources` includes `yt-dlp.exe` and `ffmpeg.exe`
- Settings are stored in Electron's `app.getPath('userData')`


## ⚠️ Disclaimer

This application is provided for **personal and educational use only**. I built it to practice coding skills, electron framework app creation and working with audio files.

Downloading videos from YouTube or any other platform **may violate their Terms of Service**. It is the **user's responsibility** to ensure they are authorized to download and use any content.

> The developer of this app does not condone piracy or copyright infringement and takes no responsibility for how this tool is used.


## 📄 License

[MIT License](./LICENSE)


## 👨‍💻 Author

**CrankyUnicorn**  
MIT Licensed — open to contributions, forks, or improvements!


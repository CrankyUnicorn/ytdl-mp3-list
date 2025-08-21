// main.js
const NodeID3 = require('node-id3');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { writeFile, readFile } = require('node:fs/promises');
const path = require('path');
const fs = require('fs');
const YtDlpWrap = require('yt-dlp-wrap').default;
const _ = require('lodash');

const ytDlpWrap = new YtDlpWrap();

let selectedDownloadFolder = null;
let urlQueue = [];

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const youtubeProfile = 'chrome'; // or firefox etc

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Set ffmpeg path depending on environment
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'ffmpeg')
  : path.join(__dirname, 'bin', 'ffmpeg')
;

function createWindow() {
  const win = new BrowserWindow({
    width: 700,
    height: 800,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
}

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath);
      const settings = JSON.parse(data);
      selectedDownloadFolder = settings.downloadFolder || null;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

function saveSettings() {
  try {
    const settings = { downloadFolder: selectedDownloadFolder };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

function cleanTempFolder() {
  const tempDir = path.join(__dirname, 'temp');

  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(file => {
      const filePath = path.join(tempDir, file);
      try {
        fs.unlinkSync(filePath);
        console.log(`🧹 Deleted: ${filePath}`);
      } catch (err) {
        console.error(`Error deleting ${filePath}:`, err);
      }
    });
  } else {
    fs.mkdirSync(tempDir, { recursive: true }); // Create if missing
  }
}

async function fetchImageBuffer(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function appendImageToMp3(mp3Path, imageUrl, outputPath, details = {}) {
  try {
    console.log("Fetching album art...");
    const imageBuffer = await fetchImageBuffer(imageUrl);

    console.log("Reading mp3 file...");
    const mp3Buffer = await readFile(mp3Path);

    const tags = {
      title: details.title || '',
      artist: details.artist || '',
      album: details.album || '',
      APIC: {
        mime: 'image/jpeg', // or image/png depending on your image
        type: {
          id: 3,
          name: 'front cover'
        },
        description: 'Album art',
        imageBuffer: imageBuffer
      }
    };

    console.log("Writing tags...");
    // Write tags returns the updated buffer
    const taggedBuffer = NodeID3.update(tags, mp3Buffer);

    if (!taggedBuffer) throw new Error("Failed to write ID3 tags");

    console.log("Saving new mp3...");
    await writeFile(outputPath, taggedBuffer);

    console.log(`🖼️ Album art added and saved as ${outputPath}`);
  } catch (error) {
    console.error("⁉️ Error adding album art:", error);
  }
}

app.whenReady().then(() => {
  loadSettings();

  try {
    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp')
      : path.join(__dirname, 'bin', 'yt-dlp');

    ytDlpWrap.setBinaryPath(binaryPath);

  } catch (err) {
    console.error('Failed to set yt-dlp binary path:', err);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-download-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Default Download Folder',
    properties: ['openDirectory']
  });

  if (!canceled && filePaths.length > 0) {
    selectedDownloadFolder = filePaths[0];
    saveSettings();
    return selectedDownloadFolder;
  }

  return null;
});

ipcMain.handle('get-saved-folder', () => {
  return selectedDownloadFolder;
});

async function downloadSong({event, url, format}) {
  return new Promise(async (resolve, reject) => {
    const ytDlpWrap2 = new YtDlpWrap();

    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, 'yt-dlp')
      : path.join(__dirname, 'bin', 'yt-dlp');

    ytDlpWrap2.setBinaryPath(binaryPath);

    let finished = false;

    const cleanup = () => {
      download.removeListener('close', onClose);
      clearTimeout(timer);
    };

    const onClose = () => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve('closed');
      }
    };

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        cleanup();
        resolve('timeout');
      }
    }, 2*60*1000);

    const match = url.match(/v=([^&]+)/);
    const videoId = match ? match[1] : null;
    const sanitizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

    let details = {};
    let fileName = 'audio_' + Date.now();
    let thumbnailUrl;

    try {
      const timeout = new Promise(resolve =>
        setTimeout(() => resolve(null), 0.5*60*1000)
      );

      const promise = ytDlpWrap.execPromise([
        "--cookies-from-browser", youtubeProfile,
        "-f", "bestvideo[height<=144]", // pick a tiny format
        "--skip-download",
        "--print-json",
        sanitizedUrl
      ]);

      let count = 1;
      while (count < 4){
        try {
          // console.log('Fetching youtube track info. Count: ', count);
          const infoRaw = await Promise.race([promise, timeout]);
          const info = JSON.parse(infoRaw);

          if (info) {
            // console.log("Track info:", info)

            const found = info?.thumbnails.find(obj => obj.url.includes('hq1.jpg'));
            thumbnailUrl = found ? found.url : null;
            console.log("Album Art ~ thumbnailUrl:", thumbnailUrl)

            musicArtist = info?.artist?.replace(/[\\/:*?"<>|]/g, '');
            albumTitle = info?.album?.replace(/[\\/:*?"<>|]/g, '');
            musicTitle = info?.title?.replace(/[\\/:*?"<>|]/g, '');

            uploader = info?.uploader?.replace(/[\\/:*?"<>|]/g, '');
            fullTitle = info?.fulltitle?.replace(/[\\/:*?"<>|]/g, '');

            fileName = musicArtist ? musicArtist : uploader;
            fileName = fileName.concat(albumTitle ? ` - ${albumTitle}`: '');
            fileName = fileName.concat(musicTitle ? ` - ${musicTitle}` : ` - ${fullTitle}`);

            details = {
              artist: musicArtist ? musicArtist : uploader,
              album: albumTitle ? albumTitle : '',
              title: musicTitle ? musicTitle : fullTitle,
            };

            break;
          }
        } catch (error) {
          console.log("⚠️ Track Information ~ error:", error)
        }

        count++;
      }
    } catch (err) {
      console.error('Failed to fetch video info:', err);
    }

    const extension = format === 'mp3' ? 'mp3' : 'webm';
    const outputTemp = path.join(__dirname, 'temp', `${fileName}.${extension}`).replace(/\\/g, '/');
    const outputTemplate = path.join(selectedDownloadFolder, `${fileName}.${extension}`).replace(/\\/g, '/');

    console.log("OutputTemp:", outputTemp);
    console.log("OutputTemplate:", outputTemplate);

    const args = [
      '--cookies-from-browser', youtubeProfile,
      url,
      '-f', 'bestaudio',
      '-o', outputTemp,
    ];

    if (format === 'mp3') {
      args.push('-x', '--audio-format', 'mp3', '--ffmpeg-location', ffmpegPath);
    }

    const download = ytDlpWrap2.exec(args);

    let progressLast;
    let finishedDownload;

    download.on('progress', (progress) => {
      if (!finishedDownload) {
        if (typeof progress.percent === 'number' && !isNaN(progress.percent)) {
          progressLast = progress.percent;
          event.sender.send('download-progress', `Track Progress: ${progress.percent}`);
        } else if (isNaN(progress.percent) && progressLast === 100) {
          // if download close fails this will insure that it's finished
          finishedDownload = true
          if (!download.ytDlpProcess.killed) {
            download.ytDlpProcess.kill('SIGKILL');
          }
        }
      }
    });

    download.on("close", () => {
      console.log("⬇️ Download Song ~ Finished Download");

      appendImageToMp3(outputTemp, thumbnailUrl, outputTemplate, details)
        .then(() => {
          event.sender.send("download-complete");
          onClose();
        })
        .catch((error) => {
          console.error(error);
          onClose();
        });
    });

    download.on('error', (err) => {
      console.error('Download error:', err);
    });

    download.once('error', onClose);
  })
}



ipcMain.on('add-url-queue', async (event, { url, format }) => {
  urlQueue.push({ url, status: 'pending', format, percentage: 0 });

  // updates frontend queue
  event.sender.send('queue-updated', urlQueue);
});


ipcMain.on('download-audio', async (event) => {
  // clean up
  cleanTempFolder()

  if (!selectedDownloadFolder) {
    return event.sender.send('download-error', 'No folder selected. Please select a download folder first.');
  }

  while (_.some(urlQueue, element => element.status !== 'consumed')) {
    const pendingUrls = _.filter(urlQueue, element => element.status === 'pending');
    const currentList = pendingUrls ? pendingUrls[0] : null;

    if (!currentList) {
      break;
    }

    currentList.status = 'consuming';

    // updates frontend queue
    event.sender.send('queue-updated', urlQueue);

    const { url, format } = currentList;

    const matchList = url.match(/list=([^&]+)/);
    const listId = matchList ? matchList[1] : null;
    const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;

    if (matchList) {
      const output = await ytDlpWrap.execPromise(
        [
          '--cookies-from-browser', 'firefox:9iugcrtq.default',
          '--flat-playlist',
          '--get-id',
          playlistUrl,
        ]
      );

      const ids = output.trim().split('\n');
      // console.log(ids); // array of video IDs

      // run list
      for (let index = 0; index < ids.length; index++) {
        currentList.percentage = _.toString(_.round(100 / ids.length * (index), 2));
        // updates frontend queue
        event.sender.send('queue-updated', urlQueue);

        try {
          console.log(`---------------------------------------------------------`)
          console.log(`🎵 Trying to download song ${index + 1} out of ${ids.length}`)

          const songUrl = `https://www.youtube.com/watch?v=${ids[index]}`;
          console.log(`Song URL: ${songUrl}`)

          await downloadSong({ event, url: songUrl, format });

          await sleep(10000);
        } catch (error) {
          console.log("⁉️ ~ error:", error)
        }
      }
    } else {
      const match = url.match(/v=([^&]+)/);
      const videoId = match ? match[1] : null;
      const sanitizedUrl = `https://www.youtube.com/watch?v=${videoId}`;

      try {
        await downloadSong({ event, url: sanitizedUrl, format });
      } catch (error) {
        console.log("🚀 ~ error:", error)
      }
    }

    currentList.status = 'consumed';
    // updates frontend queue
    event.sender.send('queue-updated', urlQueue);
  }

  event.sender.send('download-ended');

  console.log(`🏁 Finished Dowloads`)
});


// main.js
const NodeID3 = require('node-id3');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { writeFile, readFile } = require('node:fs/promises'); // <--- fs/promises
const path = require('path');
const fs = require('fs');
const YtDlpWrap = require('yt-dlp-wrap').default;
const _ = require('lodash');
const { spawn } = require('child_process');
const sharp = require('sharp');

const ytDlpWrap = new YtDlpWrap();

let selectedDownloadFolder = null;
let urlQueue = [];

const settingsPath = path.join(app.getPath('userData'), 'settings.json');
let youtubeProfile;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Set ffmpeg path depending on environment
const ffmpegPath = app.isPackaged
  ? path.join(process.resourcesPath, 'ffmpeg')
  : path.join(__dirname, 'bin', 'ffmpeg')
;

function createWindow() {
  const win = new BrowserWindow({
    width: 700,
    height: 870,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.loadFile('index.html');
}

async function loadSettings() {
  try {
    if (await fs.promises.access(settingsPath).then(() => true).catch(() => false)) {
      const data = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(data);
      selectedDownloadFolder = settings.downloadFolder || null;
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

async function saveSettings() {
  try {
    const settings = { downloadFolder: selectedDownloadFolder };
    await writeFile(settingsPath, JSON.stringify(settings));
  } catch (err) {
    console.error('Error saving settings:', err);
  }
}

async function cleanTempFolder() {
  const tempDir = path.join(__dirname, 'temp');

  try {
    await fs.promises.mkdir(tempDir, { recursive: true }); // ensure exists

    const files = await fs.promises.readdir(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        await fs.promises.unlink(filePath);
        console.log(`🧹 Deleted: ${filePath}`);
      } catch (err) {
        console.error(`Error deleting ${filePath}:`, err);
      }
    }
  } catch (err) {
    console.error('Error cleaning temp folder:', err);
  }
}

async function fetchImageBuffer(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function cropImageInWorker(inputBuffer, outputPath) {
  const tempInput = path.join(__dirname, 'temp', `tmp_image_${Date.now()}.jpg`);
  await writeFile(tempInput, inputBuffer); // fs/promises

  return new Promise((resolve, reject) => {
    const worker = spawn('node', [path.join(__dirname, 'crop-worker.js'), tempInput, outputPath]);

    worker.on('exit', async code => {
      try { await fs.promises.unlink(tempInput); } catch {}
      if (code === 0) resolve();
      else reject(new Error('Crop worker failed'));
    });

    worker.on('error', reject);
  });
}

async function cropToCenteredSquare(imageBuffer) {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();

  const { width, height } = metadata;

  if (!width || !height) {
    throw new Error("Unable to determine image dimensions");
  }

  const size = Math.min(width, height);
  const left = Math.floor((width - size) / 2);
  const top = Math.floor((height - size) / 2);

  return image
    .extract({ left, top, width: size, height: size })
    .jpeg()
    .toBuffer();
}


async function appendImageToMp3(mp3Path, imageUrl, outputPath, details = {}) {
  try {
    console.log("Fetching album art...");
    const imageOriginalBuffer = await fetchImageBuffer(imageUrl);

    console.log("Cropping album art...");
    const outputCropped = path.join(__dirname, 'temp', `cropped_${Date.now()}.jpg`);
    await cropImageInWorker(imageOriginalBuffer, outputCropped);

    console.log("Getting cropped album art...");
    const imageSquareBuffer = await readFile(outputCropped); // fs/promises

    console.log("Reading mp3 file...");
    const mp3Buffer = await readFile(mp3Path); // fs/promises

    const tags = {
      title: details.title || '',
      artist: details.artist || '',
      album: details.album || '',
      APIC: {
        mime: 'image/jpeg',
        type: { id: 3, name: 'front cover' },
        description: 'Album art',
        imageBuffer: imageSquareBuffer
      }
    };

    console.log("Writing tags...");
    const taggedBuffer = NodeID3.update(tags, mp3Buffer);
    if (!taggedBuffer) throw new Error("Failed to write ID3 tags");

    console.log("Saving new mp3...");
    await writeFile(outputPath, taggedBuffer); // fs/promises

    // Clean up cropped image
    try { await fs.promises.unlink(outputCropped); } catch {}

    console.log(`🖼️ Album art added and saved as ${outputPath}`);
  } catch (error) {
    console.error("⁉️ Error adding album art:", error);
  }
}

app.whenReady().then(async () => {
  await loadSettings(); // await here

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
    await saveSettings();
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
        "--js-runtimes", "node",                 // Use Node.js to solve YouTube JS challenges
        "--remote-components", "ejs:github",     // Optional: fetch updated EJS solver scripts if needed
        "--cookies-from-browser", youtubeProfile,
        "-f", "bestvideo[height<=144]",          // pick a tiny format for preview
        "--skip-download",
        "--print-json",
        sanitizedUrl
      ]);

      let count = 1;
      while (count < 4){
        try {
          const infoRaw = await Promise.race([promise, timeout]);
          const info = JSON.parse(infoRaw);

          if (info) {
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
      "--js-runtimes", "node",
      "--remote-components", "ejs:github",
      "--cookies-from-browser", youtubeProfile,
      url,
      "-f", "bestaudio",
      "-o", outputTemp,
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


ipcMain.on('add-url-queue', async (event, { url, format, browser }) => {
  urlQueue.push({ url, status: 'pending', format, browser, percentage: 0 });
  event.sender.send('queue-updated', urlQueue);
});


ipcMain.on('download-audio', async (event) => {
  // ✅ Await cleanup properly
  await cleanTempFolder();

  if (!selectedDownloadFolder) {
    return event.sender.send('download-error', 'No folder selected. Please select a download folder first.');
  }

  while (_.some(urlQueue, element => (element.status !== 'consumed' || element.status !== 'failed'))) {
    const pendingUrls = _.filter(urlQueue, element => element.status === 'pending');
    const currentList = pendingUrls ? pendingUrls[0] : null;
    
    if (!currentList) {
      break;
    }

    const { url, format, browser } = currentList;
    
    // Set which browser to use so to get youtube client token. Needed to get content. 
    youtubeProfile = browser

    currentList.status = 'consuming';
    event.sender.send('queue-updated', urlQueue);
    
    const matchList = url.match(/list=([^&]+)/);
    const listId = matchList ? matchList[1] : null;
    const playlistUrl = `https://www.youtube.com/playlist?list=${listId}`;
    
    try {
      if (matchList) {
        const output = await ytDlpWrap.execPromise([
          "--js-runtimes", "node",
          "--remote-components", "ejs:github",
          "--cookies-from-browser", youtubeProfile,
          "--flat-playlist",
          "--get-id",
          playlistUrl
        ]);

        const ids = output.trim().split('\n');

        for (let index = 0; index < ids.length; index++) {
          currentList.percentage = _.toString(_.round(100 / ids.length * (index), 2));
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
    } catch (error) {
      currentList.status = 'failed';
    }
    event.sender.send('queue-updated', urlQueue);
  }

  event.sender.send('download-ended');
  console.log(`🏁 Finished Dowloads`);
});

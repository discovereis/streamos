require('dotenv').config();
const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
app.use(express.json());
app.use('/videos', express.static('videos'));

// Create folders
if (!fs.existsSync('videos')) fs.mkdirSync('videos');
if (!fs.existsSync('temp')) fs.mkdirSync('temp');

// ── FREE SCRIPT TEMPLATES ──────────────────────────────────────
const scripts = {
  hustle: [
    "Here are 5 side hustles making real money in 2026. Number one: freelance writing. Number two: selling digital products. Number three: YouTube automation. Number four: dropshipping. Number five: online tutoring. Pick one and go all in.",
    "You can make your first 500 dollars online this month. All you need is one skill and consistency. Fiverr and Upwork are free to join right now."
  ],
  productivity: [
    "The most productive people start each day with a plan. Write your top 3 tasks every morning. Do the hardest one first. Try this for 7 days straight.",
    "Stop multitasking. It kills focus and doubles your time. Work in 25 minute blocks with 5 minute breaks. This is the Pomodoro technique and it works."
  ],
  money: [
    "The number one money rule: pay yourself first. Before any bill, move 10 percent to savings. In 5 years you will thank yourself.",
    "Index funds beat 90 percent of professional investors over 10 years. Invest in the S&P 500 every month and let time do the work."
  ],
  travel: [
    "I visited 3 countries for under 800 dollars. Fly Tuesday or Wednesday, book 6 weeks ahead, and use Google Flights price alerts.",
    "Book hotels on Sunday evening. Prices drop because business travelers have already booked. Save up to 30 percent every time."
  ],
  motivation: [
    "Success is not about talent. It is about showing up every single day even when you do not feel like it. Consistency beats everything.",
    "Stop waiting for the perfect moment. It does not exist. Start now with what you have and improve as you go."
  ]
};

function getScript(topic) {
  const list = scripts[topic] || scripts.hustle;
  return list[Math.floor(Math.random() * list.length)];
}

// ── FETCH VIDEO FROM PEXELS ────────────────────────────────────
async function fetchPexelsVideo(topic) {
  const res = await axios.get('https://api.pexels.com/videos/search', {
    headers: { Authorization: process.env.PEXELS_API_KEY },
    params: { query: topic, per_page: 15, min_duration: 15 }
  });

  const videos = res.data.videos;
  if (!videos || !videos.length) throw new Error('No Pexels videos found');

  const random = videos[Math.floor(Math.random() * videos.length)];
  const file = random.video_files.find(f => f.quality === 'hd') ||
               random.video_files.find(f => f.quality === 'sd') ||
               random.video_files[0];

  const videoPath = path.join('temp', `pexels_${Date.now()}.mp4`);
  const writer = fs.createWriteStream(videoPath);
  const response = await axios({ url: file.link, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(videoPath));
    writer.on('error', reject);
  });
}

// ── GENERATE AUDIO (free Linux TTS) ───────────────────────────
function generateAudio(script, audioPath) {
  return new Promise((resolve, reject) => {
    try {
      const escaped = script.replace(/"/g, '');
      execSync(`espeak "${escaped}" --stdout > ${audioPath}`);
      resolve(audioPath);
    } catch (err) {
      reject(new Error('Audio generation failed: ' + err.message));
    }
  });
}

// ── STITCH VIDEO + AUDIO ───────────────────────────────────────
function stitchVideo(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions(['-stream_loop -1'])
      .input(audioPath)
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-c:v libx264',
        '-c:a aac',
        '-shortest',
        '-preset fast',
        '-y'
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(new Error('FFmpeg error: ' + err.message)))
      .run();
  });
}

// ── GENERATE VIDEO ENDPOINT ────────────────────────────────────
app.post('/generate', async (req, res) => {
  const topic = req.body.topic || 'hustle';
  const id = Date.now();
  const outputPath = path.join('videos', `video_${id}.mp4`);
  const audioPath = path.join('temp', `audio_${id}.wav`);

  try {
    console.log(`\n[${id}] Starting video: ${topic}`);

    const script = getScript(topic);
    console.log(`[${id}] ✅ Script ready`);

    const videoPath = await fetchPexelsVideo(topic);
    console.log(`[${id}] ✅ Pexels video downloaded`);

    await generateAudio(script, audioPath);
    console.log(`[${id}] ✅ Audio generated`);

    await stitchVideo(videoPath, audioPath, outputPath);
    console.log(`[${id}] ✅ Video stitched`);

    if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);

    res.json({
      success: true,
      id,
      topic,
      script,
      videoUrl: `/videos/video_${id}.mp4`,
      message: 'Real video generated ✅'
    });

  } catch (err) {
    console.error(`[${id}] ❌ Error:`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── LIST ALL VIDEOS ────────────────────────────────────────────
app.get('/videos-list', (req, res) => {
  try {
    const files = fs.readdirSync('videos')
      .filter(f => f.endsWith('.mp4'))
      .map(f => ({
        name: f,
        url: `/videos/${f}`,
        created: fs.statSync(path.join('videos', f)).mtime
      }));
    res.json({ count: files.length, videos: files });
  } catch (err) {
    res.json({ count: 0, videos: [] });
  }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: '✅ StreamOS Backend Running',
    ffmpeg: 'enabled',
    pexels: process.env.PEXELS_API_KEY ? '✅ connected' : '❌ missing key',
    videos: fs.readdirSync('videos').filter(f => f.endsWith('.mp4')).length
  });
});

app.get('/', (req, res) => {
  res.json({ status: 'StreamOS Backend Running ✅' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 StreamOS Backend running on port ${PORT}`);
  console.log(`Pexels: ${process.env.PEXELS_API_KEY ? '✅ Connected' : '❌ Missing key'}`);
});
```

4. Scroll down and click **"Commit new file"** ✅

---

Your repo will then have:
```
discovereis/streamos/
├── index.html       ✅
├── nixpacks.toml    ✅
├── package.json     ✅
└── server.js        ← doing this now

(() => {
  'use strict';

  const input = document.getElementById('videoInput');
  const fileName = document.getElementById('fileName');
  const processBtn = document.getElementById('processBtn');
  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progress');
  const resultCard = document.getElementById('resultCard');
  const preview = document.getElementById('preview');
  const shareBtn = document.getElementById('shareBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const clearBtn = document.getElementById('clearBtn');

  const MAX_BYTES = 350 * 1024 * 1024;
  const MAX_SECONDS = 60;
  let ffmpeg = null;
  let selectedFile = null;
  let outputFile = null;
  let outputURL = null;
  let engineReady = false;
  let inputVirtualName = null;

  function setStatus(msg) { statusEl.textContent = msg; }
  function humanMB(n) { return `${(n / 1024 / 1024).toFixed(1)} MB`; }

  async function getDuration(file) {
    return await new Promise((resolve, reject) => {
      const v = document.createElement('video');
      const u = URL.createObjectURL(file);
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const d = Number(v.duration);
        URL.revokeObjectURL(u);
        resolve(d);
      };
      v.onerror = () => {
        URL.revokeObjectURL(u);
        reject(new Error('動画情報を読み取れませんでした'));
      };
      v.src = u;
    });
  }

  async function loadEngine() {
    try {
      if (!window.FFmpegWASM || !window.FFmpegUtil) {
        throw new Error('FFmpegライブラリの読み込みに失敗しました');
      }
      const { FFmpeg } = window.FFmpegWASM;
      const { toBlobURL } = window.FFmpegUtil;
      ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress }) => {
        if (Number.isFinite(progress)) progressEl.value = Math.max(0, Math.min(1, progress));
      });
      ffmpeg.on('log', ({ message }) => {
        if (/time=|frame=/.test(message)) setStatus('加工中… iPhoneをスリープさせず待ってね');
      });

      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      engineReady = true;
      setStatus('準備完了。動画を選んでね。');
      processBtn.disabled = !selectedFile;
    } catch (e) {
      console.error(e);
      setStatus(`エンジン準備失敗: ${e.message || e}`);
    }
  }

  input.addEventListener('change', async () => {
    clearResult(false);
    selectedFile = input.files && input.files[0] ? input.files[0] : null;
    if (!selectedFile) {
      fileName.textContent = '未選択';
      processBtn.disabled = true;
      return;
    }

    fileName.textContent = `${selectedFile.name} / ${humanMB(selectedFile.size)}`;
    try {
      const duration = await getDuration(selectedFile);
      fileName.textContent += ` / ${duration.toFixed(1)}秒`;
      if (selectedFile.size > MAX_BYTES) {
        setStatus('350MBを超えています。MVPではPhotosで短く切ってから選ぶのがおすすめ。');
      } else if (duration > MAX_SECONDS) {
        setStatus('60秒を超えています。まずはX用に短く切った動画で試してね。');
      } else {
        setStatus(engineReady ? '加工できます。' : 'エンジン準備中…');
      }
    } catch (e) {
      setStatus(e.message || String(e));
    }
    processBtn.disabled = !engineReady;
  });

  processBtn.addEventListener('click', async () => {
    if (!selectedFile || !ffmpeg || !engineReady) return;
    processBtn.disabled = true;
    resultCard.classList.add('hidden');
    progressEl.value = 0;

    try {
      const { fetchFile } = window.FFmpegUtil;
      const extMatch = selectedFile.name.match(/\.[A-Za-z0-9]+$/);
      const ext = extMatch ? extMatch[0].toLowerCase() : '.mov';
      inputVirtualName = `input${ext}`;
      const out = 'output.mp4';

      setStatus('動画を端末内処理領域へ読み込み中…');
      await ffmpeg.writeFile(inputVirtualName, await fetchFile(selectedFile));

      setStatus('すりガラス加工中…');
      const filter = "scale='if(gt(iw,ih),min(iw,1280),-2)':'if(gt(iw,ih),-2,min(ih,1280))',gblur=sigma=24:steps=2";
      const code = await ffmpeg.exec([
        '-i', inputVirtualName,
        '-vf', filter,
        '-an',
        '-map_metadata', '-1',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '25',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        out
      ]);
      if (code !== 0) throw new Error(`FFmpeg終了コード ${code}`);

      setStatus('書き出し中…');
      const data = await ffmpeg.readFile(out);
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      outputFile = new File([blob], `FROST_X_${Date.now()}.mp4`, { type: 'video/mp4' });
      if (outputURL) URL.revokeObjectURL(outputURL);
      outputURL = URL.createObjectURL(blob);
      preview.src = outputURL;
      downloadBtn.href = outputURL;
      downloadBtn.download = outputFile.name;
      resultCard.classList.remove('hidden');
      progressEl.value = 1;
      setStatus(`完成。 ${humanMB(blob.size)} / 音声なし / メタデータ削除済み`);

      try { await ffmpeg.deleteFile(out); } catch (_) {}
      try { await ffmpeg.deleteFile(inputVirtualName); } catch (_) {}
      inputVirtualName = null;
    } catch (e) {
      console.error(e);
      setStatus(`加工失敗: ${e.message || e}`);
      try { if (inputVirtualName) await ffmpeg.deleteFile(inputVirtualName); } catch (_) {}
      inputVirtualName = null;
    } finally {
      processBtn.disabled = !selectedFile || !engineReady;
    }
  });

  shareBtn.addEventListener('click', async () => {
    if (!outputFile) return;
    try {
      if (navigator.canShare && navigator.canShare({ files: [outputFile] })) {
        await navigator.share({ files: [outputFile], title: 'FROST' });
      } else {
        setStatus('この環境ではファイル共有が使えません。「保存」を使ってください。');
      }
    } catch (e) {
      if (e && e.name !== 'AbortError') setStatus(`共有できませんでした: ${e.message || e}`);
    }
  });

  clearBtn.addEventListener('click', () => clearResult(true));

  function clearResult(clearSelection) {
    preview.pause();
    preview.removeAttribute('src');
    preview.load();
    if (outputURL) URL.revokeObjectURL(outputURL);
    outputURL = null;
    outputFile = null;
    resultCard.classList.add('hidden');
    progressEl.value = 0;
    if (clearSelection) {
      selectedFile = null;
      input.value = '';
      fileName.textContent = '未選択';
      processBtn.disabled = true;
      setStatus(engineReady ? '処理データを破棄しました。' : 'エンジン準備中…');
    }
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
  }

  loadEngine();
})();
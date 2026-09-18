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
  const strengthButtons = document.querySelectorAll('.strength-btn');
  const usernameInput = document.getElementById('usernameInput');

  const MAX_BYTES = 350 * 1024 * 1024;
  const MAX_SECONDS = 90;
  const MAX_DIM = 1280;
  const FPS = 30;

  const STRENGTH_PRESETS = {
    weak:   { divisor: 18, alpha: 0.22, label: '弱' },
    medium: { divisor: 26, alpha: 0.35, label: '中' },
    strong: { divisor: 34, alpha: 0.50, label: '強' }
  };

  let currentStrength = 'medium';

  let selectedFile = null;
  let outputFile = null;
  let outputURL = null;
  let processingVideo = null;
  let sourceURL = null;

  function setStatus(msg) { statusEl.textContent = msg; }
  function humanMB(n) { return `${(n / 1024 / 1024).toFixed(1)} MB`; }
  function getCurrentPreset() { return STRENGTH_PRESETS[currentStrength]; }

  function updateStrengthButtons() {
    strengthButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.strength === currentStrength);
    });
  }

  strengthButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      currentStrength = btn.dataset.strength;
      updateStrengthButtons();
      setStatus(`強度「${getCurrentPreset().label}」を選択中。`);
    });
  });
  updateStrengthButtons();

  function supportedMime() {
    if (!window.MediaRecorder) return null;
    const candidates = [
      'video/mp4;codecs=avc1.42E01E',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  function cleanupSource() {
    if (processingVideo) {
      try { processingVideo.pause(); } catch (_) {}
      processingVideo.removeAttribute('src');
      processingVideo.load();
      processingVideo.remove();
      processingVideo = null;
    }
    if (sourceURL) {
      URL.revokeObjectURL(sourceURL);
      sourceURL = null;
    }
  }

  function buildProcessingVideo(file) {
    cleanupSource();
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      processingVideo = v;
      sourceURL = URL.createObjectURL(file);
      v.src = sourceURL;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.style.position = 'fixed';
      v.style.left = '-9999px';
      v.style.top = '0';
      v.style.width = '2px';
      v.style.height = '2px';
      v.style.opacity = '0.01';
      document.body.appendChild(v);
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error('動画を読み込めませんでした'));
      v.load();
    });
  }

  function calcSize(v) {
    const w = v.videoWidth;
    const h = v.videoHeight;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    return {
      width: Math.max(2, Math.round(w * scale / 2) * 2),
      height: Math.max(2, Math.round(h * scale / 2) * 2)
    };
  }

  function makeBlurBuffer(width, height) {
    const preset = getCurrentPreset();
    const c = document.createElement('canvas');
    c.width = Math.max(24, Math.round(width / preset.divisor));
    c.height = Math.max(24, Math.round(height / preset.divisor));
    return { canvas: c, ctx: c.getContext('2d', { alpha: false }) };
  }

  function makeWatermarkLayer(width, height, text) {
    const clean = String(text || '').trim().slice(0, 40);
    if (!clean) return null;

    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const wctx = c.getContext('2d');
    if (!wctx) return null;

    const fontSize = Math.max(20, Math.round(Math.min(width, height) * 0.055));
    wctx.font = `700 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    wctx.textAlign = 'center';
    wctx.textBaseline = 'middle';
    wctx.fillStyle = 'rgba(255,255,255,0.40)';
    wctx.strokeStyle = 'rgba(0,0,0,0.30)';
    wctx.lineWidth = Math.max(1, Math.round(fontSize * 0.06));

    const textWidth = wctx.measureText(clean).width;
    const xStep = Math.max(textWidth + fontSize * 2.2, width / 2.4);
    const yStep = Math.max(fontSize * 3.2, height / 5);
    const span = Math.sqrt(width * width + height * height);

    wctx.save();
    wctx.translate(width / 2, height / 2);
    wctx.rotate(-20 * Math.PI / 180);

    let row = 0;
    for (let y = -span; y <= span; y += yStep, row++) {
      const offset = (row % 2) * xStep / 2;
      for (let x = -span; x <= span; x += xStep) {
        const px = x + offset;
        wctx.strokeText(clean, px, y);
        wctx.fillText(clean, px, y);
      }
    }

    wctx.restore();
    return c;
  }

  function drawFrostedFrame(ctx, canvas, blurCtx, blurCanvas, v, watermarkLayer) {
    const preset = getCurrentPreset();

    blurCtx.imageSmoothingEnabled = true;
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in blurCtx) blurCtx.imageSmoothingQuality = 'high';
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';

    blurCtx.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
    blurCtx.drawImage(v, 0, 0, blurCanvas.width, blurCanvas.height);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurCanvas, 0, 0, blurCanvas.width, blurCanvas.height, 0, 0, canvas.width, canvas.height);

    ctx.globalAlpha = preset.alpha;
    ctx.drawImage(blurCanvas, 1, 0, blurCanvas.width, blurCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurCanvas, -1, 0, blurCanvas.width, blurCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurCanvas, 0, 1, blurCanvas.width, blurCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurCanvas, 0, -1, blurCanvas.width, blurCanvas.height, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;

    if (watermarkLayer) {
      ctx.drawImage(watermarkLayer, 0, 0, canvas.width, canvas.height);
    }
  }

  function getDuration(file) {
    return new Promise(async (resolve, reject) => {
      try {
        const v = await buildProcessingVideo(file);
        resolve(Number(v.duration));
      } catch (e) {
        reject(e);
      } finally {
        cleanupSource();
      }
    });
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
        setStatus('350MBを超えています。短く切ってから試すのがおすすめ。');
      } else if (duration > MAX_SECONDS) {
        setStatus('90秒を超えています。まずはX用の短尺で試してね。');
      } else {
        setStatus(`準備完了。強度「${getCurrentPreset().label}」で加工できます。`);
      }
      processBtn.disabled = false;
    } catch (e) {
      setStatus(e.message || String(e));
      processBtn.disabled = true;
    }
  });

  processBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    const mime = supportedMime();
    if (mime === null) {
      setStatus('このSafariではMediaRecorderが使えません。');
      return;
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      setStatus('このSafariではcanvas.captureStreamが使えません。');
      return;
    }

    processBtn.disabled = true;
    strengthButtons.forEach(btn => { btn.disabled = true; });
    usernameInput.disabled = true;
    resultCard.classList.add('hidden');
    progressEl.value = 0;

    try {
      const v = await buildProcessingVideo(selectedFile);
      const duration = Number(v.duration);
      const size = calcSize(v);

      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Canvas初期化失敗');

      const { canvas: blurCanvas, ctx: blurCtx } = makeBlurBuffer(canvas.width, canvas.height);
      if (!blurCtx) throw new Error('Blur buffer初期化失敗');

      const watermarkText = usernameInput.value.trim().slice(0, 40);
      const watermarkLayer = makeWatermarkLayer(canvas.width, canvas.height, watermarkText);

      const stream = canvas.captureStream(FPS);
      const opts = mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 };
      const recorder = new MediaRecorder(stream, opts);
      const chunks = [];

      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = e => reject(e.error || new Error('録画エラー'));
      });

      v.currentTime = 0;
      await new Promise(resolve => {
        if (v.readyState >= 2) resolve();
        else v.onloadeddata = resolve;
      });
      drawFrostedFrame(ctx, canvas, blurCtx, blurCanvas, v, watermarkLayer);

      let drawing = true;
      const tick = () => {
        if (!drawing) return;
        drawFrostedFrame(ctx, canvas, blurCtx, blurCanvas, v, watermarkLayer);
        if (duration > 0) progressEl.value = Math.min(0.99, v.currentTime / duration);
        setStatus(`加工中… ${v.currentTime.toFixed(1)} / ${duration.toFixed(1)}秒`);
        if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(tick);
        else requestAnimationFrame(tick);
      };

      recorder.start(1000);
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(tick);
      else requestAnimationFrame(tick);

      await v.play();
      await new Promise((resolve, reject) => {
        v.onended = resolve;
        v.onerror = () => reject(new Error('再生処理エラー'));
      });

      drawing = false;
      drawFrostedFrame(ctx, canvas, blurCtx, blurCanvas, v, watermarkLayer);
      recorder.stop();
      await stopped;
      stream.getTracks().forEach(t => t.stop());

      const finalType = recorder.mimeType || mime || 'video/mp4';
      const blob = new Blob(chunks, { type: finalType });
      const isMp4 = finalType.includes('mp4');
      const ext = isMp4 ? 'mp4' : 'webm';
      outputFile = new File([blob], `FROST_X_${Date.now()}.${ext}`, { type: finalType });

      if (outputURL) URL.revokeObjectURL(outputURL);
      outputURL = URL.createObjectURL(blob);
      preview.src = outputURL;
      downloadBtn.href = outputURL;
      downloadBtn.download = outputFile.name;
      resultCard.classList.remove('hidden');
      progressEl.value = 1;
      const watermarkStatus = watermarkText ? ` / 透かし「${watermarkText}」` : '';
      setStatus(`完成。 ${humanMB(blob.size)} / すりガラス強度「${getCurrentPreset().label}」${watermarkStatus} / 音声なし / サーバー送信なし`);
    } catch (e) {
      console.error(e);
      setStatus(`加工失敗: ${e.message || e}`);
    } finally {
      cleanupSource();
      processBtn.disabled = !selectedFile;
      strengthButtons.forEach(btn => { btn.disabled = false; });
      usernameInput.disabled = false;
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
    cleanupSource();
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
      setStatus('処理データを破棄しました。');
    }
  }

  const mime = supportedMime();
  if (mime === null || !HTMLCanvasElement.prototype.captureStream) {
    setStatus('この端末はLite処理に未対応です。Safari/iOSを更新してね。');
  } else {
    setStatus('準備完了。動画を選んでね。');
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.error));
  }
})();
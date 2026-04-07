// assets/js/app.js
(() => {
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const countdownEl = document.getElementById("countdown");
  const frameListEl = document.getElementById("frameList");

  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnCapture = document.getElementById("btnCapture");
  const btnReset = document.getElementById("btnReset");

  const btnDownloadPng = document.getElementById("btnDownloadPng");
  const btnDownloadJpg = document.getElementById("btnDownloadJpg");
  const btnFullscreen = document.getElementById("btnFullscreen");

  // Optional buttons (only if you added them in HTML)
  const btnSwitchCamera = document.getElementById("btnSwitchCamera");
  const btnShare = document.getElementById("btnShare");

  const modeEl = document.getElementById("mode");
  const outSizeEl = document.getElementById("outSize");
  const cdSecEl = document.getElementById("cdSec");
  const mirrorEl = document.getElementById("mirror");
  const filterEl = document.getElementById("filter");
  const strengthEl = document.getElementById("strength");

  let currentCamera = "user"; // "user" (front) or "environment" (back)
  let stream = null;

  // Selected frame
  let activeFrame = null;
  let activeFrameImg = new Image();
  activeFrameImg.crossOrigin = "anonymous";

  // Captured shots (Image objects)
  let shots = [];

  // Offscreen temp canvas for capturing video frame
  const tempCanvas = document.createElement("canvas");
  const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });

  // ---------------------------
  // Helpers
  // ---------------------------
  function wait(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  function showCountdown(n) {
    countdownEl?.classList.remove("hidden");
    if (countdownEl) countdownEl.textContent = String(n);
  }

  function hideCountdown() {
    countdownEl?.classList.add("hidden");
  }

  async function runCountdown() {
    const sec = Number(cdSecEl?.value || 3);
    for (let i = sec; i >= 1; i--) {
      showCountdown(i);
      await wait(1000);
    }
    hideCountdown();
  }

  function setOutputSizeFromUI() {
    const [w, h] = String(outSizeEl?.value || "1080x1080")
      .split("x")
      .map(Number);

    canvas.width = w;
    canvas.height = h;

    tempCanvas.width = w;
    tempCanvas.height = h;

    redrawPreview();
  }

  function syncMirrorByCamera() {
    // Typical selfie behavior: mirror front camera, not mirror back camera
    if (!mirrorEl) return;
    mirrorEl.checked = currentCamera === "user";
  }

  // ---------------------------
  // Frames UI
  // ---------------------------
  function renderFramesUI() {
    if (!frameListEl) return;
    frameListEl.innerHTML = "";

    const frames = window.FRAMES || [];
    frames.forEach((f, idx) => {
      const item = document.createElement("div");
      item.className = "frameItem" + (idx === 0 ? " active" : "");
      item.dataset.id = f.id;

      const img = document.createElement("img");
      img.alt = f.name;
      img.src = f.src;

      item.appendChild(img);
      frameListEl.appendChild(item);

      item.addEventListener("click", () => {
        document.querySelectorAll(".frameItem").forEach((el) => el.classList.remove("active"));
        item.classList.add("active");
        selectFrame(f);
      });

      if (idx === 0) selectFrame(f);
    });
  }

  function selectFrame(frame) {
    activeFrame = frame;
    activeFrameImg = new Image();
    activeFrameImg.onload = () => redrawPreview();
    activeFrameImg.src = frame.src;
  }

  // ---------------------------
  // Camera
  // ---------------------------
  async function startCamera() {
    try {
      // ✅ Allow restart (needed for switching cameras)
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: currentCamera }, // better compatibility
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      video.srcObject = stream;
      await video.play();
      redrawPreview();
    } catch (err) {
      alert(
        "មិនអាចបើកកាមេរ៉ា។ សូមពិនិត្យ Permission ឬរត់ដោយ http:// (Live Server)។\n\n" +
          err
      );
    }
  }

  function stopCamera() {
    if (!stream) return;
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    redrawPreview();
  }

  function drawVideoCoverTo(ctx2, w, h) {
    if (!video.videoWidth || !video.videoHeight) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetRatio = w / h;
    const videoRatio = vw / vh;

    let sx, sy, sw, sh;

    if (videoRatio > targetRatio) {
      // video wider -> crop left/right
      sh = vh;
      sw = vh * targetRatio;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      // video taller -> crop top/bottom
      sw = vw;
      sh = vw / targetRatio;
      sx = 0;
      sy = (vh - sh) / 2;
    }

    if (mirrorEl?.checked) {
      ctx2.save();
      ctx2.translate(w, 0);
      ctx2.scale(-1, 1);
      ctx2.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
      ctx2.restore();
    } else {
      ctx2.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    }
  }

  function captureShot() {
    const w = canvas.width;
    const h = canvas.height;

    tempCtx.clearRect(0, 0, w, h);
    drawVideoCoverTo(tempCtx, w, h);

    const dataUrl = tempCanvas.toDataURL("image/png");
    const img = new Image();
    img.src = dataUrl;
    return img;
  }

  // ---------------------------
  // Filters (pixel processing)
  // ---------------------------
  function clamp(v) {
    return Math.max(0, Math.min(255, v));
  }

  function rand01(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  }

  function applyFilterToImageData(imgData, w, h, filterName, strength01) {
    const d = imgData.data;

    const cx = w / 2,
      cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let p = 0; p < d.length; p += 4) {
      const idx = p / 4;
      const x = idx % w;
      const y = (idx / w) | 0;

      let r = d[p],
        g = d[p + 1],
        b = d[p + 2];

      if (filterName === "none") {
        // do nothing
      } else if (filterName === "bw") {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = r + (gray - r) * strength01;
        g = g + (gray - g) * strength01;
        b = b + (gray - b) * strength01;
      } else if (filterName === "sepia") {
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        r = r + (sr - r) * strength01;
        g = g + (sg - g) * strength01;
        b = b + (sb - b) * strength01;
      } else if (filterName === "warm") {
        r = r + 35 * strength01;
        g = g + 10 * strength01;
        b = b - 15 * strength01;
      } else if (filterName === "cool") {
        r = r - 10 * strength01;
        g = g + 5 * strength01;
        b = b + 35 * strength01;
      } else if (filterName === "contrast") {
        const c = 1 + 1.2 * strength01; // 1..2.2
        r = (r - 128) * c + 128;
        g = (g - 128) * c + 128;
        b = (b - 128) * c + 128;
      } else if (filterName === "fade") {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = r + (gray - r) * (0.25 * strength01);
        g = g + (gray - g) * (0.25 * strength01);
        b = b + (gray - b) * (0.25 * strength01);

        r = r + 18 * strength01;
        g = g + 18 * strength01;
        b = b + 18 * strength01;

        const c = 1 - 0.25 * strength01;
        r = (r - 128) * c + 128;
        g = (g - 128) * c + 128;
        b = (b - 128) * c + 128;
      } else if (filterName === "kodak") {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const t = gray / 255;

        // fade + lift
        r = r + (gray - r) * (0.18 * strength01) + 10 * strength01;
        g = g + (gray - g) * (0.12 * strength01) + 10 * strength01;
        b = b + (gray - b) * (0.08 * strength01) + 10 * strength01;

        // split tone
        r += (-6 * (1 - t) + 18 * t) * strength01;
        g += (2 * (1 - t) + 8 * t) * strength01;
        b += (8 * (1 - t) - 8 * t) * strength01;

        // mild contrast
        const c = 1 + 0.35 * strength01;
        r = (r - 128) * c + 128;
        g = (g - 128) * c + 128;
        b = (b - 128) * c + 128;

        // grain
        const grainAmt = 22 * strength01;
        const n = (rand01(idx * 0.17 + gray) - 0.5) * 2;
        r += n * grainAmt;
        g += n * grainAmt;
        b += n * grainAmt;

        // vignette
        const dx = x - cx,
          dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
        const vig = 1 - 0.55 * strength01 * (dist * dist);
        r *= vig;
        g *= vig;
        b *= vig;
      } else if (filterName === "vintage") {
        r += 15 * strength01;
        g += 5 * strength01;
        b -= 10 * strength01;

        const gray = 0.3 * r + 0.59 * g + 0.11 * b;
        r = r * 0.8 + gray * 0.2;
        g = g * 0.8 + gray * 0.2;
        b = b * 0.8 + gray * 0.2;
      } else if (filterName === "film") {
        r *= 1 + 0.10 * strength01;
        g *= 1 + 0.05 * strength01;
        b *= 1 - 0.10 * strength01;
      } else if (filterName === "instagram") {
        r += 25 * strength01;
        g += 10 * strength01;
        b -= 10 * strength01;
      } else if (filterName === "bright") {
        r += 40 * strength01;
        g += 40 * strength01;
        b += 40 * strength01;
      } else if (filterName === "dark") {
        r -= 40 * strength01;
        g -= 40 * strength01;
        b -= 40 * strength01;
      } else if (filterName === "dream") {
        r += 20 * strength01;
        g += 10 * strength01;
        b += 30 * strength01;
      } else if (filterName === "sunset") {
        r += 40 * strength01;
        g += 15 * strength01;
        b -= 25 * strength01;
      }

      d[p] = clamp(r);
      d[p + 1] = clamp(g);
      d[p + 2] = clamp(b);
      // alpha unchanged
    }

    return imgData;
  }

  function applyCurrentFilterOnCanvas() {
    const filterName = filterEl?.value || "none";
    const strength01 = Number(strengthEl?.value || 0) / 100;
    if (filterName === "none" || strength01 <= 0) return;

    const w = canvas.width;
    const h = canvas.height;
    const imgData = ctx.getImageData(0, 0, w, h);
    applyFilterToImageData(imgData, w, h, filterName, strength01);
    ctx.putImageData(imgData, 0, 0);
  }

  // ---------------------------
  // Compose Output
  // ---------------------------
  function roundRect(ctx2, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx2.moveTo(x + rr, y);
    ctx2.arcTo(x + w, y, x + w, y + h, rr);
    ctx2.arcTo(x + w, y + h, x, y + h, rr);
    ctx2.arcTo(x, y + h, x, y, rr);
    ctx2.arcTo(x, y, x + w, y, rr);
    ctx2.closePath();
  }

  function composeSingle(shotImg) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.drawImage(shotImg, 0, 0, w, h);

    // Apply filter BEFORE frame overlay
    applyCurrentFilterOnCanvas();

    if (activeFrameImg && activeFrameImg.complete) {
      ctx.drawImage(activeFrameImg, 0, 0, w, h);
    }
  }

  function composeStrip(shotImgs) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0b0f17";
    ctx.fillRect(0, 0, w, h);

    const pad = Math.round(w * 0.05);
    const gap = Math.round(w * 0.03);
    const innerW = w - pad * 2;
    const cellH = Math.floor((h - pad * 2 - gap * 2) / 3);

    for (let i = 0; i < 3; i++) {
      const x = pad;
      const y = pad + i * (cellH + gap);

      if (shotImgs[i]) {
        const img = shotImgs[i];
        const iw = img.width || innerW;
        const ih = img.height || cellH;

        const cellRatio = innerW / cellH;
        const imgRatio = iw / ih;

        let sx, sy, sw, sh;

        if (imgRatio > cellRatio) {
          sh = ih;
          sw = ih * cellRatio;
          sx = (iw - sw) / 2;
          sy = 0;
        } else {
          sw = iw;
          sh = iw / cellRatio;
          sx = 0;
          sy = (ih - sh) / 2;
        }

        ctx.save();
        ctx.beginPath();
        roundRect(ctx, x, y, innerW, cellH, 18);
        ctx.clip();
        ctx.drawImage(img, sx, sy, sw, sh, x, y, innerW, cellH);
        ctx.restore();
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(x, y, innerW, cellH);
      }
    }

    // Apply filter BEFORE frame overlay
    applyCurrentFilterOnCanvas();

    if (activeFrameImg && activeFrameImg.complete) {
      ctx.drawImage(activeFrameImg, 0, 0, w, h);
    }
  }

  function redrawPreview() {
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (modeEl?.value === "single") {
      if (shots[0]) {
        composeSingle(shots[0]);
      } else {
        if (stream) {
          tempCtx.clearRect(0, 0, w, h);
          drawVideoCoverTo(tempCtx, w, h);
          ctx.drawImage(tempCanvas, 0, 0, w, h);
          // NOTE: live filter preview is heavy, so we keep it off here
        } else {
          ctx.fillStyle = "#0b0f17";
          ctx.fillRect(0, 0, w, h);
        }
        if (activeFrameImg && activeFrameImg.complete) ctx.drawImage(activeFrameImg, 0, 0, w, h);
      }
    } else {
      if (shots.length > 0) {
        composeStrip([shots[0], shots[1], shots[2]]);
      } else {
        ctx.fillStyle = "#0b0f17";
        ctx.fillRect(0, 0, w, h);
        if (activeFrameImg && activeFrameImg.complete) ctx.drawImage(activeFrameImg, 0, 0, w, h);
      }
    }
  }

  // ---------------------------
  // Capture + Download
  // ---------------------------
  async function handleCapture() {
    if (!stream) {
      alert("សូមចុច Start Camera មុន!");
      return;
    }

    const mode = modeEl?.value || "single";

    if (mode === "single") {
      await runCountdown();
      const img = captureShot();
      await img.decode().catch(() => {});
      shots = [img];
      redrawPreview();
      return;
    }

    // strip 3
    shots = [];
    redrawPreview();

    for (let i = 0; i < 3; i++) {
      await runCountdown();
      const img = captureShot();
      await img.decode().catch(() => {});
      shots.push(img);
      redrawPreview();
      await wait(350);
    }
  }

  function download(type) {
    // Ensure composed output is up-to-date (filter included)
    redrawPreview();

    const mime = type === "jpg" ? "image/jpeg" : "image/png";
    const quality = type === "jpg" ? 0.95 : undefined; // HQ jpg
    const dataUrl = canvas.toDataURL(mime, quality);

    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    a.download = `photobooth-${modeEl?.value || "single"}-${outSizeEl?.value || "1080x1080"}-${stamp}.${type}`;
    a.href = dataUrl;
    a.click();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  // ---------------------------
  // Share (Mobile)
  // ---------------------------
  async function shareImage() {
    redrawPreview();

    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    if (!blob) return;

    const file = new File([blob], "photobooth.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "Photobooth", files: [file] });
    } else {
      // fallback download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "photobooth.png";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ---------------------------
  // Events
  // ---------------------------
  btnStart?.addEventListener("click", startCamera);
  btnStop?.addEventListener("click", stopCamera);
  btnCapture?.addEventListener("click", handleCapture);
  btnReset?.addEventListener("click", () => {
    shots = [];
    redrawPreview();
  });

  btnDownloadPng?.addEventListener("click", () => download("png"));
  btnDownloadJpg?.addEventListener("click", () => download("jpg"));
  btnFullscreen?.addEventListener("click", toggleFullscreen);

  // Switch camera
  btnSwitchCamera?.addEventListener("click", async () => {
    currentCamera = currentCamera === "user" ? "environment" : "user";
    syncMirrorByCamera();
    await startCamera(); // startCamera stops old stream and starts new one
  });

  // Share
  btnShare?.addEventListener("click", shareImage);

  outSizeEl?.addEventListener("change", setOutputSizeFromUI);
  modeEl?.addEventListener("change", () => {
    shots = [];
    redrawPreview();
  });
  mirrorEl?.addEventListener("change", redrawPreview);
  filterEl?.addEventListener("change", redrawPreview);
  strengthEl?.addEventListener("input", redrawPreview);

  // Init
  renderFramesUI();
  syncMirrorByCamera();
  setOutputSizeFromUI();

  // Live preview refresh (only when no captured image)
  setInterval(() => {
    if (!shots.length) redrawPreview();
  }, 140);
})();
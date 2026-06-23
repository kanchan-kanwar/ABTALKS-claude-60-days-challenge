
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    stream: null,
    imageData: null,
    gridSize: 3,
    pieceSize: 0,
    boardSize: 0,
    pieces: [],         // { id, currentIndex } — id is correct index
    timerInterval: null,
    startTime: 0,
    elapsedMs: 0,
    moves: 0,
    dragPiece: null,
    dragOffX: 0,
    dragOffY: 0,
    dragStartCell: -1,
    boardRect: null,
    solved: false,
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const video       = $('video');
  const snapCanvas  = $('snap-canvas');
  const prevCanvas  = $('preview-canvas');
  const board       = $('puzzle-board');
  const errMsg      = $('error-msg');
  const btnSnap     = $('btn-snap');
  const btnStart    = $('btn-start');
  const btnRetake   = $('btn-retake');
  const btnNewPhoto = $('btn-new-photo');
  const btnPlayAgain= $('btn-play-again');
  const hudTime     = $('hud-time');
  const hudMoves    = $('hud-moves');
  const hudCorrect  = $('hud-correct');
  const progressBar = $('progress-bar');
  const progLeft    = $('prog-label-left');
  const progRight   = $('prog-label-right');
  const winOverlay  = $('win-overlay');
  const winTime     = $('win-time');
  const winMoves    = $('win-moves');
  const winDiff     = $('win-diff');
  const lbList      = $('leaderboard-list');
  const btnWinAgain   = $('btn-win-again');
  const btnWinNewdiff = $('btn-win-newdiff');
  const btnWinNewphoto= $('btn-win-newphoto');

  // ── Screens ────────────────────────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  async function startCamera() {
    errMsg.style.display = 'none';
    try {
      if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
      }
      const constraints = {
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      };
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = state.stream;
      video.onloadedmetadata = () => {
        video.play();
        btnSnap.disabled = false;
      };
    } catch (err) {
      showCameraError(err);
    }
  }

  function showCameraError(err) {
    btnSnap.disabled = true;
    let msg = '📷 Camera access denied or unavailable.';
    if (err && err.name === 'NotAllowedError') {
      msg = '🚫 Camera permission was denied. Please allow camera access in your browser settings and reload.';
    } else if (err && err.name === 'NotFoundError') {
      msg = '🔍 No camera found. Please connect a camera and reload.';
    } else if (err && err.name === 'NotReadableError') {
      msg = '⚠️ Camera is in use by another app. Close it and reload.';
    } else if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      msg = '🔒 Camera requires HTTPS. Please open this page over a secure connection.';
    }
    errMsg.textContent = msg;
    errMsg.style.display = 'block';
  }

  // ── Snap photo ─────────────────────────────────────────────────────────────
  function takePhoto() {
    const w = video.videoWidth  || 640;
    const h = video.videoHeight || 480;
    const size = Math.min(w, h);
    const sx = (w - size) / 2;
    const sy = (h - size) / 2;

    snapCanvas.width  = size;
    snapCanvas.height = size;
    const ctx = snapCanvas.getContext('2d');
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);
    ctx.restore();

    state.imageData = snapCanvas.toDataURL('image/jpeg', 0.92);

    // Mirror to preview
    prevCanvas.width  = size;
    prevCanvas.height = size;
    prevCanvas.getContext('2d').drawImage(snapCanvas, 0, 0);

    // Stop stream
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());

    showScreen('screen-difficulty');
  }

  // ── Difficulty selection ────────────────────────────────────────────────────
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.gridSize = parseInt(btn.dataset.grid, 10);
    });
  });

  // ── Puzzle generation ──────────────────────────────────────────────────────
  function computeBoardSize() {
    const maxW = Math.min(window.innerWidth - 32, 520);
    const maxH = window.innerHeight * 0.55;
    return Math.floor(Math.min(maxW, maxH));
  }

  function buildPuzzle() {
    const n = state.gridSize;
    const total = n * n;
    const boardSize = computeBoardSize();
    const pieceSize = Math.floor(boardSize / n);
    state.boardSize = pieceSize * n;
    state.pieceSize = pieceSize;

    // Set board dimensions
    board.style.width  = state.boardSize + 'px';
    board.style.height = state.boardSize + 'px';
    board.style.position = 'relative';

    // Create shuffled order (Fisher-Yates, guarantee solvable)
    const order = Array.from({ length: total }, (_, i) => i);
    shuffleArray(order);
    // For odd-parity grids > 1x1, we just shuffle freely (all permutations reachable via swaps in our swap mechanic)

    // Build pieces array: pieces[currentIndex] = pieceId (correct index)
    state.pieces = order.map((id, currentIndex) => ({ id, currentIndex }));

    renderPieces();
    updateHUD();
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function renderPieces() {
    board.innerHTML = '';
    const n = state.gridSize;
    const ps = state.pieceSize;
    const img = new Image();
    img.src = state.imageData;

    state.pieces.forEach(({ id, currentIndex }) => {
      // correct position of piece id
      const correctRow = Math.floor(id / n);
      const correctCol = id % n;

      // current position
      const curRow = Math.floor(currentIndex / n);
      const curCol = currentIndex % n;

      const el = document.createElement('div');
      el.className = 'piece';
      el.dataset.id = id;
      el.style.width  = ps + 'px';
      el.style.height = ps + 'px';
      el.style.backgroundImage = `url(${state.imageData})`;
      el.style.backgroundSize  = `${ps * n}px ${ps * n}px`;
      el.style.backgroundPosition = `-${correctCol * ps}px -${correctRow * ps}px`;
      el.style.left = curCol * ps + 'px';
      el.style.top  = curRow * ps + 'px';

      if (id === currentIndex) el.classList.add('correct');

      attachPieceEvents(el);
      board.appendChild(el);
    });
  }

  // ── Drag logic ─────────────────────────────────────────────────────────────
  function attachPieceEvents(el) {
    el.addEventListener('mousedown',  onDragStart, { passive: false });
    el.addEventListener('touchstart', onDragStart, { passive: false });
  }

  function getEventPos(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  function onDragStart(e) {
    if (state.solved) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pos = getEventPos(e);

    state.boardRect = board.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    state.dragOffX = pos.x - elRect.left;
    state.dragOffY = pos.y - elRect.top;

    const id = parseInt(el.dataset.id, 10);
    const piece = state.pieces.find(p => p.id === id);
    state.dragPiece = { el, pieceObj: piece };
    state.dragStartCell = piece.currentIndex;

    el.classList.add('dragging');
    el.classList.remove('correct');
    el.style.zIndex = 1000;

    // Move to pointer, detach from grid
    positionDragEl(el, pos);

    document.addEventListener('mousemove',  onDragMove, { passive: false });
    document.addEventListener('mouseup',    onDragEnd);
    document.addEventListener('touchmove',  onDragMove, { passive: false });
    document.addEventListener('touchend',   onDragEnd);
    document.addEventListener('touchcancel',onDragEnd);
  }

  function onDragMove(e) {
    if (!state.dragPiece) return;
    e.preventDefault();
    positionDragEl(state.dragPiece.el, getEventPos(e));
  }

  function positionDragEl(el, pos) {
    const r = state.boardRect;
    const x = pos.x - r.left - state.dragOffX;
    const y = pos.y - r.top  - state.dragOffY;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }

  function onDragEnd(e) {
    if (!state.dragPiece) return;
    document.removeEventListener('mousemove',  onDragMove);
    document.removeEventListener('mouseup',    onDragEnd);
    document.removeEventListener('touchmove',  onDragMove);
    document.removeEventListener('touchend',   onDragEnd);
    document.removeEventListener('touchcancel',onDragEnd);

    const { el, pieceObj } = state.dragPiece;
    state.dragPiece = null;

    // Where did it land?
    const pos = e.touches ? (e.changedTouches[0] ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY } : null) : { x: e.clientX, y: e.clientY };
    let targetCell = state.dragStartCell;

    if (pos) {
      const r = state.boardRect;
      const relX = pos.x - r.left;
      const relY = pos.y - r.top;
      const ps = state.pieceSize;
      const n  = state.gridSize;
      const col = Math.floor(relX / ps);
      const row = Math.floor(relY / ps);
      if (col >= 0 && col < n && row >= 0 && row < n) {
        targetCell = row * n + col;
      }
    }

    // Swap pieces if different cell
    if (targetCell !== state.dragStartCell) {
      swapPieces(state.dragStartCell, targetCell);
      state.moves++;
    }

    el.classList.remove('dragging');
    el.style.zIndex = '';

    // Snap all pieces to grid (re-render positions)
    snapAllToGrid();
    updateHUD();
    checkWin();
  }

  function swapPieces(cellA, cellB) {
    const pa = state.pieces.find(p => p.currentIndex === cellA);
    const pb = state.pieces.find(p => p.currentIndex === cellB);
    if (pa) pa.currentIndex = cellB;
    if (pb) pb.currentIndex = cellA;
  }

  function snapAllToGrid() {
    const n = state.gridSize;
    const ps = state.pieceSize;
    state.pieces.forEach(({ id, currentIndex }) => {
      const el = board.querySelector(`.piece[data-id="${id}"]`);
      if (!el) return;
      const row = Math.floor(currentIndex / n);
      const col = currentIndex % n;
      el.style.left = col * ps + 'px';
      el.style.top  = row * ps + 'px';
      el.style.zIndex = '';
      if (id === currentIndex) {
        el.classList.add('correct');
      } else {
        el.classList.remove('correct');
      }
    });
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function startTimer() {
    clearInterval(state.timerInterval);
    state.startTime = Date.now();
    state.elapsedMs = 0;
    state.timerInterval = setInterval(tickTimer, 100);
  }

  function tickTimer() {
    state.elapsedMs = Date.now() - state.startTime;
    hudTime.textContent = formatTime(state.elapsedMs);
  }

  function stopTimer() {
    clearInterval(state.timerInterval);
    state.elapsedMs = Date.now() - state.startTime;
    hudTime.textContent = formatTime(state.elapsedMs);
  }

  function formatTime(ms) {
    const totalSec = Math.floor(ms / 100) / 10;
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const tenths = Math.round((totalSec % 1) * 10);
    return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${tenths}`;
  }

  // ── HUD update ─────────────────────────────────────────────────────────────
  function updateHUD() {
    const total = state.gridSize * state.gridSize;
    const correct = state.pieces.filter(p => p.id === p.currentIndex).length;
    const pct = total > 0 ? (correct / total) * 100 : 0;
    hudMoves.textContent = state.moves;
    hudCorrect.textContent = correct + '/' + total;
    progressBar.style.width = pct + '%';
    progLeft.textContent  = correct + ' placed';
    progRight.textContent = (total - correct) + ' remaining';
  }

  // ── Win detection ──────────────────────────────────────────────────────────
  function checkWin() {
    const solved = state.pieces.every(p => p.id === p.currentIndex);
    if (!solved) return;
    state.solved = true;
    stopTimer();
    showWin();
  }

  function showWin() {
    const diff = state.gridSize + '×' + state.gridSize;
    winTime.textContent  = formatTime(state.elapsedMs);
    winMoves.textContent = state.moves;
    winDiff.textContent  = diff;

    saveScore();
    renderLeaderboard();
    winOverlay.classList.add('active');
    launchConfetti();
  }

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  function saveScore() {
    const key = 'facepuzzle_scores';
    let scores = [];
    try { scores = JSON.parse(localStorage.getItem(key)) || []; } catch(e) {}
    scores.push({
      time: state.elapsedMs,
      moves: state.moves,
      diff: state.gridSize + '×' + state.gridSize,
      date: new Date().toLocaleDateString(),
    });
    scores.sort((a, b) => a.time - b.time);
    scores = scores.slice(0, 5);
    try { localStorage.setItem(key, JSON.stringify(scores)); } catch(e) {}
  }

  function renderLeaderboard() {
    let scores = [];
    try { scores = JSON.parse(localStorage.getItem('facepuzzle_scores')) || []; } catch(e) {}
    if (!scores.length) {
      lbList.innerHTML = '<div style="color:var(--muted);font-size:0.8rem;padding:6px 0">No scores yet — you\'re the first!</div>';
      return;
    }
    const ranks = ['🥇','🥈','🥉','4','5'];
    const rankClass = ['gold','silver','bronze','',''];
    lbList.innerHTML = scores.map((s, i) => `
      <div class="lb-entry">
        <span class="lb-rank ${rankClass[i]}">${ranks[i]}</span>
        <span style="color:var(--muted);font-size:0.7rem">${s.date}</span>
        <span class="lb-time">${formatTime(s.time)}</span>
        <span class="lb-moves">${s.moves}mv · ${s.diff}</span>
      </div>
    `).join('');
  }

  // ── Confetti ───────────────────────────────────────────────────────────────
  function launchConfetti() {
    const colors = ['#6c63ff','#ff6584','#00e5a0','#fbbf24','#60a5fa','#f472b6'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left  = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.width  = (Math.random() * 8 + 5) + 'px';
      el.style.height = (Math.random() * 8 + 5) + 'px';
      el.style.animationDuration = (Math.random() * 2.5 + 1.5) + 's';
      el.style.animationDelay    = (Math.random() * 1) + 's';
      el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

  // ── Flow ───────────────────────────────────────────────────────────────────
  function startGame() {
    state.solved = false;
    state.moves  = 0;
    hudMoves.textContent = '0';
    hudTime.textContent  = '00:00.0';
    showScreen('screen-game');
    buildPuzzle();
    startTimer();
  }

  function goToCamera() {
    winOverlay.classList.remove('active');
    showScreen('screen-camera');
    startCamera();
  }

  function goToDifficulty() {
    winOverlay.classList.remove('active');
    showScreen('screen-difficulty');
  }

  // ── Event bindings ─────────────────────────────────────────────────────────
  btnSnap.addEventListener('click', takePhoto);

  btnStart.addEventListener('click', startGame);

  btnRetake.addEventListener('click', () => {
    showScreen('screen-camera');
    startCamera();
  });

  btnNewPhoto.addEventListener('click', goToCamera);

  btnPlayAgain.addEventListener('click', () => {
    state.solved = false;
    state.moves  = 0;
    hudMoves.textContent = '0';
    buildPuzzle();
    startTimer();
  });

  btnWinAgain.addEventListener('click', () => {
    winOverlay.classList.remove('active');
    state.solved = false;
    state.moves  = 0;
    hudMoves.textContent = '0';
    buildPuzzle();
    startTimer();
  });

  btnWinNewdiff.addEventListener('click', goToDifficulty);
  btnWinNewphoto.addEventListener('click', goToCamera);

  // Handle window resize — rebuild board at new size
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const screen = document.querySelector('.screen.active');
      if (screen && screen.id === 'screen-game' && state.imageData) {
        buildPuzzle();
      }
    }, 250);
  });

  // Prevent default touch scroll on board
  board.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

  // ── Init ───────────────────────────────────────────────────────────────────
  startCamera();

})();

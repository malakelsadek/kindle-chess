/* Kindle Chess — app logic. Plain ES5, no external calls, minimal DOM churn
   so redraws stay small on an e-ink screen. */
(function () {
  'use strict';

  var GLYPHS = {
    w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
    b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
  };

  /* Difficulty levels are approximate — a depth-limited search on a toy
     evaluation function can't be calibrated to real Elo. Lower levels are
     weakened further by occasionally playing a random legal move instead
     of the searched best move, so they actually feel weaker, not just slower. */
  var DIFFICULTY_LEVELS = {
    '1': { depth: 1, random: 0.6 },
    '2': { depth: 1, random: 0.4 },
    '3': { depth: 1, random: 0.2 },
    '4': { depth: 1, random: 0.05 },
    '5': { depth: 2, random: 0.15 },
    '6': { depth: 2, random: 0 },
    '7': { depth: 3, random: 0.1 },
    '8': { depth: 3, random: 0 }
  };

  var game = new Chess();

  var boardEl, statusEl, themeToggleBtn, modeSelect, difficultySelect, sideSelect,
      pieceSetSelect, difficultyLabel, sideLabel, promotionEl, newGameBtn, undoBtn,
      appMainEl, settingsPanelEl, playActionsEl, puzzleActionsEl,
      openPuzzlesBtn, openSettingsBtn, closeSettingsBtn,
      puzzleHintBtn, puzzleRetryBtn, puzzleNextBtn, puzzleBackBtn, refreshScreenBtn;

  var squareEls = {};
  var selectedSquare = null;
  var highlightedTargets = [];
  var lastMoveSquares = [];
  var checkSquare = null;
  var hintSquare = null;
  var pendingPromotion = null;
  var aiThinking = false;
  var gameOverFlag = false;

  var mode = 'computer';
  var humanColor = 'w';
  var difficulty = DIFFICULTY_LEVELS['3'];
  var pieceSet = 'staunty';

  /* 'play' | 'puzzle'. Settings is a separate overlay, not a third app mode —
     it never changes what the board is showing underneath. */
  var appMode = 'play';
  var currentPuzzle = null;
  var puzzleIndex = 0;
  var puzzleMoveIndex = 0;
  var puzzleBusy = false;
  var savedPlayFen = null;
  var savedPlayFlipped = false;

  function pieceImagePath(color, type) {
    return 'assets/pieces/' + pieceSet + '/' + color + type.toUpperCase() + '.svg';
  }

  function updateSquare(square) {
    var el = squareEls[square];
    if (!el) return;

    var piece = game.get(square);
    el.classList.remove('piece-w', 'piece-b');
    el.style.backgroundImage = '';

    if (!piece) {
      el.textContent = '';
      return;
    }

    el.classList.add(piece.color === 'w' ? 'piece-w' : 'piece-b');

    if (pieceSet === 'unicode') {
      el.textContent = GLYPHS[piece.color][piece.type];
    } else {
      el.textContent = '';
      el.style.backgroundImage = 'url(' + pieceImagePath(piece.color, piece.type) + ')';
    }
  }

  function renderAll() {
    for (var sq in squareEls) {
      if (squareEls.hasOwnProperty(sq)) updateSquare(sq);
    }
  }

  function buildBoardDOM(flipped) {
    boardEl.innerHTML = '';
    squareEls = {};

    var files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    var ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    if (flipped) {
      files = files.slice().reverse();
      ranks = ranks.slice().reverse();
    }

    for (var ri = 0; ri < 8; ri++) {
      var rank = ranks[ri];
      for (var fi = 0; fi < 8; fi++) {
        var file = files[fi];
        var square = file + rank;
        var fileIndex = file.charCodeAt(0) - 97;
        var isLight = (fileIndex + rank) % 2 === 0;

        var el = document.createElement('div');
        el.className = 'square ' + (isLight ? 'light' : 'dark');
        el.setAttribute('data-square', square);
        el.setAttribute('data-file', file);
        el.setAttribute('data-rank', String(rank));
        el.addEventListener('click', onSquareClick);

        boardEl.appendChild(el);
        squareEls[square] = el;
      }
    }
  }

  function clearHint() {
    if (hintSquare) {
      var el = squareEls[hintSquare];
      if (el) el.classList.remove('hint');
      hintSquare = null;
    }
  }

  function clearSelection() {
    clearHint();
    if (selectedSquare) {
      var el = squareEls[selectedSquare];
      if (el) el.classList.remove('selected');
    }
    for (var i = 0; i < highlightedTargets.length; i++) {
      var t = squareEls[highlightedTargets[i]];
      if (t) {
        t.classList.remove('target');
        t.classList.remove('capture');
      }
    }
    highlightedTargets = [];
    selectedSquare = null;
  }

  function clearLastMove() {
    for (var i = 0; i < lastMoveSquares.length; i++) {
      var el = squareEls[lastMoveSquares[i]];
      if (el) el.classList.remove('last-move');
    }
    lastMoveSquares = [];
  }

  function markLastMove(from, to) {
    clearLastMove();
    lastMoveSquares = [from, to];
    for (var i = 0; i < lastMoveSquares.length; i++) {
      var el = squareEls[lastMoveSquares[i]];
      if (el) el.classList.add('last-move');
    }
  }

  function clearCheckHighlight() {
    if (checkSquare) {
      var el = squareEls[checkSquare];
      if (el) el.classList.remove('in-check');
      checkSquare = null;
    }
  }

  function markCheckIfAny() {
    clearCheckHighlight();
    if (!game.in_check() || game.game_over()) return;

    var turnColor = game.turn();
    var board = game.board();
    var files = 'abcdefgh';

    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var piece = board[r][f];
        if (piece && piece.type === 'k' && piece.color === turnColor) {
          checkSquare = files.charAt(f) + (8 - r);
        }
      }
    }

    if (checkSquare) {
      var el = squareEls[checkSquare];
      if (el) el.classList.add('in-check');
    }
  }

  function selectSquare(square) {
    clearSelection();
    selectedSquare = square;

    var el = squareEls[square];
    if (el) el.classList.add('selected');

    var moves = game.moves({ square: square, verbose: true });
    for (var i = 0; i < moves.length; i++) {
      var to = moves[i].to;
      var target = squareEls[to];
      if (!target) continue;

      target.classList.add('target');
      if (moves[i].flags.indexOf('c') !== -1 || moves[i].flags.indexOf('e') !== -1) {
        target.classList.add('capture');
      }
      highlightedTargets.push(to);
    }
  }

  function handleSpecialSquares(moveObj) {
    if (moveObj.flags.indexOf('e') !== -1) {
      var capturedRank = moveObj.color === 'w'
        ? parseInt(moveObj.to.charAt(1), 10) - 1
        : parseInt(moveObj.to.charAt(1), 10) + 1;
      updateSquare(moveObj.to.charAt(0) + capturedRank);
    } else if (moveObj.flags.indexOf('k') !== -1) {
      var rank = moveObj.color === 'w' ? '1' : '8';
      updateSquare('h' + rank);
      updateSquare('f' + rank);
    } else if (moveObj.flags.indexOf('q') !== -1) {
      var rank2 = moveObj.color === 'w' ? '1' : '8';
      updateSquare('a' + rank2);
      updateSquare('d' + rank2);
    }
  }

  function applyMove(from, to, promotion) {
    var moveObj = game.move({ from: from, to: to, promotion: promotion || undefined });
    if (!moveObj) return;

    updateSquare(from);
    updateSquare(to);
    handleSpecialSquares(moveObj);
    markLastMove(from, to);
    markCheckIfAny();
    refreshStatus();

    if (!gameOverFlag && mode === 'computer' && game.turn() !== humanColor) {
      scheduleAIMove();
    }
  }

  function commitMove(from, to, promotion) {
    if (appMode === 'puzzle') {
      attemptPuzzleMove(from, to, promotion);
    } else {
      applyMove(from, to, promotion);
    }
  }

  function tryMove(from, to) {
    var piece = game.get(from);
    var needsPromotion = piece && piece.type === 'p' &&
      ((piece.color === 'w' && to.charAt(1) === '8') ||
       (piece.color === 'b' && to.charAt(1) === '1'));

    clearSelection();

    if (needsPromotion) {
      pendingPromotion = { from: from, to: to };
      promotionEl.hidden = false;
      return;
    }

    commitMove(from, to, null);
  }

  function onSquareClick(e) {
    var square = e.currentTarget.getAttribute('data-square');
    if (pendingPromotion) return;

    if (appMode === 'puzzle') {
      if (puzzleBusy || !currentPuzzle) return;
    } else {
      if (gameOverFlag || aiThinking) return;
      if (mode === 'computer' && game.turn() !== humanColor) return;
    }

    if (selectedSquare === null) {
      var piece = game.get(square);
      if (piece && piece.color === game.turn()) selectSquare(square);
      return;
    }

    if (square === selectedSquare) {
      clearSelection();
      return;
    }

    if (highlightedTargets.indexOf(square) !== -1) {
      tryMove(selectedSquare, square);
      return;
    }

    var other = game.get(square);
    if (other && other.color === game.turn()) {
      selectSquare(square);
    } else {
      clearSelection();
    }
  }

  function onPromotionChoice(e) {
    var pieceType = e.currentTarget.getAttribute('data-piece');
    var pm = pendingPromotion;
    pendingPromotion = null;
    promotionEl.hidden = true;
    if (pm) commitMove(pm.from, pm.to, pieceType);
  }

  function scheduleAIMove() {
    aiThinking = true;
    statusEl.textContent = 'Thinking…';

    setTimeout(function () {
      if (appMode !== 'play') {
        aiThinking = false;
        return;
      }

      var best = KindleChessAI.findBestMove(game, difficulty.depth, difficulty.random);
      aiThinking = false;

      if (best) {
        var moveObj = game.move(best);
        updateSquare(moveObj.from);
        updateSquare(moveObj.to);
        handleSpecialSquares(moveObj);
        markLastMove(moveObj.from, moveObj.to);
        markCheckIfAny();
      }
      refreshStatus();
    }, 50);
  }

  function refreshStatus() {
    gameOverFlag = game.game_over();
    var text;

    if (game.in_checkmate()) {
      text = (game.turn() === 'w' ? 'Black' : 'White') + ' wins by checkmate';
    } else if (game.in_stalemate()) {
      text = 'Draw by stalemate';
    } else if (game.in_threefold_repetition()) {
      text = 'Draw by repetition';
    } else if (game.insufficient_material()) {
      text = 'Draw — insufficient material';
    } else if (game.in_draw()) {
      text = 'Draw';
    } else {
      text = (game.turn() === 'w' ? 'White' : 'Black') + ' to move';
      if (game.in_check()) text += ' — check';
    }

    statusEl.textContent = text;
  }

  function updateControlVisibility() {
    var isComputer = mode === 'computer';
    difficultyLabel.style.display = isComputer ? '' : 'none';
    sideLabel.style.display = isComputer ? '' : 'none';
  }

  function newGame() {
    game.reset();
    clearSelection();
    clearLastMove();
    clearCheckHighlight();
    pendingPromotion = null;
    promotionEl.hidden = true;
    aiThinking = false;
    gameOverFlag = false;

    var flipped = mode === 'computer' && humanColor === 'b';
    buildBoardDOM(flipped);
    renderAll();
    refreshStatus();

    if (mode === 'computer' && humanColor === 'b' && !gameOverFlag) {
      scheduleAIMove();
    }
  }

  function undo() {
    if (aiThinking) return;
    pendingPromotion = null;
    promotionEl.hidden = true;
    clearSelection();

    var undone = game.undo();
    if (!undone) return;

    if (mode === 'computer' && game.turn() !== humanColor) {
      game.undo();
    }

    clearLastMove();
    clearCheckHighlight();
    renderAll();
    markCheckIfAny();
    refreshStatus();
  }

  function playUciMove(uci) {
    var from = uci.slice(0, 2);
    var to = uci.slice(2, 4);
    var promotion = uci.length > 4 ? uci.slice(4, 5) : undefined;
    var moveObj = game.move({ from: from, to: to, promotion: promotion });
    if (!moveObj) return null;

    updateSquare(from);
    updateSquare(to);
    handleSpecialSquares(moveObj);
    return moveObj;
  }

  function loadPuzzle(index) {
    if (typeof PUZZLES === 'undefined' || PUZZLES.length === 0) {
      statusEl.textContent = 'No puzzles available.';
      return;
    }

    puzzleIndex = ((index % PUZZLES.length) + PUZZLES.length) % PUZZLES.length;
    currentPuzzle = PUZZLES[puzzleIndex];
    puzzleBusy = false;
    pendingPromotion = null;
    promotionEl.hidden = true;
    clearSelection();
    clearLastMove();
    clearCheckHighlight();

    game.load(currentPuzzle.fen);
    var setupMove = playUciMove(currentPuzzle.moves[0]);
    puzzleMoveIndex = 1;

    var solverColor = game.turn();
    buildBoardDOM(solverColor === 'b');
    renderAll();
    if (setupMove) markLastMove(setupMove.from, setupMove.to);
    markCheckIfAny();

    statusEl.textContent = 'Puzzle rated ~' + currentPuzzle.rating + ' — find ' +
      (solverColor === 'w' ? 'White’s' : 'Black’s') + ' best move';

    try { localStorage.setItem('kindlechess-puzzle-index', String(puzzleIndex)); } catch (e) { /* storage unavailable */ }
  }

  function onPuzzleSolved() {
    statusEl.textContent = 'Solved! Rated ~' + currentPuzzle.rating;

    var solved = 0;
    try { solved = parseInt(localStorage.getItem('kindlechess-puzzles-solved'), 10) || 0; } catch (e) { /* storage unavailable */ }
    solved++;
    try { localStorage.setItem('kindlechess-puzzles-solved', String(solved)); } catch (e) { /* storage unavailable */ }
  }

  function attemptPuzzleMove(from, to, promotion) {
    clearSelection();
    if (!currentPuzzle || puzzleBusy) return;

    var uci = from + to + (promotion || '');
    var expected = currentPuzzle.moves[puzzleMoveIndex];

    if (uci !== expected) {
      statusEl.textContent = 'Not quite — try again';
      return;
    }

    var moveObj = game.move({ from: from, to: to, promotion: promotion || undefined });
    if (!moveObj) return;

    updateSquare(from);
    updateSquare(to);
    handleSpecialSquares(moveObj);
    markLastMove(from, to);
    markCheckIfAny();
    puzzleMoveIndex++;

    if (puzzleMoveIndex >= currentPuzzle.moves.length) {
      onPuzzleSolved();
      return;
    }

    statusEl.textContent = 'Correct!';
    puzzleBusy = true;

    setTimeout(function () {
      if (appMode !== 'puzzle') return;

      var replyMove = playUciMove(currentPuzzle.moves[puzzleMoveIndex]);
      puzzleMoveIndex++;
      if (replyMove) {
        markLastMove(replyMove.from, replyMove.to);
        markCheckIfAny();
      }
      puzzleBusy = false;

      if (puzzleMoveIndex >= currentPuzzle.moves.length) {
        onPuzzleSolved();
      } else {
        statusEl.textContent = 'Your move';
      }
    }, 450);
  }

  function showHint() {
    if (appMode !== 'puzzle' || !currentPuzzle || puzzleBusy) return;
    var expected = currentPuzzle.moves[puzzleMoveIndex];
    if (!expected) return;

    clearHint();
    hintSquare = expected.slice(0, 2);
    var el = squareEls[hintSquare];
    if (el) el.classList.add('hint');
    statusEl.textContent = 'Hint: look at ' + hintSquare;
  }

  function enterPuzzleMode() {
    savedPlayFen = game.fen();
    savedPlayFlipped = mode === 'computer' && humanColor === 'b';
    appMode = 'puzzle';
    playActionsEl.hidden = true;
    puzzleActionsEl.hidden = false;

    var startIndex = puzzleIndex;
    try {
      var saved = parseInt(localStorage.getItem('kindlechess-puzzle-index'), 10);
      if (!isNaN(saved)) startIndex = saved;
    } catch (e) { /* storage unavailable */ }

    loadPuzzle(startIndex);
  }

  function exitPuzzleMode() {
    appMode = 'play';
    currentPuzzle = null;
    puzzleBusy = false;
    puzzleActionsEl.hidden = true;
    playActionsEl.hidden = false;

    clearSelection();
    clearLastMove();
    clearCheckHighlight();
    pendingPromotion = null;
    promotionEl.hidden = true;

    if (savedPlayFen) game.load(savedPlayFen);
    buildBoardDOM(savedPlayFlipped);
    renderAll();
    refreshStatus();
  }

  function openSettings() {
    appMainEl.hidden = true;
    settingsPanelEl.hidden = false;
  }

  function closeSettings() {
    settingsPanelEl.hidden = true;
    appMainEl.hidden = false;
  }

  function flashGhostClear() {
    var root = document.documentElement;
    root.classList.add('ghost-flash');
    setTimeout(function () {
      root.classList.remove('ghost-flash');
    }, 180);
  }

  function applyTheme(name) {
    document.documentElement.setAttribute('data-theme', name);

    var options = themeToggleBtn.querySelectorAll('.toggle-option');
    for (var i = 0; i < options.length; i++) {
      if (options[i].getAttribute('data-value') === name) {
        options[i].classList.add('active');
      } else {
        options[i].classList.remove('active');
      }
    }

    try { localStorage.setItem('kindlechess-theme', name); } catch (e) { /* storage unavailable */ }
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('kindlechess-theme'); } catch (e) { /* storage unavailable */ }

    if (saved === 'light' || saved === 'dark') {
      applyTheme(saved);
      return;
    }

    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }

  function applyPieceSet(name, skipRender) {
    pieceSet = name;
    pieceSetSelect.value = name;
    try { localStorage.setItem('kindlechess-pieceset', name); } catch (e) { /* storage unavailable */ }
    if (!skipRender) renderAll();
  }

  function initPieceSet() {
    var saved = null;
    try { saved = localStorage.getItem('kindlechess-pieceset'); } catch (e) { /* storage unavailable */ }

    if (saved === 'unicode' || saved === 'cburnett' || saved === 'staunty') {
      applyPieceSet(saved, true);
    } else {
      pieceSet = pieceSetSelect.value;
    }
  }

  function init() {
    boardEl = document.getElementById('board');
    statusEl = document.getElementById('status');
    themeToggleBtn = document.getElementById('theme-toggle');
    modeSelect = document.getElementById('mode-select');
    difficultySelect = document.getElementById('difficulty-select');
    sideSelect = document.getElementById('side-select');
    pieceSetSelect = document.getElementById('pieceset-select');
    difficultyLabel = document.getElementById('difficulty-label');
    sideLabel = document.getElementById('side-label');
    promotionEl = document.getElementById('promotion');
    newGameBtn = document.getElementById('new-game');
    undoBtn = document.getElementById('undo');

    appMainEl = document.getElementById('app-main');
    settingsPanelEl = document.getElementById('settings-panel');
    playActionsEl = document.getElementById('play-actions');
    puzzleActionsEl = document.getElementById('puzzle-actions');
    openPuzzlesBtn = document.getElementById('open-puzzles');
    openSettingsBtn = document.getElementById('open-settings');
    closeSettingsBtn = document.getElementById('close-settings');
    puzzleHintBtn = document.getElementById('puzzle-hint');
    puzzleRetryBtn = document.getElementById('puzzle-retry');
    puzzleNextBtn = document.getElementById('puzzle-next');
    puzzleBackBtn = document.getElementById('puzzle-back');
    refreshScreenBtn = document.getElementById('refresh-screen');

    initTheme();
    themeToggleBtn.addEventListener('click', function (e) {
      var value = e.target.getAttribute('data-value');
      if (value === 'light' || value === 'dark') applyTheme(value);
    });

    difficulty = DIFFICULTY_LEVELS[difficultySelect.value] || difficulty;

    modeSelect.addEventListener('change', function () {
      mode = modeSelect.value;
      updateControlVisibility();
      newGame();
    });

    difficultySelect.addEventListener('change', function () {
      difficulty = DIFFICULTY_LEVELS[difficultySelect.value] || difficulty;
    });

    sideSelect.addEventListener('change', function () {
      humanColor = sideSelect.value;
      newGame();
    });

    initPieceSet();
    pieceSetSelect.addEventListener('change', function () {
      applyPieceSet(pieceSetSelect.value);
    });

    newGameBtn.addEventListener('click', newGame);
    undoBtn.addEventListener('click', undo);

    openPuzzlesBtn.addEventListener('click', enterPuzzleMode);
    openSettingsBtn.addEventListener('click', openSettings);
    closeSettingsBtn.addEventListener('click', closeSettings);
    refreshScreenBtn.addEventListener('click', flashGhostClear);

    puzzleHintBtn.addEventListener('click', showHint);
    puzzleRetryBtn.addEventListener('click', function () { loadPuzzle(puzzleIndex); });
    puzzleNextBtn.addEventListener('click', function () { loadPuzzle(puzzleIndex + 1); });
    puzzleBackBtn.addEventListener('click', exitPuzzleMode);

    var promoButtons = promotionEl.querySelectorAll('button');
    for (var i = 0; i < promoButtons.length; i++) {
      promoButtons[i].addEventListener('click', onPromotionChoice);
    }

    updateControlVisibility();
    newGame();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

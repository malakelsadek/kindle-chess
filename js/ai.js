/* Kindle Chess AI — plain ES5, small negamax + alpha-beta search.
   Operates directly on a chess.js Chess() instance via move()/undo(). */
var KindleChessAI = (function () {
  var MATE_SCORE = 100000;

  var PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  var CENTER_BONUS = [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 1, 2, 3, 3, 2, 1, 0],
    [0, 1, 2, 3, 3, 2, 1, 0],
    [0, 1, 2, 2, 2, 2, 1, 0],
    [0, 1, 1, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ];

  function evaluate(game) {
    var board = game.board();
    var score = 0;
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var piece = board[r][f];
        if (!piece) continue;
        var value = PIECE_VALUES[piece.type] + CENTER_BONUS[r][f] * 2;
        score += piece.color === 'w' ? value : -value;
      }
    }
    return score;
  }

  function isCapture(move) {
    return move.flags.indexOf('c') !== -1 || move.flags.indexOf('e') !== -1;
  }

  function orderMoves(moves) {
    moves.sort(function (a, b) {
      var av = isCapture(a) ? 1 : 0;
      var bv = isCapture(b) ? 1 : 0;
      return bv - av;
    });
  }

  function negamax(game, depth, alpha, beta) {
    if (game.game_over()) {
      if (game.in_checkmate()) return -MATE_SCORE;
      return 0;
    }
    if (depth === 0) {
      return game.turn() === 'w' ? evaluate(game) : -evaluate(game);
    }

    var moves = game.moves({ verbose: true });
    orderMoves(moves);

    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      var score = -negamax(game, depth - 1, -beta, -alpha);
      game.undo();

      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function findBestMove(game, depth, randomFactor) {
    var moves = game.moves({ verbose: true });
    if (moves.length === 0) return null;

    if (randomFactor && Math.random() < randomFactor) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    orderMoves(moves);

    var bestMove = moves[0];
    var bestScore = -Infinity;
    var alpha = -Infinity;
    var beta = Infinity;

    for (var i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      var score = -negamax(game, depth - 1, -beta, -alpha);
      game.undo();

      if (score > bestScore) {
        bestScore = score;
        bestMove = moves[i];
      }
      if (bestScore > alpha) alpha = bestScore;
    }

    return bestMove;
  }

  return { findBestMove: findBestMove };
})();

(function (root, factory) {
  const chess = factory();
  if (typeof module === "object" && module.exports) module.exports = chess;
  if (root) root.ChessRules = chess;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const files = "abcdefgh";

  function initialState() {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    const back = "rnbqkbnr";
    for (let col = 0; col < 8; col++) {
      board[0][col] = { type: back[col], color: "b" };
      board[1][col] = { type: "p", color: "b" };
      board[6][col] = { type: "p", color: "w" };
      board[7][col] = { type: back[col], color: "w" };
    }
    return {
      board,
      turn: "w",
      castling: { wk: true, wq: true, bk: true, bq: true },
      enPassant: null,
      halfmove: 0,
      fullmove: 1
    };
  }

  function copyState(state) {
    return {
      board: state.board.map(row => row.map(piece => piece && { ...piece })),
      turn: state.turn,
      castling: { ...state.castling },
      enPassant: state.enPassant && { ...state.enPassant },
      halfmove: state.halfmove,
      fullmove: state.fullmove
    };
  }

  function inside(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function locateKing(board, color) {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];
        if (piece?.type === "k" && piece.color === color) return { row, col };
      }
    }
    return null;
  }

  function isSquareAttacked(board, row, col, byColor) {
    const pawnRow = row + (byColor === "w" ? 1 : -1);
    for (const pawnCol of [col - 1, col + 1]) {
      if (inside(pawnRow, pawnCol)) {
        const piece = board[pawnRow][pawnCol];
        if (piece?.color === byColor && piece.type === "p") return true;
      }
    }

    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      const r = row + dr, c = col + dc;
      if (inside(r, c) && board[r][c]?.color === byColor && board[r][c].type === "n") return true;
    }

    for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
      let r = row + dr, c = col + dc, distance = 1;
      while (inside(r, c)) {
        const piece = board[r][c];
        if (piece) {
          if (piece.color === byColor && (
            piece.type === "q" ||
            (piece.type === "k" && distance === 1) ||
            (piece.type === "r" && (dr === 0 || dc === 0)) ||
            (piece.type === "b" && dr !== 0 && dc !== 0)
          )) return true;
          break;
        }
        r += dr; c += dc; distance++;
      }
    }
    return false;
  }

  function isInCheck(board, color) {
    const king = locateKing(board, color);
    return king ? isSquareAttacked(board, king.row, king.col, color === "w" ? "b" : "w") : true;
  }

  function pseudoMoves(state, row, col) {
    const piece = state.board[row][col];
    if (!piece) return [];
    const moves = [];
    const add = (toRow, toCol, extra = {}) => {
      if (!inside(toRow, toCol)) return;
      const target = state.board[toRow][toCol];
      if (target?.color === piece.color || target?.type === "k") return;
      moves.push({ from: { row, col }, to: { row: toRow, col: toCol }, ...extra });
    };

    if (piece.type === "p") {
      const direction = piece.color === "w" ? -1 : 1;
      const startRow = piece.color === "w" ? 6 : 1;
      const promotionRow = piece.color === "w" ? 0 : 7;
      const oneRow = row + direction;
      if (inside(oneRow, col) && !state.board[oneRow][col]) {
        add(oneRow, col, oneRow === promotionRow ? { promotion: true } : {});
        const twoRow = row + direction * 2;
        if (row === startRow && !state.board[twoRow][col]) add(twoRow, col, { doublePawn: true });
      }
      for (const targetCol of [col - 1, col + 1]) {
        const target = inside(oneRow, targetCol) && state.board[oneRow][targetCol];
        if (target?.color !== piece.color && target) add(oneRow, targetCol, oneRow === promotionRow ? { promotion: true } : {});
        else if (state.enPassant?.row === oneRow && state.enPassant.col === targetCol) add(oneRow, targetCol, { enPassant: true });
      }
      return moves;
    }

    if (piece.type === "n") {
      for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(row + dr, col + dc);
      return moves;
    }

    const directions = [];
    if (piece.type === "b" || piece.type === "q") directions.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
    if (piece.type === "r" || piece.type === "q") directions.push([-1, 0], [1, 0], [0, -1], [0, 1]);
    if (piece.type === "k") directions.push([-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]);
    for (const [dr, dc] of directions) {
      let toRow = row + dr, toCol = col + dc;
      while (inside(toRow, toCol)) {
        const target = state.board[toRow][toCol];
        if (target?.color === piece.color || target?.type === "k") break;
        add(toRow, toCol);
        if (target || piece.type === "k") break;
        toRow += dr; toCol += dc;
      }
    }

    if (piece.type === "k" && row === (piece.color === "w" ? 7 : 0) && col === 4 && !isInCheck(state.board, piece.color)) {
      const homeRow = row;
      const enemyColor = piece.color === "w" ? "b" : "w";
      for (const side of ["k", "q"]) {
        if (!state.castling[piece.color + side]) continue;
        const rookCol = side === "k" ? 7 : 0;
        const rook = state.board[homeRow][rookCol];
        const emptyCols = side === "k" ? [5, 6] : [1, 2, 3];
        const safeCols = side === "k" ? [5, 6] : [3, 2];
        if (rook?.type !== "r" || rook.color !== piece.color || emptyCols.some(c => state.board[homeRow][c])) continue;
        if (safeCols.some(c => isSquareAttacked(state.board, homeRow, c, enemyColor))) continue;
        moves.push({ from: { row, col }, to: { row: homeRow, col: side === "k" ? 6 : 2 }, castle: side });
      }
    }
    return moves;
  }

  function playMove(state, move, promotion = "q") {
    const next = copyState(state);
    const { from, to } = move;
    const piece = next.board[from.row][from.col];
    const captured = move.enPassant ? next.board[from.row][to.col] : next.board[to.row][to.col];

    next.board[from.row][from.col] = null;
    if (move.enPassant) next.board[from.row][to.col] = null;
    next.board[to.row][to.col] = { ...piece, type: move.promotion ? promotion : piece.type };

    if (move.castle) {
      const rookFrom = move.castle === "k" ? 7 : 0;
      const rookTo = move.castle === "k" ? 5 : 3;
      next.board[from.row][rookTo] = next.board[from.row][rookFrom];
      next.board[from.row][rookFrom] = null;
    }

    if (piece.type === "k") {
      next.castling[piece.color + "k"] = false;
      next.castling[piece.color + "q"] = false;
    }
    if (piece.type === "r" && from.row === (piece.color === "w" ? 7 : 0)) {
      if (from.col === 0) next.castling[piece.color + "q"] = false;
      if (from.col === 7) next.castling[piece.color + "k"] = false;
    }
    if (captured?.type === "r") {
      const capturedColor = captured.color;
      const homeRow = capturedColor === "w" ? 7 : 0;
      if (to.row === homeRow && to.col === 0) next.castling[capturedColor + "q"] = false;
      if (to.row === homeRow && to.col === 7) next.castling[capturedColor + "k"] = false;
    }

    next.enPassant = move.doublePawn ? { row: (from.row + to.row) / 2, col: from.col } : null;
    next.halfmove = piece.type === "p" || captured ? 0 : state.halfmove + 1;
    if (state.turn === "b") next.fullmove++;
    next.turn = state.turn === "w" ? "b" : "w";
    return next;
  }

  function legalMoves(state, from) {
    const moves = [];
    const color = state.turn;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (from && (from.row !== row || from.col !== col)) continue;
        const piece = state.board[row][col];
        if (!piece || piece.color !== color) continue;
        for (const move of pseudoMoves(state, row, col)) {
          if (!isInCheck(playMove(state, move).board, color)) moves.push(move);
        }
      }
    }
    return moves;
  }

  function positionStatus(state) {
    const moves = legalMoves(state);
    const check = isInCheck(state.board, state.turn);
    if (moves.length === 0) return { over: true, check, result: check ? "checkmate" : "stalemate" };
    if (state.halfmove >= 100) return { over: true, check, result: "fifty-move" };

    const pieces = state.board.flat().filter(Boolean);
    const nonKings = pieces.filter(piece => piece.type !== "k");
    const insufficient = nonKings.length === 0 ||
      (nonKings.length === 1 && ["b", "n"].includes(nonKings[0].type)) ||
      (nonKings.every(piece => piece.type === "b") &&
        new Set(state.board.flatMap((row, r) => row.map((piece, c) => piece?.type === "b" ? (r + c) % 2 : null).filter(value => value !== null))).size === 1);
    if (insufficient) return { over: true, check, result: "insufficient" };
    return { over: false, check, result: null };
  }

  function squareName(square) {
    return files[square.col] + (8 - square.row);
  }

  function toFEN(state) {
    const rows = state.board.map(row => {
      let fen = "", empty = 0;
      for (const piece of row) {
        if (!piece) empty++;
        else {
          if (empty) fen += empty;
          empty = 0;
          fen += piece.color === "w" ? piece.type.toUpperCase() : piece.type;
        }
      }
      if (empty) fen += empty;
      return fen;
    }).join("/");
    const castling = ["wk", "wq", "bk", "bq"].filter(key => state.castling[key]).map(key => ({ wk: "K", wq: "Q", bk: "k", bq: "q" })[key]).join("") || "-";
    const ep = state.enPassant ? squareName(state.enPassant) : "-";
    return `${rows} ${state.turn} ${castling} ${ep} ${state.halfmove} ${state.fullmove}`;
  }

  function fromFEN(fen) {
    const [placement, turn, rights, ep, halfmove = "0", fullmove = "1"] = fen.trim().split(/\s+/);
    const rows = placement.split("/");
    if (rows.length !== 8 || !["w", "b"].includes(turn)) throw new Error("FEN tidak valid");
    const board = rows.map(row => {
      const squares = [];
      for (const char of row) {
        if (/[1-8]/.test(char)) squares.push(...Array(Number(char)).fill(null));
        else if (/[prnbqkPRNBQK]/.test(char)) squares.push({ type: char.toLowerCase(), color: char === char.toUpperCase() ? "w" : "b" });
        else throw new Error("FEN tidak valid");
      }
      if (squares.length !== 8) throw new Error("FEN tidak valid");
      return squares;
    });
    const square = ep === "-" ? null : { row: 8 - Number(ep[1]), col: files.indexOf(ep[0]) };
    return {
      board, turn,
      castling: { wk: rights.includes("K"), wq: rights.includes("Q"), bk: rights.includes("k"), bq: rights.includes("q") },
      enPassant: square, halfmove: Number(halfmove), fullmove: Number(fullmove)
    };
  }

  return { initialState, copyState, isInCheck, legalMoves, playMove, positionStatus, squareName, toFEN, fromFEN };
});

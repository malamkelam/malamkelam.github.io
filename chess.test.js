"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Chess = require("./chess.js");

function move(state, from, to, promotion) {
  const parse = square => ({ row: 8 - Number(square[1]), col: square.charCodeAt(0) - 97 });
  const start = parse(from);
  const end = parse(to);
  const found = Chess.legalMoves(state, start).find(candidate =>
    candidate.to.row === end.row && candidate.to.col === end.col
  );
  assert.ok(found, `Expected legal move ${from}-${to}`);
  return Chess.playMove(state, found, promotion);
}

test("the initial position has 20 legal moves and serializes to standard FEN", () => {
  const state = Chess.initialState();
  assert.equal(Chess.legalMoves(state).length, 20);
  assert.equal(Chess.toFEN(state), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
});

test("legal moves prevent a king from moving into check", () => {
  const state = Chess.fromFEN("4r1k1/8/8/8/8/8/8/4K3 w - - 0 1");
  assert.equal(Chess.legalMoves(state, { row: 7, col: 4 }).some(candidate => candidate.to.row === 6 && candidate.to.col === 4), false);
});

test("castling moves the rook and is blocked when the king crosses an attacked square", () => {
  const open = Chess.fromFEN("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const castle = Chess.legalMoves(open, { row: 7, col: 4 }).find(candidate => candidate.castle === "k");
  assert.ok(castle);
  const afterCastle = Chess.playMove(open, castle);
  assert.equal(afterCastle.board[7][6].type, "k");
  assert.equal(afterCastle.board[7][5].type, "r");

  const attacked = Chess.fromFEN("4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1");
  assert.equal(Chess.legalMoves(attacked, { row: 7, col: 4 }).some(candidate => candidate.castle === "k"), false);
});

test("en passant captures the adjacent pawn and updates the position", () => {
  let state = Chess.initialState();
  state = move(state, "e2", "e4");
  state = move(state, "a7", "a6");
  state = move(state, "e4", "e5");
  state = move(state, "d7", "d5");
  assert.ok(Chess.legalMoves(state, { row: 3, col: 4 }).some(candidate => candidate.enPassant));
  state = move(state, "e5", "d6");
  assert.equal(state.board[3][3], null);
  assert.equal(state.board[2][3].type, "p");
});

test("a pawn can promote to a selected piece", () => {
  let state = Chess.fromFEN("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
  state = move(state, "a7", "a8", "n");
  assert.deepEqual(state.board[0][0], { type: "n", color: "w" });
});

test("checkmate and stalemate are distinguished", () => {
  let state = Chess.fromFEN("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1");
  state = move(state, "f7", "f8");
  assert.deepEqual(Chess.positionStatus(state), { over: true, check: true, result: "checkmate" });
  const stalemate = Chess.fromFEN("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert.deepEqual(Chess.positionStatus(stalemate), { over: true, check: false, result: "stalemate" });
});

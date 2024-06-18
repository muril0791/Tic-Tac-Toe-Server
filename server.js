import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { nanoid } from "nanoid";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Substitua pela URL do seu cliente
    methods: ["GET", "POST"],
  },
});

app.use(
  cors({
    origin: "http://localhost:5173", // Substitua pela URL do seu cliente
  })
);

const port = process.env.PORT || 3000;

let players = {};
let rooms = {};

const checkWin = (board) => {
  const winningCombos = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const combo of winningCombos) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
};

const checkDraw = (board) => {
  return board.every((cell) => cell !== null);
};

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  socket.on("login", (username) => {
    if (
      !players[socket.id] &&
      (username === "Player1" || username === "Player2")
    ) {
      players[socket.id] = { username };
      socket.emit("logged_in", { username, rooms });
    } else {
      socket.emit("login_error", "Invalid username or already logged in.");
    }
  });

  socket.on("create_room", (roomName) => {
    if (!rooms[roomName]) {
      rooms[roomName] = {
        id: nanoid(),
        players: {},
        board: Array(9).fill(null),
        inProgress: false,
        currentPlayer: null,
        history: [],
        messages: [],
        playAgainVotes: 0,
      };
      io.emit("room_list", rooms);
    }
  });

  socket.on("join_room", (roomName) => {
    if (rooms[roomName] && Object.keys(rooms[roomName].players).length < 2) {
      rooms[roomName].players[socket.id] = {
        symbol: Object.keys(rooms[roomName].players).length === 0 ? "X" : "O",
        ready: false,
      };
      socket.join(roomName);
      io.to(roomName).emit("room_update", rooms[roomName]);
      if (Object.keys(rooms[roomName].players).length === 2) {
        startGameCountdown(roomName);
      }
    }
  });

  socket.on("move", ({ roomName, index }) => {
    const room = rooms[roomName];
    if (
      room &&
      room.board[index] === null &&
      room.currentPlayer === socket.id
    ) {
      room.board[index] = room.players[socket.id].symbol;
      io.to(roomName).emit("board_update", room.board);

      const winner = checkWin(room.board);
      if (winner) {
        room.history.push({ board: [...room.board], winner });
        io.to(roomName).emit("game_end", { winner });
        room.board = Array(9).fill(null);
        room.inProgress = false;
      } else if (checkDraw(room.board)) {
        room.history.push({ board: [...room.board], winner: null });
        io.to(roomName).emit("game_end", { winner: null });
        room.board = Array(9).fill(null);
        room.inProgress = false;
      } else {
        room.currentPlayer = Object.keys(room.players).find(
          (playerId) => playerId !== socket.id
        );
        io.to(roomName).emit("turn_update", room.currentPlayer);
      }
    }
  });

  socket.on("play_again", (roomName) => {
    const room = rooms[roomName];
    if (room) {
      room.playAgainVotes += 1;
      if (room.playAgainVotes === 2) {
        room.board = Array(9).fill(null);
        room.inProgress = false;
        room.playAgainVotes = 0;
        io.to(roomName).emit("board_update", room.board);
        io.to(roomName).emit("reset_game");
        startGameCountdown(roomName);
      } else {
        io.to(roomName).emit("wait_for_play_again");
      }
    }
  });

  socket.on("send_message", ({ roomName, message }) => {
    const room = rooms[roomName];
    if (room) {
      const player = players[socket.id].username;
      room.messages.push({ player, message });
      io.to(roomName).emit("message_update", room.messages);
    }
  });

  socket.on("leave_room", (roomName) => {
    const room = rooms[roomName];
    if (room) {
      delete room.players[socket.id];
      socket.leave(roomName);
      io.to(roomName).emit("room_update", room);
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomName];
        io.emit("room_list", rooms);
      }
    }
  });

  socket.on("disconnect", () => {
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomName).emit("room_update", room);
        if (Object.keys(room.players).length === 0) {
          delete rooms[roomName];
          io.emit("room_list", rooms);
        }
        break;
      }
    }
    delete players[socket.id];
    console.log("user disconnected:", socket.id);
  });
});

const startGameCountdown = (roomName) => {
  console.log(`Starting countdown for room: ${roomName}`);
  let countdown = 5;
  const countdownInterval = setInterval(() => {
    console.log(`Countdown for room ${roomName}: ${countdown}`);
    io.to(roomName).emit("countdown", countdown);
    countdown -= 1;
    if (countdown < 0) {
      clearInterval(countdownInterval);
      const room = rooms[roomName];
      room.inProgress = true;
      room.currentPlayer = Object.keys(room.players)[
        Math.floor(Math.random() * 2)
      ];
      io.to(roomName).emit("game_start", {
        startingPlayer: room.currentPlayer,
      });
      console.log(`Game started for room: ${roomName}`);
    }
  }, 1000);
};

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

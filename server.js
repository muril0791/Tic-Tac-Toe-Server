import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { nanoid } from "nanoid";
import auth from "basic-auth";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
  },
});

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
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

// Função de autenticação básica
const basicAuth = (req, res, next) => {
  const user = auth(req);
  if (user && user.name === "admin" && user.pass === "password") {
    return next();
  } else {
    res.set("WWW-Authenticate", 'Basic realm="example"');
    return res.status(401).send("Authentication required.");
  }
};

// Rota para visualizar logs ou informações do backend
app.get("/logs", basicAuth, (req, res) => {
  res.json({
    players,
    rooms,
    message: "Informações do servidor",
  });
});

app.get("/", (req, res) => {
  res.send("Backend is running");
});

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  socket.on("login", (username) => {
    console.log(`Login attempt by ${username}`);
    if (
      !players[socket.id] &&
      (username === "Player1" || username === "Player2")
    ) {
      players[socket.id] = { username };
      socket.emit("logged_in", { username, rooms });
      console.log(`User ${username} logged in with ID: ${socket.id}`);
    } else {
      socket.emit("login_error", "Invalid username or already logged in.");
      console.log(`Login error for user ${username}`);
    }
  });

  socket.on("create_room", (roomName) => {
    console.log(`Create room attempt: ${roomName}`);
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
      console.log(`Room created: ${roomName}`);
    }
  });

  socket.on("join_room", (roomName) => {
    console.log(`Join room attempt: ${roomName}`);
    if (rooms[roomName] && Object.keys(rooms[roomName].players).length < 2) {
      rooms[roomName].players[socket.id] = {
        symbol: Object.keys(rooms[roomName].players).length === 0 ? "X" : "O",
        ready: false,
      };
      socket.join(roomName);
      io.to(roomName).emit("room_update", rooms[roomName]);
      console.log(`User joined room: ${roomName}`);
      if (Object.keys(rooms[roomName].players).length === 2) {
        startGameCountdown(roomName);
      }
    }
  });

  socket.on("move", ({ roomName, index }) => {
    console.log(`Move attempt in room ${roomName}, index ${index}`);
    const room = rooms[roomName];
    if (
      room &&
      room.board[index] === null &&
      room.currentPlayer === socket.id
    ) {
      room.board[index] = room.players[socket.id].symbol;
      io.to(roomName).emit("board_update", room.board);
      console.log(`Move registered in room ${roomName}, index ${index}`);

      const winner = checkWin(room.board);
      if (winner) {
        room.history.push({ board: [...room.board], winner });
        io.to(roomName).emit("game_end", { winner });
        room.board = Array(9).fill(null);
        room.inProgress = false;
        console.log(`Game end in room ${roomName}, winner: ${winner}`);
      } else if (checkDraw(room.board)) {
        room.history.push({ board: [...room.board], winner: null });
        io.to(roomName).emit("game_end", { winner: null });
        room.board = Array(9).fill(null);
        room.inProgress = false;
        console.log(`Game end in room ${roomName}, draw`);
      } else {
        room.currentPlayer = Object.keys(room.players).find(
          (playerId) => playerId !== socket.id
        );
        io.to(roomName).emit("turn_update", room.currentPlayer);
        console.log(
          `Turn update in room ${roomName}, current player: ${room.currentPlayer}`
        );
      }
    }
  });

  socket.on("play_again", (roomName) => {
    console.log(`Play again attempt in room ${roomName}`);
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
        console.log(`Game reset in room ${roomName}`);
      } else {
        io.to(roomName).emit("wait_for_play_again");
        console.log(
          `Waiting for other player to play again in room ${roomName}`
        );
      }
    }
  });

  socket.on("send_message", ({ roomName, message }) => {
    console.log(`Message sent in room ${roomName}: ${message}`);
    const room = rooms[roomName];
    if (room) {
      const player = players[socket.id].username;
      room.messages.push({ player, message });
      io.to(roomName).emit("message_update", room.messages);
    }
  });

  socket.on("leave_room", (roomName) => {
    console.log(`Leave room attempt: ${roomName}`);
    const room = rooms[roomName];
    if (room) {
      delete room.players[socket.id];
      socket.leave(roomName);
      io.to(roomName).emit("room_update", room);
      console.log(`User left room: ${roomName}`);
      if (Object.keys(room.players).length === 0) {
        delete rooms[roomName];
        io.emit("room_list", rooms);
        console.log(`Room deleted: ${roomName}`);
      }
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomName in rooms) {
      const room = rooms[roomName];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(roomName).emit("room_update", room);
        if (Object.keys(room.players).length === 0) {
          delete rooms[roomName];
          io.emit("room_list", rooms);
          console.log(`Room deleted: ${roomName}`);
        }
        break;
      }
    }
    delete players[socket.id];
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

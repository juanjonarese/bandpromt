const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();

const registerSocketHandlers = require("./socket/bandprompt.socket");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
});

app.use(cors());
app.use(express.json());

// Frontend estático (bandprompt)
app.use(express.static(path.join(__dirname, "public")));

// Fallback: devuelve index.html para cualquier ruta no-API
app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

registerSocketHandlers(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`BandPrompt corriendo en http://localhost:${PORT}`);
});

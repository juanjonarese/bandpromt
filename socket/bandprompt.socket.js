/**
 * Socket.io handlers para BandPrompt.
 *
 * SINCRONIZACIÓN DE RELOJ (NTP):
 *   1. Cliente emite  sync_request  con clientSent = Date.now()
 *   2. Servidor responde sync_response { clientSent, serverTime }
 *   3. Cliente calcula offset y usa clockSync.serverNow() para timestamps precisos
 *
 * METRÓNOMO SERVER-SIDE:
 *   El director emite start_metronome con bpm, beatsPerMeasure y startAt (server ms).
 *   El servidor genera beats con scheduledTime preciso y los envía a toda la sala.
 *   Todos los clientes (director + miembros) reciben beats del servidor y usan
 *   AudioEngine.scheduleClick(scheduledTime, isDownbeat, clockSync) para audio.
 *
 * RELAY DE EVENTOS:
 *   state, setlist, songchange, countdown son retransmitidos por el servidor.
 *
 * SESIONES:
 *   Cada sesión es una sala de Socket.io identificada por el código de sesión.
 *   No requiere base de datos — todo en memoria.
 */

// Metrónomo activo por sala: roomName → { scheduler }
const activeMetronomes = new Map();

const METRO_LOOKAHEAD_MS = 25;
const METRO_SCHEDULE_AHEAD_MS = 300;

function _stopMetronome(roomName) {
  const metro = activeMetronomes.get(roomName);
  if (metro) {
    clearInterval(metro.scheduler);
    activeMetronomes.delete(roomName);
    console.log(`[metro] detenido en sala ${roomName}`);
  }
}

function registerBandpromptSocket(io) {
  io.on("connection", (socket) => {
    console.log(`[socket] conectado: ${socket.id}`);

    // ─── Sincronización de reloj NTP ──────────────────────────────────────
    socket.on("sync_request", (clientSent) => {
      socket.emit("sync_response", {
        clientSent,
        serverTime: Date.now(),
      });
    });

    // ─── Unirse a sesión ──────────────────────────────────────────────────
    socket.on("join_session", ({ code, role, name }, callback) => {
      const roomName = "bp-" + code.toUpperCase();
      socket.join(roomName);
      socket.data.roomName = roomName;
      socket.data.role = role || "member";
      socket.data.name = name || "Miembro";

      // Anunciar a los ya conectados
      socket.to(roomName).emit("member_joined", {
        id: socket.id,
        role: socket.data.role,
        name: socket.data.name,
      });

      // Pedir al director que reenvíe estado al nuevo miembro
      if ((socket.data.role || 'member') === 'member') {
        socket.to(roomName).emit("request_state", { newMemberId: socket.id });
      }

      const room = io.sockets.adapter.rooms.get(roomName);
      const clientCount = room ? room.size : 1;

      console.log(
        `[session] ${socket.id} (${role}) unido a ${roomName} — ${clientCount} cliente(s)`
      );

      callback?.({ success: true, clientCount });
    });

    // ─── Salir de sesión ──────────────────────────────────────────────────
    socket.on("leave_session", (callback) => {
      _leaveSession(socket);
      callback?.({ success: true });
    });

    // ─── Metrónomo server-side ────────────────────────────────────────────
    // El director llama start_metronome con { bpm, beatsPerMeasure, startAt }
    // donde startAt es el server-time (ms) del primer beat.
    socket.on("start_metronome", ({ bpm, beatsPerMeasure, startAt }, callback) => {
      const roomName = socket.data.roomName;
      if (!roomName) return callback?.({ error: "No estás en una sesión" });

      // Detener metrónomo previo si existe
      _stopMetronome(roomName);

      const msPerBeat = (60 / bpm) * 1000;
      let beatNumber = 0;
      // Si startAt no se proporcionó, comenzar con el lookahead estándar
      let nextBeatTime = startAt || Date.now() + METRO_SCHEDULE_AHEAD_MS;

      const scheduler = setInterval(() => {
        const horizon = Date.now() + METRO_SCHEDULE_AHEAD_MS;
        while (nextBeatTime < horizon) {
          io.to(roomName).emit("beat", {
            scheduledTime: nextBeatTime,
            beatNumber,
            isDownbeat: beatNumber % beatsPerMeasure === 0,
            bpm,
            beatsPerMeasure,
          });
          nextBeatTime += msPerBeat;
          beatNumber++;
        }
      }, METRO_LOOKAHEAD_MS);

      activeMetronomes.set(roomName, { scheduler });
      console.log(`[metro] iniciado en sala ${roomName} — ${bpm} bpm, ${beatsPerMeasure}/? — startAt offset: ${startAt ? startAt - Date.now() : 'inmediato'}ms`);
      callback?.({ success: true });
    });

    socket.on("stop_metronome", (callback) => {
      if (socket.data.roomName) {
        _stopMetronome(socket.data.roomName);
      }
      callback?.({ success: true });
    });

    // ─── Relay de eventos director → miembros ────────────────────────────
    // beat ya NO se retransmite — el servidor lo genera directamente.
    const relayEvents = ["state", "setlist", "songchange", "countdown", "request_state"];
    relayEvents.forEach((event) => {
      socket.on(event, (payload) => {
        if (socket.data.roomName) {
          socket.to(socket.data.roomName).emit(event, payload);
        }
      });
    });

    // ─── Desconexión ──────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[socket] desconectado: ${socket.id}`);
      _leaveSession(socket);
    });

    // ─── Helper ───────────────────────────────────────────────────────────
    function _leaveSession(sock) {
      if (!sock.data.roomName) return;
      const roomName = sock.data.roomName;
      sock.to(roomName).emit("member_left", {
        id: sock.id,
        role: sock.data.role,
      });
      sock.leave(roomName);
      const room = io.sockets.adapter.rooms.get(roomName);
      const count = room ? room.size : 0;
      console.log(
        `[session] ${sock.id} salió de ${roomName} — ${count} cliente(s)`
      );
      // Detener metrónomo si la sala quedó vacía
      if (count === 0) {
        _stopMetronome(roomName);
      }
      sock.data.roomName = null;
    }
  });
}

module.exports = registerBandpromptSocket;

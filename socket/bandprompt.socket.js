/**
 * Socket.io handlers para BandPrompt.
 *
 * SINCRONIZACIÓN DE RELOJ (NTP):
 *   1. Cliente emite  sync_request  con clientSent = Date.now()
 *   2. Servidor responde sync_response { clientSent, serverTime }
 *   3. Cliente calcula offset y usa clockSync.serverNow() para timestamps precisos
 *
 * RELAY DE EVENTOS:
 *   El director emite eventos (beat, state, setlist, songchange, countdown)
 *   que el servidor retransmite a todos los miembros de la sesión.
 *   Esto reemplaza a Supabase Realtime como transporte de sincronización.
 *
 * SESIONES:
 *   Cada sesión es una sala de Socket.io identificada por el código de sesión.
 *   No requiere base de datos — todo en memoria.
 */

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

    // ─── Relay de eventos director → miembros ────────────────────────────
    // El director emite estos eventos y el servidor los retransmite a todos
    // los demás miembros de la misma sesión (sin devolver al emisor).
    const relayEvents = ["beat", "state", "setlist", "songchange", "countdown"];
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
      sock.to(sock.data.roomName).emit("member_left", {
        id: sock.id,
        role: sock.data.role,
      });
      sock.leave(sock.data.roomName);
      const room = io.sockets.adapter.rooms.get(sock.data.roomName);
      const count = room ? room.size : 0;
      console.log(
        `[session] ${sock.id} salió de ${sock.data.roomName} — ${count} cliente(s)`
      );
      sock.data.roomName = null;
    }
  });
}

module.exports = registerBandpromptSocket;

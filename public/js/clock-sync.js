/**
 * ClockSync — sincronización NTP simplificada con el servidor.
 *
 * Hace N rounds de ping/pong para medir la latencia de red
 * y calcular el offset entre el reloj local y el del servidor.
 *
 * serverNow() devuelve la hora estimada del servidor en ms,
 * que es lo que se usa para convertir scheduledTime del beat
 * a tiempo del AudioContext.
 */
class ClockSync {
  constructor(socket) {
    this.socket = socket;
    this.offset = 0; // ms: serverTime - clientTime
  }

  /**
   * Corre `rounds` pings en secuencia y usa la mediana del offset
   * para rechazar outliers (picos de red).
   */
  sync(rounds = 8) {
    return new Promise((resolve) => {
      const samples = [];

      const doRound = () => {
        const clientSent = Date.now();
        this.socket.emit("sync_request", clientSent);

        this.socket.once("sync_response", ({ clientSent, serverTime }) => {
          const now = Date.now();
          const latency = (now - clientSent) / 2;
          const offset = serverTime + latency - now;
          samples.push(offset);

          if (samples.length < rounds) {
            // Pequeña pausa para no saturar
            setTimeout(doRound, 80);
          } else {
            // Mediana para descartar outliers
            const sorted = [...samples].sort((a, b) => a - b);
            this.offset = sorted[Math.floor(sorted.length / 2)];
            resolve(this.offset);
          }
        });
      };

      doRound();
    });
  }

  /** Hora estimada del servidor en este momento (ms). */
  serverNow() {
    return Date.now() + this.offset;
  }
}

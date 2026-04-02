class AudioEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      return this.ctx.resume();
    }
    return Promise.resolve();
  }

  scheduleClick(scheduledTime, isDownbeat, clockSync) {
    if (!this.ctx) return;

    const secondsUntilBeat = (scheduledTime - clockSync.serverNow()) / 1000;

    if (secondsUntilBeat < -0.01) return;

    const audioTime = this.ctx.currentTime + Math.max(0, secondsUntilBeat);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.frequency.value = isDownbeat ? 1400 : 880;
    gain.gain.setValueAtTime(isDownbeat ? 1.0 : 0.6, audioTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(audioTime);
    osc.stop(audioTime + 0.07);
  }
}

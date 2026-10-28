const notes = [
  { frequency: 587.33, offset: 0, duration: 0.2, gain: 0.028 },
  { frequency: 880, offset: 0.085, duration: 0.29, gain: 0.021 },
];

export function createNotificationEarcon(createAudioContext) {
  let context = null;

  function unlock() {
    if (!createAudioContext) return false;
    context ??= createAudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    return true;
  }

  function play() {
    if (!context || context.state !== 'running') return false;

    const origin = context.currentTime;
    for (const note of notes) {
      const start = origin + note.offset;
      const oscillator = context.createOscillator();
      const overtone = context.createOscillator();
      const fundamentalGain = context.createGain();
      const overtoneGain = context.createGain();
      const fundamentalEnd = start + note.duration;
      const overtoneEnd = start + note.duration * 0.68;

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, start);
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime(note.frequency * 2.01, start);

      fundamentalGain.gain.setValueAtTime(0.0001, start);
      fundamentalGain.gain.linearRampToValueAtTime(note.gain, start + 0.012);
      fundamentalGain.gain.exponentialRampToValueAtTime(0.0001, fundamentalEnd);
      overtoneGain.gain.setValueAtTime(0.0001, start);
      overtoneGain.gain.linearRampToValueAtTime(note.gain * 0.16, start + 0.01);
      overtoneGain.gain.exponentialRampToValueAtTime(0.0001, overtoneEnd);

      oscillator.connect(fundamentalGain);
      overtone.connect(overtoneGain);
      fundamentalGain.connect(context.destination);
      overtoneGain.connect(context.destination);
      oscillator.start(start);
      overtone.start(start);
      oscillator.stop(fundamentalEnd + 0.015);
      overtone.stop(overtoneEnd + 0.015);
    }
    return true;
  }

  function close() {
    if (context) void context.close().catch(() => {});
    context = null;
  }

  return { unlock, play, close };
}

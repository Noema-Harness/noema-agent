const notes = [
  { frequency: 493.88, offset: 0, duration: 0.34, gain: 0.024 },
  { frequency: 392, offset: 0.11, duration: 0.42, gain: 0.016 },
];

export function createNotificationEarcon(
  createAudioContext: (() => AudioContext) | null | undefined,
) {
  let context: AudioContext | null = null;

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
      const partials = [
        { ratio: 1, level: 1, duration: 1 },
        { ratio: 2.76, level: 0.105, duration: 0.72 },
        { ratio: 4.18, level: 0.032, duration: 0.46 },
      ];

      for (const partial of partials) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const end = start + note.duration * partial.duration;
        const pitch = note.frequency * partial.ratio;
        const peak = note.gain * partial.level;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(pitch, start);
        oscillator.frequency.exponentialRampToValueAtTime(
          pitch * 0.992,
          start + Math.min(0.16, note.duration * 0.6),
        );
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.014);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(start);
        oscillator.stop(end + 0.015);
      }
    }
    return true;
  }

  function close() {
    if (context) void context.close().catch(() => {});
    context = null;
  }

  return { unlock, play, close };
}

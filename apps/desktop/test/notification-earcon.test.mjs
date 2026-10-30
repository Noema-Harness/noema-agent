import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationEarcon } from '../src/notification-earcon.mjs';

function audioContext(state = 'suspended') {
  const oscillators = [];
  const parameters = () => ({
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  const context = {
    currentTime: 10,
    destination: {},
    state,
    resume: async () => {
      context.state = 'running';
    },
    createOscillator() {
      const oscillator = {
        frequency: parameters(),
        connect() {},
        start(time) {
          oscillator.startedAt = time;
        },
        stop(time) {
          oscillator.stoppedAt = time;
        },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      return { gain: parameters(), connect() {} };
    },
  };
  return { context, oscillators };
}

test('plays a short, quiet two-note earcon after a user gesture unlocks audio', async () => {
  const audio = audioContext();
  let contextsCreated = 0;
  const earcon = createNotificationEarcon(() => {
    contextsCreated++;
    return audio.context;
  });

  assert.equal(earcon.play(), false);
  assert.equal(earcon.unlock(), true);
  await Promise.resolve();
  assert.equal(contextsCreated, 1);
  assert.equal(earcon.play(), true);
  assert.equal(audio.oscillators.length, 6);
  assert.ok(
    audio.oscillators[0].stoppedAt - audio.oscillators[0].startedAt < 0.6,
  );
});

test('stays silent when Web Audio is unavailable', () => {
  const earcon = createNotificationEarcon(null);
  assert.equal(earcon.unlock(), false);
  assert.equal(earcon.play(), false);
});

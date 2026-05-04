const AUDIO_STORAGE_KEY = 'album26-audio-enabled';

let audioContext = null;
let masterGain = null;
let audioEnabled = localStorage.getItem(AUDIO_STORAGE_KEY) === 'true';
let soundButton = null;

function getAudioContext() {
    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        audioContext = new AudioContextClass();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.52;
        masterGain.connect(audioContext.destination);
    }

    if (audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }

    return audioContext;
}

function tone(frequency, offset, duration, options = {}) {
    const ctx = getAudioContext();
    if (!ctx || !masterGain) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + offset;
    const end = start + duration;
    const volume = options.volume ?? 0.12;

    oscillator.type = options.type || 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.slideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(options.slideTo, end);
    }

    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, end);

    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
}

function playKick(offset = 0) {
    tone(110, offset, 0.18, { type: 'sine', volume: 0.24, slideTo: 44 });
}

function playClap(offset = 0) {
    tone(920, offset, 0.05, { type: 'square', volume: 0.09 });
    tone(1320, offset + 0.018, 0.05, { type: 'triangle', volume: 0.06 });
}

function noiseBurst(offset = 0, duration = 0.35, volume = 0.09) {
    const ctx = getAudioContext();
    if (!ctx || !masterGain) return;

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
        output[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const start = ctx.currentTime + offset;
    const end = start + duration;

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(950, start);
    filter.Q.value = 0.55;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, end);

    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    source.start(start);
    source.stop(end + 0.02);
}

function playGoalCelebration(long = false) {
    noiseBurst(0, long ? 1.45 : 0.95, long ? 0.2 : 0.16);
    noiseBurst(0.14, long ? 1.05 : 0.7, long ? 0.12 : 0.09);
    playKick(0);
    playKick(0.1);
    playClap(0.16);
    playClap(0.28);
    playClap(0.42);
    tone(466, 0.04, 0.18, { type: 'sawtooth', volume: 0.08, slideTo: 698 });
    tone(622, 0.18, 0.18, { type: 'sawtooth', volume: 0.075, slideTo: 932 });
    tone(784, 0.34, 0.34, { type: 'triangle', volume: 0.12, slideTo: 1046 });
    tone(1046, 0.48, 0.28, { type: 'triangle', volume: 0.08 });
    if (long) {
        playKick(0.58);
        playClap(0.72);
        playClap(0.9);
        noiseBurst(0.72, 0.9, 0.1);
        tone(988, 0.64, 0.26, { type: 'triangle', volume: 0.1, slideTo: 1175 });
        tone(1318, 0.92, 0.32, { type: 'triangle', volume: 0.08 });
    }
}

function updateButton() {
    if (!soundButton) return;
    soundButton.classList.toggle('is-active', audioEnabled);
    soundButton.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
    const label = soundButton.querySelector('[data-audio-label]');
    if (label) label.textContent = audioEnabled ? 'Modo Gol' : 'Sonido Off';
}

export function initMatchAudioControls(button) {
    soundButton = button;
    updateButton();
}

export function isMatchAudioEnabled() {
    return audioEnabled;
}

export function toggleMatchAudio() {
    audioEnabled = !audioEnabled;
    localStorage.setItem(AUDIO_STORAGE_KEY, audioEnabled ? 'true' : 'false');
    updateButton();

    if (audioEnabled) {
        playUiSound('whistle');
    }
}

export function playUiSound(kind = 'tap') {
    if (!audioEnabled) return;

    const patterns = {
        tap: () => tone(520, 0, 0.055, { type: 'triangle', volume: 0.08 }),
        nav: () => {
            tone(380, 0, 0.06, { type: 'triangle', volume: 0.07 });
            tone(570, 0.055, 0.07, { type: 'triangle', volume: 0.065 });
        },
        success: () => playGoalCelebration(false),
        trade: () => {
            playKick(0);
            playClap(0.12);
            tone(740, 0.08, 0.1, { type: 'triangle', volume: 0.09 });
            tone(940, 0.2, 0.14, { type: 'triangle', volume: 0.085 });
        },
        whistle: () => {
            tone(1250, 0, 0.14, { type: 'sine', volume: 0.16, slideTo: 1800 });
            tone(1700, 0.12, 0.16, { type: 'sine', volume: 0.12, slideTo: 1300 });
        },
        sticker: () => playGoalCelebration(false),
        goal: () => playGoalCelebration(false),
        packGoal: () => playGoalCelebration(true),
        duplicate: () => {
            noiseBurst(0, 0.45, 0.1);
            playClap(0.08);
            playClap(0.24);
            tone(700, 0.08, 0.12, { type: 'triangle', volume: 0.09 });
        }
    };

    (patterns[kind] || patterns.tap)();
}

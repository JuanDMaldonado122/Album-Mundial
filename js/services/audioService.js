const AUDIO_STORAGE_KEY = 'album26-audio-enabled';

let audioContext = null;
let masterGain = null;
let ambienceTimer = null;
let audioEnabled = localStorage.getItem(AUDIO_STORAGE_KEY) === 'true';
let soundButton = null;

function getAudioContext() {
    if (!audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;

        audioContext = new AudioContextClass();
        masterGain = audioContext.createGain();
        masterGain.gain.value = 0.18;
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
    tone(96, offset, 0.18, { type: 'sine', volume: 0.16, slideTo: 42 });
}

function playClap(offset = 0) {
    tone(880, offset, 0.045, { type: 'square', volume: 0.035 });
    tone(1320, offset + 0.015, 0.04, { type: 'triangle', volume: 0.025 });
}

function playAmbiencePulse() {
    if (!audioEnabled) return;
    playKick(0);
    playClap(0.18);
    playKick(0.36);
    playClap(0.54);
}

function startAmbience() {
    stopAmbience();
    playAmbiencePulse();
    ambienceTimer = window.setInterval(playAmbiencePulse, 4200);
}

function stopAmbience() {
    if (ambienceTimer) {
        window.clearInterval(ambienceTimer);
        ambienceTimer = null;
    }
}

function updateButton() {
    if (!soundButton) return;
    soundButton.classList.toggle('is-active', audioEnabled);
    soundButton.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
    const label = soundButton.querySelector('[data-audio-label]');
    if (label) label.textContent = audioEnabled ? 'Sonido On' : 'Sonido Off';
}

export function initMatchAudioControls(button) {
    soundButton = button;
    updateButton();
    if (audioEnabled) startAmbience();
}

export function toggleMatchAudio() {
    audioEnabled = !audioEnabled;
    localStorage.setItem(AUDIO_STORAGE_KEY, audioEnabled ? 'true' : 'false');
    updateButton();

    if (audioEnabled) {
        startAmbience();
        playUiSound('whistle');
    } else {
        stopAmbience();
    }
}

export function playUiSound(kind = 'tap') {
    if (!audioEnabled) return;

    const patterns = {
        tap: () => tone(520, 0, 0.055, { type: 'triangle', volume: 0.045 }),
        nav: () => {
            tone(360, 0, 0.06, { type: 'triangle', volume: 0.045 });
            tone(540, 0.055, 0.07, { type: 'triangle', volume: 0.04 });
        },
        success: () => {
            tone(523, 0, 0.08, { type: 'triangle', volume: 0.06 });
            tone(659, 0.08, 0.08, { type: 'triangle', volume: 0.055 });
            tone(784, 0.16, 0.12, { type: 'triangle', volume: 0.05 });
        },
        trade: () => {
            playKick(0);
            tone(740, 0.08, 0.09, { type: 'triangle', volume: 0.055 });
            tone(940, 0.18, 0.12, { type: 'triangle', volume: 0.05 });
        },
        whistle: () => {
            tone(1250, 0, 0.14, { type: 'sine', volume: 0.07, slideTo: 1800 });
            tone(1700, 0.12, 0.16, { type: 'sine', volume: 0.055, slideTo: 1300 });
        },
        sticker: () => {
            tone(680, 0, 0.055, { type: 'square', volume: 0.04 });
            tone(920, 0.06, 0.075, { type: 'triangle', volume: 0.045 });
        }
    };

    (patterns[kind] || patterns.tap)();
}

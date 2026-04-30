let scannerStream = null;

function setGuideColor(color, duration) {
    const guide = document.querySelector('.scanner-guide');
    if (!guide) return;

    guide.style.borderColor = color;
    setTimeout(() => { guide.style.borderColor = ''; }, duration);
}

export async function openScanner({ video, fab, switchView }) {
    try {
        scannerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', focusMode: 'continuous' }
        });

        video.srcObject = scannerStream;
        switchView('view-scanner', true);
        fab.style.display = 'none';
    } catch (err) {
        console.error("Camera Error:", err);
        alert("No se pudo acceder a la camara. Asegurate de dar permisos en tu iPhone.");
    }
}

export function closeScanner({ fab, goHome }) {
    if (scannerStream) {
        scannerStream.getTracks().forEach(track => track.stop());
        scannerStream = null;
    }

    fab.style.display = 'flex';
    goHome();
}

export async function captureAndScan({ video, loader, getAllStickers, updateSticker }) {
    const canvas = document.createElement('canvas');

    canvas.width = 640;
    canvas.height = 480;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    loader.classList.add('active');

    try {
        const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
        console.log("OCR Result:", text);

        const match = text.match(/([A-Z]{3}|FWC)\s?(\d{1,2})/i);

        if (!match) {
            throw new Error("No detectado.");
        }

        const code = match[1].toUpperCase().trim();
        const num = match[2].trim();
        const fullCode = (code === 'FWC' && num === '00') ? '00' : `${code} ${num}`;

        if (!getAllStickers().includes(fullCode)) {
            throw new Error("Código no reconocido.");
        }

        loader.classList.remove('active');

        if (!confirm(`Detecté ${fullCode}. ¿Agregar esta lámina?`)) {
            return;
        }

        updateSticker(fullCode, 1);
        setGuideColor('#C8D400', 1000);

        console.log(`Lámina ${fullCode} agregada.`);
    } catch (e) {
        console.warn("Scan failed:", e.message);
        setGuideColor('#CC0000', 800);
    } finally {
        loader.classList.remove('active');
    }
}

export function createCollectionShareCard({ stats, duplicates, missing }) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#CC0000';
    ctx.fillRect(0, 0, canvas.width, 18);
    ctx.fillStyle = '#C8D400';
    ctx.fillRect(0, 18, canvas.width, 8);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 72px Arial';
    ctx.fillText('Album Mundial 2026', 72, 130);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '700 30px Arial';
    ctx.fillText('Mi estado de coleccion', 72, 180);

    drawStat(ctx, 'Completado', `${stats.percentage}%`, 72, 280);
    drawStat(ctx, 'Unicas', `${stats.unique}/${stats.total}`, 390, 280);
    drawStat(ctx, 'Repetidas', `${stats.duplicates}`, 708, 280);

    drawList(ctx, 'Repetidas para cambiar', duplicates.slice(0, 24), 72, 480);
    drawList(ctx, 'Me faltan', missing.slice(0, 36), 72, 800);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '700 24px Arial';
    ctx.fillText('Generado desde Album 26', 72, 1280);

    return canvas.toDataURL('image/png');
}

function drawStat(ctx, label, value, x, y) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, x, y, 250, 130, 12);
    ctx.fill();

    ctx.fillStyle = '#C8D400';
    ctx.font = '900 46px Arial';
    ctx.fillText(value, x + 24, y + 62);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '800 22px Arial';
    ctx.fillText(label.toUpperCase(), x + 24, y + 102);
}

function drawList(ctx, title, items, x, y) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 34px Arial';
    ctx.fillText(title, x, y);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '700 26px Arial';
    const text = items.length ? items.join(', ') : 'Sin datos por ahora';
    wrapText(ctx, text, x, y + 50, 920, 34);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';

    words.forEach(word => {
        const testLine = `${line}${word} `;
        if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = `${word} `;
            y += lineHeight;
        } else {
            line = testLine;
        }
    });

    ctx.fillText(line, x, y);
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
}

export function generateStickerPdf({ type, allStickers, state, jsPDF }) {
    const doc = new jsPDF();

    let list = [];
    let titleText = "";

    if (type === 'missing') {
        list = allStickers.filter(id => (state[id] || 0) === 0);
        titleText = "LÁMINAS FALTANTES - MUNDIAL 2026";
    } else {
        list = allStickers.filter(id => (state[id] || 0) > 1);
        titleText = "LÁMINAS REPETIDAS - MUNDIAL 2026";
    }

    if (list.length === 0) {
        return {
            ok: false,
            message: type === 'missing'
                ? "¡Felicidades! Ya no te faltan laminas."
                : "Aun no tienes laminas repetidas."
        };
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(204, 0, 0);
    doc.text(titleText, 20, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generado el: ${new Date().toLocaleDateString()}`, 20, 28);
    doc.text(`Total laminas: ${list.length}`, 20, 33);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);

    let y = 45;
    let x = 20;
    const colWidth = 35;

    list.forEach(code => {
        doc.text(code, x, y);
        x += colWidth;

        if (x > 180) {
            x = 20;
            y += 8;
        }

        if (y > 280) {
            doc.addPage();
            y = 20;
        }
    });

    doc.save(`${type === 'missing' ? 'Faltantes' : 'Repetidas'}_Mundial2026.pdf`);

    return { ok: true };
}

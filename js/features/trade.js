export function openTradeView({ state, allStickers, duplicateStickerIds, switchView }) {
    document.getElementById('trade-receive').value = '';

    const selGive = document.getElementById('trade-give');
    const btnExe = document.getElementById('btn-execute-trade');

    if (duplicateStickerIds.length === 0) {
        selGive.innerHTML = '<option value="">No tienes láminas repetidas aún</option>';
        selGive.disabled = true;
        btnExe.disabled = true;
    } else {
        selGive.disabled = false;
        btnExe.disabled = false;
        selGive.innerHTML = '<option value="" disabled selected>Elige cuál lámina entregas...</option>' +
            duplicateStickerIds.map(id => `<option value="${id}">${id} (Tienes ${state[id] - 1} extras)</option>`).join('');
    }

    const datalist = document.getElementById('dl-all');
    if (datalist.options.length === 0) {
        datalist.innerHTML = allStickers.map(id => `<option value="${id}">`).join('');
    }

    switchView('view-trade');
}

export function executeManualTrade({ state, allStickers, updateSticker, reopenTrade }) {
    const give = document.getElementById('trade-give').value;
    const recRaw = document.getElementById('trade-receive').value;
    const receive = recRaw ? recRaw.trim().toUpperCase() : '';

    if (!give) {
        alert("Selecciona qué lámina entregas.");
        return;
    }

    if (!receive) {
        alert("Escribe qué lámina recibes.");
        return;
    }

    if (!allStickers.includes(receive)) {
        alert("El código que recibes no es válido. Ejemplos válidos: FWC 1, MEX 10, ARG 5");
        return;
    }

    if (state[give] < 2) {
        alert("Ya no tienes la lámina que entregas repetida.");
        reopenTrade();
        return;
    }

    if (confirm(`¿Confirmas que entregas ${give} a cambio de recibir ${receive}?`)) {
        updateSticker(give, -1);
        updateSticker(receive, 1);
        alert(`✅ ¡Cambio registrado y SINCRONIZADO!\n\nMenos: 1 de ${give}\nMás: 1 de ${receive}`);
        reopenTrade();
    }
}

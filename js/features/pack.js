export function parsePackInput(text, allStickers) {
    const valid = new Set(allStickers);
    const rawCodes = text
        .split(/[\n,;]+/)
        .map(value => value.trim().toUpperCase().replace(/\s+/g, ' '))
        .filter(Boolean);

    const accepted = [];
    const rejected = [];

    rawCodes.forEach(code => {
        if (valid.has(code)) accepted.push(code);
        else rejected.push(code);
    });

    return { accepted, rejected };
}

export function addPackFromText({ text, allStickers, updateSticker }) {
    const { accepted, rejected } = parsePackInput(text, allStickers);

    accepted.forEach(code => updateSticker(code, 1));

    return {
        accepted,
        rejected,
        message: `${accepted.length} láminas agregadas${rejected.length ? `. No reconocidas: ${rejected.join(', ')}` : '.'}`
    };
}

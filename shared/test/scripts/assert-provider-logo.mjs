import assert from 'node:assert/strict';

export async function assertPlainProviderLogo(image) {
  const layers = await image.evaluate(async node => {
    await node.decode();
    return [node, node.closest('.provider-avatar')].filter(Boolean).map(element => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        image: style.backgroundImage,
        shadow: style.boxShadow,
        border: ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(style['border' + side + 'Width']) > 0),
      };
    });
  });
  for (const layer of layers) {
    assert.deepEqual(layer, { background: 'rgba(0, 0, 0, 0)', image: 'none', shadow: 'none', border: false });
  }
}

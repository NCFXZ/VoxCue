import assert from 'node:assert/strict';

export function assertLocationColor(color, dark) {
  assert.equal(color, dark ? 'rgb(64, 71, 76)' : 'rgb(235, 235, 235)');
}

export async function assertLocationHighlightMotion(row, reduced, trigger) {
  const capture = await row.evaluateHandle((row, waitForTrigger) => {
    const samples = [];
    let start, frame, finish;
    const result = new Promise(resolve => { finish = resolve; });
    const active = () => row.hasAttribute('data-location-highlight');
    const stop = () => {
      observer.disconnect();
      clearTimeout(deadline);
      cancelAnimationFrame(frame);
      finish({ samples, cleared: start !== undefined && !active() });
    };
    function sample() {
      const style = getComputedStyle(row, '::before');
      samples.push({
        time: performance.now() - start,
        value: Number(style.opacity),
        animation: style.animationName,
      });
      frame = requestAnimationFrame(sample);
    }
    function track() {
      if (start === undefined && active()) {
        start = performance.now();
        sample();
      } else if (start !== undefined && !active()) stop();
    }
    const observer = new MutationObserver(track);
    observer.observe(row, { attributes: true, attributeFilter: ['data-location-highlight'] });
    const deadline = setTimeout(stop, 15000);
    if (!waitForTrigger) track();
    return { result, stop };
  }, !!trigger);
  let samples;
  try {
    if (trigger) await trigger();
    samples = await capture.evaluate(probe => probe.result);
  } finally {
    await capture.evaluate(probe => probe.stop());
    await capture.dispose();
  }
  assert.ok(samples.cleared, 'The temporary highlight must clear');
  const frames = samples.samples;
  assert.ok(
    frames.length > 2 && frames.at(-1).time >= 750,
    'The destination must remain visible long enough to locate',
  );
  if (reduced) {
    assert.ok(frames.every((frame) => frame.animation === 'none' && frame.value === 1));
  } else {
    const solid = frames.filter((frame) => frame.value >= 0.99);
    assert.ok(
      solid.length > 1 && solid.at(-1).time - solid[0].time >= 500,
      'The background must hold at full opacity',
    );
    const partial = frames.filter((frame) => frame.value > 0.01 && frame.value < 0.95);
    assert.ok(
      partial.some((frame) => frame.time < solid[0].time),
      'The background must visibly fade in',
    );
    assert.ok(
      partial.some((frame) => frame.time > solid.at(-1).time),
      'The background must visibly fade out',
    );
  }
}

export async function assertSettingsHighlight(row, { keyboard = false } = {}) {
  await row.locator('xpath=self::*[@data-location-highlight]').waitFor();
  const result = await row.evaluate((row) => {
    const skin = getComputedStyle(row, '::before');
    const style = getComputedStyle(row);
    const items = [...row.children].filter(
      (child) =>
        child.getClientRects().length &&
        !['absolute', 'fixed'].includes(getComputedStyle(child).position),
    );
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const frame = () =>
      [row, ...items].flatMap((el) => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      });
    const rowStrokes = () => [
      style.outlineWidth,
      style.boxShadow,
      ...sides.map((s) => style['border' + s + 'Width']),
    ];
    const colorProbe = document.createElement('span');
    colorProbe.style.cssText = 'display:none;background-color:var(--location-highlight)';
    row.append(colorProbe);
    const locationColor = getComputedStyle(colorProbe).backgroundColor;
    colorProbe.remove();
    const panel = row.closest('.components-panel');
    const panelStyle = panel && getComputedStyle(panel);
    const group = row.closest('.component-group');
    const scope = row.closest('.settings-content, .interview-settings-dialog');
    const bounds = row.getBoundingClientRect();
    const scopeBounds = scope?.getBoundingClientRect();
    const previous = row.previousElementSibling;
    const heading = previous?.matches('h3') ? previous : previous?.querySelector(':scope > h3');
    const separateHeadingGap = heading ? bounds.top + parseFloat(style.borderTopWidth) + parseFloat(skin.top) +
      parseFloat(skin.marginTop) - heading.getBoundingClientRect().bottom : undefined;
    let headingClearance;
    if (group?.querySelector(':scope > .component-row') === row) {
      const heading = group.querySelector(':scope > h3');
      const headingStyle = getComputedStyle(heading);
      const padding = parseFloat(headingStyle.paddingBottom);
      const contentBottom = heading.getBoundingClientRect().bottom - parseFloat(headingStyle.borderBottomWidth) - padding;
      const skinTop = row.getBoundingClientRect().top + parseFloat(style.borderTopWidth) + parseFloat(skin.top) + parseFloat(skin.marginTop);
      headingClearance = { padding, gap: skinTop - contentBottom };
    }
    const result = {
      edges: sides.map((s) => parseFloat(skin[s.toLowerCase()]) + parseFloat(skin['margin' + s])),
      width: parseFloat(skin.width),
      rowWidth: row.clientWidth,
      panelWidth: panel?.clientWidth,
      scopeMargins: scopeBounds && [
        bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(skin.left) - scopeBounds.left,
        scopeBounds.right - bounds.right + parseFloat(style.borderRightWidth) + parseFloat(skin.right),
      ],
      separateHeadingGap,
      bottomExtension: row.matches('.speech-controls > .remote-connection-settings')
        ? parseFloat(getComputedStyle(row.parentElement).rowGap)
        : row.matches('.speech-device-grid') ? 10 : 0,
      dark: document.documentElement.classList.contains('dark'),
      height: parseFloat(skin.height),
      rowHeight: row.clientHeight,
      radii: ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(
        (s) => skin['border' + s + 'Radius'],
      ),
      locationColor,
      panel: panel && {
        headingClearance,
        leftInset: parseFloat(panelStyle.paddingLeft),
        rightInset: parseFloat(panelStyle.paddingRight),
        overflow: [panelStyle.overflowX, panelStyle.overflowY],
        cardRadius: panelStyle.getPropertyValue('--radius-card').trim(),
        bottomRadii: [panelStyle.borderBottomLeftRadius, panelStyle.borderBottomRightRadius],
        lastRow: row.matches('.component-group:last-child > .component-row:last-child'),
        bottomGap: panel.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom,
        bottomBorder: parseFloat(panelStyle.borderBottomWidth),
      },
      strokes: [
        skin.outlineWidth,
        skin.boxShadow,
        ...sides.map((s) => skin['border' + s + 'Width']),
      ],
      background: skin.backgroundColor,
      pointerEvents: skin.pointerEvents,
      layer: skin.zIndex,
      keyboardFocused:
        row.contains(document.activeElement) && document.activeElement.matches(':focus-visible'),
    };
    const highlightedFrame = frame();
    const highlightedStrokes = rowStrokes();
    row.removeAttribute('data-location-highlight');
    try {
      result.shift = Math.max(...frame().map((v, i) => Math.abs(v - highlightedFrame[i])));
      result.sameRowStrokes = rowStrokes().every((v, i) => v === highlightedStrokes[i]);
    } finally {
      row.setAttribute('data-location-highlight', '');
    }
    return result;
  });
  const { panel } = result;
  const left = panel ? panel.leftInset : 12;
  const right = panel ? panel.rightInset : 12;
  assert.deepEqual(result.edges, [-2, -right, -2 - result.bottomExtension, -left]);
  const expectedWidth = result.panelWidth ?? result.rowWidth + left + right;
  assert.ok(Math.abs(result.width - expectedWidth) <= 1, JSON.stringify(result));
  assert.ok(Math.abs(result.height - (result.rowHeight + 4 + result.bottomExtension)) <= 1, JSON.stringify(result));
  assert.deepEqual(result.radii, ['0px', '0px', '0px', '0px']);
  if (result.scopeMargins) assert.ok(result.scopeMargins.every(value => value >= 11),
    'Settings highlights must retain horizontal outer margins: ' + JSON.stringify(result));
  if (result.separateHeadingGap !== undefined && !panel) assert.ok(result.separateHeadingGap >= 9.9,
    'A standalone heading must stay outside the highlight with at least 10px clearance: ' + JSON.stringify(result));
  if (panel) {
    if (panel.headingClearance) {
      assert.equal(panel.headingClearance.padding, 12);
      assert.ok(Math.abs(panel.headingClearance.gap - 10) <= 1 / 64,
        `Expected 10 CSS px between the group heading content and the first highlight: ${panel.headingClearance.gap}`);
    }
    assert.deepEqual(panel.overflow, ['clip', 'clip']);
    assert.ok(parseFloat(panel.cardRadius) > 0, 'Expected a rounded component card');
    assert.deepEqual(panel.bottomRadii, [panel.cardRadius, panel.cardRadius],
      'Both lower corners must use the radius of the card that clips the highlight');
    if (panel.lastRow)
      assert.ok(
        Math.abs(panel.bottomGap - panel.bottomBorder) <= 1,
        'The final highlight must reach the bottom border',
      );
  }
  assert.deepEqual(result.strokes, ['0px', 'none', '0px', '0px', '0px', '0px']);
  assert.ok(result.sameRowStrokes, 'Locating a row must preserve its ordinary borders and outline');
  assert.ok(result.shift <= 0.1, 'Locating a row must preserve its layout');
  assertLocationColor(result.background, result.dark);
  assert.equal(result.background, result.locationColor);
  assert.equal(result.pointerEvents, 'none');
  assert.equal(result.layer, '-1');
  if (keyboard)
    assert.ok(result.keyboardFocused, 'The destination control must receive keyboard focus');
}

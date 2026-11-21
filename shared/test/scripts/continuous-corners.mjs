import assert from 'node:assert/strict';

// Chromium may serialize these equivalent CSS curves as keywords or functions.
export function cornerShapeNames(value) {
  const name = (shape) =>
    ({ 'superellipse(1)': 'round', 'superellipse(2)': 'squircle' })[shape] ?? shape;
  return typeof value === 'string'
    ? name(value)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, name(item)]));
}

// The real rounded surface changes height inside an unchanged Popper box.
// Measuring both catches scale/clip substitutes and a moving trigger anchor.
export function dropdownRevealGeometry({
  height,
  top,
  bottom,
  frameHeight,
  frameTop,
  frameBottom,
  side,
}) {
  return {
    revealed: height / frameHeight,
    anchorGap: side === 'top' ? frameBottom - bottom : top - frameTop,
  };
}

// Apply CSS radius normalization to measured animation frames. A 50% radius on
// a wide button is an ellipse; checking only the final circle misses that bug.
export function verifyRoundCapFrames(frames) {
  assert.ok(frames.length >= 3, 'Round caps require intermediate animation frames');
  for (const frame of frames) {
    const { width, height, radii } = frame;
    assert.ok(width >= height - 1 / 64 && height > 0, JSON.stringify(frame));
    const corners = radii.map((radius) => {
      const parts = radius.split(/\s+/);
      return [parts[0], parts[1] ?? parts[0]].map((value, axis) =>
        value.endsWith('%')
          ? (parseFloat(value) * (axis ? height : width)) / 100
          : parseFloat(value),
      );
    });
    const factor = Math.min(
      1,
      width / (corners[0][0] + corners[1][0]),
      width / (corners[3][0] + corners[2][0]),
      height / (corners[0][1] + corners[3][1]),
      height / (corners[1][1] + corners[2][1]),
    );
    assert.ok(
      corners.every((corner) =>
        corner.every((radius) => Math.abs(radius * factor - height / 2) < 1 / 64),
      ),
      'Effective end caps must stay semicircular: ' + JSON.stringify(frame),
    );
  }
}

export async function verifyComposerControlAlignment(composer, name) {
  const geometry = await composer.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const controls = [
      node.querySelector('.floating-composer-toolbar .floating-toggle'),
      node.querySelector('.floating-composer-actions > :first-child'),
      node.querySelector('.send-button'),
    ].map((control) => control.getBoundingClientRect());
    return {
      tops: controls.map((control) => control.top),
      bottoms: controls.map((control) => control.bottom),
      gaps: [
        controls[0].left - box.left,
        box.right - controls[2].right,
        ...controls.map((control) => box.bottom - control.bottom),
      ],
      bottomPadding:
        box.bottom - controls[1].bottom - parseFloat(getComputedStyle(node).borderBottomWidth),
    };
  });
  for (const [edge, values] of Object.entries({
    top: geometry.tops,
    bottom: geometry.bottoms,
    sideAndBottomGap: geometry.gaps,
  }))
    assert.ok(
      Math.max(...values) - Math.min(...values) <= 1 / 64,
      name + ': composer controls must align at ' + edge + ': ' + JSON.stringify(geometry),
    );
  assert.ok(
    Math.abs(geometry.bottomPadding - 8) <= 1 / 64,
    name +
      ': screenshot bottom spacing stays at its existing baseline: ' +
      JSON.stringify(geometry),
  );
  return geometry;
}

// Compare the painted corner centers in viewport coordinates, so preview scaling
// and platform borders cannot hide a mismatch between the nested surfaces.
export async function verifyConcentricComposers(page, name) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  const samples = await page.locator('.floating-answer:visible').evaluateAll((panels) =>
    panels.flatMap((panel) => {
      const composer = panel.querySelector('.floating-composer');
      if (!composer || !composer.checkVisibility()) return [];
      const outer = panel.getBoundingClientRect(),
        inner = composer.getBoundingClientRect(),
        outerStyle = getComputedStyle(panel),
        innerStyle = getComputedStyle(composer);
      const outerScale = outer.width / parseFloat(outerStyle.width),
        innerScale = inner.width / parseFloat(innerStyle.width);
      const corners = ['Left', 'Right'].map((side) => {
        const outerRadius = parseFloat(outerStyle['borderBottom' + side + 'Radius']) * outerScale,
          innerRadius = parseFloat(innerStyle['borderBottom' + side + 'Radius']) * innerScale,
          direction = side === 'Left' ? 1 : -1,
          edge = side.toLowerCase();
        return {
          side,
          horizontal:
            outer[edge] + direction * outerRadius - (inner[edge] + direction * innerRadius),
          vertical: outer.bottom - outerRadius - (inner.bottom - innerRadius),
          inset: side === 'Left' ? inner.left - outer.left : outer.right - inner.right,
        };
      });
      const base = panel.querySelector(':scope > .floating-chrome-base');
      const group = panel.closest('.floating-panels, .interview-font-preview') ?? panel;
      const bubbles = [
        ...group.querySelectorAll(
          '.transcript-item > p,.floating-question,.answer-bubble,.interview-answer-failure',
        ),
      ]
        .filter((node) => node.checkVisibility())
        .map((node) => ({
          type: node.className,
          radius: getComputedStyle(node).borderRadius,
        }));
      return [
        {
          geometry: {
            outer: outer.toJSON(),
            inner: inner.toJSON(),
            outerWidth: outerStyle.width,
            innerWidth: innerStyle.width,
            border: outerStyle.borderWidth,
            outerRadius: outerStyle.borderRadius,
            outerScale,
            innerScale,
            zoom: outerStyle.zoom,
          },
          corners,
          corner: innerStyle.cornerShape,
          outerCorner: outerStyle.cornerShape,
          radius: innerStyle.borderRadius,
          bubbles,
          backingRadius: base ? getComputedStyle(base, '::after').borderRadius : null,
        },
      ];
    }),
  );
  assert.ok(samples.length > 0, name + ': a visible interview composer is required');
  for (const sample of samples) {
    for (const corner of sample.corners) {
      assert.ok(corner.inset > 0, name + ': composer must stay inside its panel');
      assert.ok(
        Math.abs(corner.horizontal) <= 1 / 32 && Math.abs(corner.vertical) <= 1 / 32,
        name + ': nested bottom corners must share a center: ' + JSON.stringify(sample),
      );
    }
    assert.equal(sample.corner, sample.outerCorner, name + ': nested corner curves');
    if (sample.backingRadius !== null)
      assert.equal(sample.backingRadius, sample.radius, name + ': opaque backing follows composer');
    for (const bubble of sample.bubbles)
      assert.equal(
        bubble.radius,
        sample.radius,
        name + ': dialogue bubbles share composer corners: ' + bubble.type,
      );
  }
  return samples;
}

// Inspect actual pages, including portal menus and generated selection marks.
// Switching only the curve back to round must not change radii or box geometry.
export async function verifyContinuousCorners(page, name) {
  // Compare the settled surfaces; popup scale and view-height animations are
  // verified separately and must not distort the measured nested insets.
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = new Set(
      [...document.querySelectorAll('.dropdown-content')]
        .filter((menu) => menu.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
        .flatMap((menu) => menu.getAnimations({ subtree: true })),
    );
    await Promise.all(
      [...animations]
        .filter(
          (animation) =>
            animation.playState !== 'finished' &&
            Number.isFinite(animation.effect?.getComputedTiming().endTime),
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const result = await page.evaluate(() => {
    if (!CSS.supports('corner-shape', 'superellipse(2)'))
      throw Error('The desktop renderer does not support continuous corners');
    const fallback = document.documentElement.classList.contains('web-materials');
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.cornerShape = 'superellipse(2)';
    const continuous = getComputedStyle(probe).getPropertyValue('corner-top-left-shape');
    probe.style.cornerShape = 'round';
    const round = getComputedStyle(probe).getPropertyValue('corner-top-left-shape');
    probe.style.backgroundColor = fallback ? 'var(--web-control-hover)' : 'var(--hover)';
    probe.style.boxShadow = 'var(--shadow-popup)';
    probe.style.borderRadius = 'var(--radius-control)';
    const hoverColor = getComputedStyle(probe).backgroundColor;
    probe.style.backgroundColor = 'var(--account-card-hover-surface)';
    const accountHoverColor = getComputedStyle(probe).backgroundColor;
    const popupShadow = getComputedStyle(probe).boxShadow;
    const controlRadius = getComputedStyle(probe).borderRadius;
    probe.style.borderRadius = 'var(--radius-composer)';
    const composerRadius = getComputedStyle(probe).borderRadius;
    probe.style.borderRadius = 'var(--radius-interview-answer)';
    const answerRadius = getComputedStyle(probe).borderRadius;
    probe.style.boxShadow = 'var(--shadow-raised)';
    const raisedShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    // A permanently dark interview preview can sit inside a light main window.
    // Compare each surface with the standard token from its actual theme scope.
    const scopedShadows = new Map();
    const raisedShadowFor = (element) => {
      const scope = element.closest('.dark') ?? document.documentElement;
      if (!scopedShadows.has(scope)) {
        const sample = document.createElement('span');
        sample.style.position = 'absolute';
        sample.style.boxShadow = 'var(--shadow-raised)';
        scope.append(sample);
        scopedShadows.set(scope, getComputedStyle(sample).boxShadow);
        sample.remove();
      }
      return scopedShadows.get(scope);
    };
    const sides = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
    const samples = [];
    const wrong = [];
    const wrongCursors = [];
    const wrongMenus = [];
    const wrongSurfaces = [];
    let cursors = 0;
    let circles = 0,
      capsules = 0,
      shadows = 0,
      generated = 0;
    for (const element of document.querySelectorAll('html, body, body *')) {
      const box = element.getBoundingClientRect();
      if (
        !element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ||
        !box.width ||
        !box.height ||
        box.right <= 0 ||
        box.left >= innerWidth ||
        box.bottom <= 0 ||
        box.top >= innerHeight
      )
        continue;
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && ['none', 'normal'].includes(style.content)) continue;
        cursors++;
        const inertPreview = Boolean(element.closest('[inert], .login-preview'));
        const textField =
          !pseudo &&
          !inertPreview &&
          (element.matches('textarea:enabled') ||
            (element.matches('input:enabled') &&
              ![
                'range',
                'file',
                'checkbox',
                'radio',
                'color',
                'button',
                'submit',
                'reset',
                'image',
              ].includes(element.type)) ||
            Boolean(element.closest('[contenteditable="true"]')));
        const copyableText =
          !pseudo &&
          !inertPreview &&
          !element.closest('a,button,[role="button"]') &&
          Boolean(
            element.closest(
              '.markdown-content,.user-bubble > p,.answer-text,.transcript-item > p,' +
                '.floating-question,.record-transcript-text,.record-answer-question,' +
                '.record-answer-content,.interview-answer-failure-reason',
            ),
          );
        const link = element.closest('a[href],button.chat-source-link');
        const clickableLink =
          !pseudo &&
          !inertPreview &&
          link &&
          !link.matches(':disabled,[disabled],[aria-disabled="true"]');
        const expectedCursor =
          !pseudo && element.matches('.panel-resize-handle')
            ? 'col-resize'
            : clickableLink
              ? 'pointer'
              : textField || copyableText
                ? 'text'
                : 'default';
        if (style.cursor !== expectedCursor)
          wrongCursors.push(
            element.tagName +
              '.' +
              element.getAttribute('class') +
              (pseudo ?? '') +
              ': ' +
              style.cursor,
          );
        const radii = sides.map((side) => style.getPropertyValue('border-' + side + '-radius'));
        if (!radii.some((radius) => parseFloat(radius) > 0)) continue;
        const circle = radii.every((radius) => radius === '50%');
        const menuSurface = !pseudo && element.matches('.dropdown-content,.dropdown-item');
        const capsule =
          (!pseudo && element.matches('.dropdown-item')) ||
          (!menuSurface &&
            ((!pseudo && element.matches('.sidebar-selection-indicator')) ||
              (fallback &&
                !pseudo &&
                element.matches(
                  '.ui-button:not(.button-icon),.confirm-delete,.download-button,.choice-trigger,.settings-choice,.speech-select,.history-filters input[type="search"]',
                )) ||
              element.matches(
                '.settings-switch,.settings-switch > span,.frosted-slider-track,.frosted-slider-track > span,' +
                  '.floating-toolbar,.floating-brand,.floating-controls .ui-button,' +
                  '.floating-drag-handle,.interview-ready-badge,.floating-toggle.ui-button,.interview-preview-capsule,' +
                  '.floating-composer-toolbar .ui-button,.composer-tools .composer-tool,' +
                  '.composer-tools .button-icon,.profile-overview > span,.neutral-badge,.chat-source-link,.reasoning-slider-track,' +
                  '.screen-capture-status,.record-transcript-heading span,.interview-input-segmented,.interview-input-thumb,' +
                  '.interview-answer-status,.preparation-guide-actions .ui-button,.toolbar-actions > .ui-button,.interview-start-dialog .ui-button',
              )));
        const roundMenu = element.matches('.reasoning-slider-fill');
        if (element.matches('.reasoning-slider-fill') && (radii[1] !== '0px' || radii[2] !== '0px'))
          wrong.push('reasoning slider fill must join beneath the thumb with a flat edge');
        const label = element.tagName + '.' + element.getAttribute('class') + (pseudo ?? '');
        if (!pseudo) {
          if (
            element.matches('.interview-badge-tooltip,.confirm-delete-error') &&
            (style.borderRadius !== controlRadius || style.boxShadow !== raisedShadow)
          )
            wrongSurfaces.push(label + ': inconsistent tooltip corners or shadow');
          if (
            !fallback &&
            element.matches('.confirm-delete.is-compact.ui-button') &&
            style.borderRadius !== controlRadius
          )
            wrongSurfaces.push(label + ': compact action differs from standard action corners');
          if (
            element.matches(
              '.composer,.floating-composer,.follow-latest,.floating-toolbar,.floating-panel,.answer-bubble,.interview-answer-failure',
            ) &&
            style.boxShadow !== raisedShadowFor(element)
          )
            wrongSurfaces.push(label + ': inconsistent raised surface shadow');
          if (element.matches('.interview-answer-failure')) {
            const family = element.closest('.floating-panel')?.querySelector('.floating-composer');
            const scopedAnswerRadius = family
              ? getComputedStyle(family).borderRadius
              : answerRadius;
            if (style.borderRadius !== scopedAnswerRadius)
              wrongSurfaces.push(label + ': failure alert differs from answer bubble corners');
          }
          if (element.matches('.dropdown-item') && style.boxShadow !== 'none')
            wrongSurfaces.push(label + ': menu item adds an elevation shadow');
          if (
            element.matches('.dropdown-item[data-state="checked"]:not([data-highlighted])') &&
            style.backgroundColor !== 'rgba(0, 0, 0, 0)'
          )
            wrongSurfaces.push(label + ': selected menu item has a permanent fill');
        }
        if (circle) circles++;
        if (capsule) {
          capsules++;
          if (parseFloat(radii[0]) < box.height / 2) wrong.push(label + ': capsule radius');
        }
        if (style.boxShadow !== 'none') shadows++;
        if (pseudo) generated++;
        if (
          sides.some(
            (side, index) =>
              parseFloat(radii[index]) > 0 &&
              style.getPropertyValue('corner-' + side + '-shape') !==
                (circle || capsule || roundMenu ? round : continuous),
          )
        )
          wrong.push(label);
        samples.push({
          element,
          pseudo,
          label,
          geometry: [style.width, style.height, ...radii, style.boxShadow],
        });
      }
    }
    for (const menu of document.querySelectorAll('.dropdown-content')) {
      if (!menu.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const trigger = menu.matches('.reasoning-effort-popup')
        ? [...document.querySelectorAll('[aria-controls]')].find(
            (element) => element.getAttribute('aria-controls') === menu.id,
          )
        : document.getElementById(menu.getAttribute('aria-labelledby'));
      if (!trigger) throw Error('Open menu has no associated trigger');
      const menuStyle = getComputedStyle(menu),
        triggerStyle = getComputedStyle(trigger);
      if (menuStyle.boxShadow !== popupShadow)
        wrongSurfaces.push(menu.className + ': inconsistent popup shadow');
      if (
        triggerStyle.backgroundColor !==
        (trigger.matches('.user-button') ? accountHoverColor : hoverColor)
      )
        wrongSurfaces.push(trigger.className + ': open dropdown loses its hover feedback');
      const menuBox = menu.getBoundingClientRect();
      const scale = menuBox.width / parseFloat(menuStyle.width);
      const items = [...menu.querySelectorAll('.dropdown-item')].filter(
        (item) =>
          item.closest('.dropdown-content') === menu &&
          item.checkVisibility() &&
          item.getBoundingClientRect().width > 0 &&
          item.getBoundingClientRect().height > 0,
      );
      for (const side of sides) {
        const expectedRadius = parseFloat(composerRadius);
        const radii = menuStyle
          .getPropertyValue('border-' + side + '-radius')
          .split(/\s+/)
          .map(parseFloat);
        if (
          radii.some((radius) => Math.abs(radius - expectedRadius) > 0.6) ||
          menuStyle.getPropertyValue('corner-' + side + '-shape') !== continuous
        )
          wrongMenus.push(
            menu.className + ': popup does not share the continuous composer corner at ' + side,
          );
      }
      if (
        ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].some(
          (property) => Math.abs(parseFloat(menuStyle[property]) - 6) > 1 / 64,
        )
      )
        wrongMenus.push(menu.className + ': popup content inset differs from 6px');
      if (menuStyle.overflowX !== 'hidden' || menuStyle.overflowY !== 'hidden')
        wrongMenus.push(menu.className + ': outer popup must clip its inner scrolling surface');
      const scroll = menu.querySelector(':scope > .dropdown-scroll');
      const modelList = scroll?.querySelector('.reasoning-model-list');
      if (!scroll) wrongMenus.push(menu.className + ': popup has no owned inner scrolling surface');
      else {
        const scrollBox = scroll.getBoundingClientRect(),
          scrollStyle = getComputedStyle(scroll);
        const insets = {
          left: (scrollBox.left - menuBox.left) / scale,
          right: (menuBox.right - scrollBox.right) / scale,
          top: (scrollBox.top - menuBox.top) / scale,
          bottom: (menuBox.bottom - scrollBox.bottom) / scale,
        };
        for (const edge of ['left', 'right', 'top', 'bottom']) {
          const frameContainsScrollbar = modelList && (edge === 'left' || edge === 'right');
          const expectedInset =
            (frameContainsScrollbar ? 0 : parseFloat(menuStyle.getPropertyValue('padding-' + edge))) +
            parseFloat(menuStyle.getPropertyValue('border-' + edge + '-width'));
          if (Math.abs(insets[edge] - expectedInset) > 0.6)
            wrongMenus.push(menu.className + ': inner scroll surface is not contained at ' + edge);
        }
        for (const side of sides) {
          const values = scrollStyle
            .getPropertyValue('border-' + side + '-radius')
            .split(/\s+/)
            .map(parseFloat);
          if (values.some((radius) => radius !== 0))
            wrongMenus.push(
              menu.className + ': inner scroll viewport must keep rectangular corners at ' + side,
            );
        }
      }
      for (const list of menu.querySelectorAll('.reasoning-model-list')) {
        if (
          sides.some((side) =>
            getComputedStyle(list)
              .getPropertyValue('border-' + side + '-radius')
              .split(/\s+/)
              .some((radius) => parseFloat(radius) !== 0),
          )
        )
          wrongMenus.push(list.className + ': nested model scroll viewport clips capsule end caps');
      }
      for (const item of items) {
        const itemBox = item.getBoundingClientRect(),
          itemStyle = getComputedStyle(item);
        const width = itemBox.width / scale,
          height = itemBox.height / scale;
        const radii = sides.map((side) => {
          const values = itemStyle.getPropertyValue('border-' + side + '-radius').split(/\s+/);
          return [values[0], values[1] ?? values[0]].map(
            (value, axis) =>
              parseFloat(value) * (value.endsWith('%') ? (axis ? height : width) / 100 : 1),
          );
        });
        const factor = Math.min(
          1,
          width / (radii[0][0] + radii[1][0]),
          width / (radii[3][0] + radii[2][0]),
          height / (radii[0][1] + radii[3][1]),
          height / (radii[1][1] + radii[2][1]),
        );
        if (
          width < height - 0.6 ||
          radii.some((corner) =>
            corner.some((radius) => Math.abs(radius * factor - height / 2) > 0.6),
          ) ||
          sides.some((side) => itemStyle.getPropertyValue('corner-' + side + '-shape') !== round)
        )
          wrongMenus.push(item.className + ': menu highlight must have circular capsule end caps');
        const gutters = { left: 0, right: 0 };
        for (let host = item.parentElement; host; host = host.parentElement) {
          // The model list places its gutter inside the existing popup padding.
          if (host === modelList) continue;
          const hostStyle = getComputedStyle(host);
          if (['auto', 'scroll'].includes(hostStyle.overflowY)) {
            const innerWidth = host.getBoundingClientRect().width / scale -
              parseFloat(hostStyle.borderLeftWidth) - parseFloat(hostStyle.borderRightWidth);
            // clientWidth is integer CSS pixels and excludes even an unused stable gutter.
            const gutter = Math.max(0, Math.round(innerWidth) - host.clientWidth);
            if (hostStyle.scrollbarGutter.includes('both-edges')) {
              gutters.left += gutter / 2;
              gutters.right += gutter / 2;
            } else {
              gutters[hostStyle.direction === 'rtl' ? 'left' : 'right'] += gutter;
            }
          }
          if (host === menu) break;
        }
        const insets = {
          left: (itemBox.left - menuBox.left) / scale - gutters.left,
          right: (menuBox.right - itemBox.right) / scale - gutters.right,
        };
        for (const edge of ['left', 'right']) {
          const border = parseFloat(menuStyle.getPropertyValue('border-' + edge + '-width'));
          if (
            Math.abs(
              insets[edge] - border - parseFloat(menuStyle.getPropertyValue('padding-' + edge)),
            ) > 0.6
          )
            wrongMenus.push(
              item.className + ': measured ' + edge + ' inset excludes the popup border/padding',
            );
        }
      }
    }
    const controls = [...document.querySelectorAll('.floating-controls > :not(.is-confirming)')];
    if (controls.length) {
      const reference = getComputedStyle(controls[0]);
      for (const control of controls) {
        const style = getComputedStyle(control);
        for (const property of ['width', 'height', 'border-radius', 'corner-shape']) {
          // 50% and an oversized pixel radius clamp to the same round end cap.
          // Morphing controls keep pixel radii to avoid an oval mid-transition.
          if (property === 'border-radius') {
            const effective = (value) => {
              const limit = Math.min(parseFloat(value.width), parseFloat(value.height)) / 2;
              const radius = value.borderTopLeftRadius;
              return Math.min(
                limit,
                parseFloat(radius) * (radius.endsWith('%') ? parseFloat(value.width) / 100 : 1),
              );
            };
            if (effective(style) !== effective(reference))
              wrong.push(control.className + ': toolbar hover ' + property);
            continue;
          }
          if (style.getPropertyValue(property) !== reference.getPropertyValue(property))
            wrong.push(control.className + ': toolbar hover ' + property);
        }
      }
    }
    const baseline = document.createElement('style');
    baseline.textContent = '* , *::before, *::after { corner-shape: round !important; }';
    document.head.append(baseline);
    const changed = [];
    try {
      for (const sample of samples) {
        const style = getComputedStyle(sample.element, sample.pseudo);
        const geometry = [
          style.width,
          style.height,
          ...sides.map((side) => style.getPropertyValue('border-' + side + '-radius')),
          style.boxShadow,
        ];
        if (JSON.stringify(geometry) !== JSON.stringify(sample.geometry))
          changed.push(sample.label);
      }
    } finally {
      baseline.remove();
    }
    return {
      surfaces: samples.length,
      circles,
      capsules,
      shadows,
      generated,
      cursors,
      wrongCursors,
      wrongMenus,
      wrongSurfaces,
      wrong,
      changed,
    };
  });
  assert.deepEqual(result.wrongCursors, [], `${name}: inconsistent cursor for control type`);
  assert.deepEqual(
    result.wrongMenus,
    [],
    `${name}: inconsistent popup clipping or capsule highlight corners`,
  );
  assert.deepEqual(result.wrongSurfaces, [], `${name}: inconsistent component family surfaces`);
  assert.deepEqual(result.wrong, [], `${name}: rounded surfaces use inconsistent curves`);
  assert.deepEqual(result.changed, [], `${name}: curve changed radii, box sizes or shadow values`);
  return result;
}

// Read native pixels along the expected circular caps, where a second large
// scrolling-surface clip used to remove the first/last row's hover background.
export async function verifyMenuCapsulePixels(page, app, menu, name) {
  const markerId = 'menu-capsule-pixels-' + Date.now();
  await menu.evaluate((node, markerId) => {
    const style = document.createElement('style');
    style.id = markerId;
    style.textContent =
      '#' +
      CSS.escape(node.id) +
      ' .dropdown-item[data-highlighted]:not([data-disabled]) { background: rgb(217, 32, 217) !important; }' +
      '#' +
      CSS.escape(markerId + '-reference') +
      '::backdrop { background: transparent !important; pointer-events: none !important; }';
    document.head.append(style);
  }, markerId);
  const windowId = await (await app.browserWindow(page)).evaluate((win) => win.id);
  const sample = async (clip, points) => {
    return app.evaluate(
      async ({ BrowserWindow }, { windowId, clip, points }) => {
        // Capture the native surface without CDP's temporary DPI emulation,
        // which can move the pointer and clear Radix hover at fractional scale.
        const image = await BrowserWindow.fromId(windowId).webContents.capturePage(clip);
        const size = image.getSize(),
          bytes = image.toBitmap();
        const scaleFactors = image.getScaleFactors();
        if (!size.width || !size.height || bytes.length !== size.width * size.height * 4)
          throw Error(
            'Native capsule bitmap dimensions disagree: ' +
              JSON.stringify({ clip, size, bitmapBytes: bytes.length, scaleFactors }),
          );
        const mapped = points.map(({ x, y }) => {
          const px = Math.min(
            size.width - 1,
            Math.max(0, Math.floor(((x + 0.5) * size.width) / clip.width)),
          );
          const py = Math.min(
            size.height - 1,
            Math.max(0, Math.floor(((y + 0.5) * size.height) / clip.height)),
          );
          return {
            px,
            py,
            x: ((px + 0.5) * clip.width) / size.width,
            y: ((py + 0.5) * clip.height) / size.height,
          };
        });
        const readPixel = (px, py) => {
          if (px < 0 || px >= size.width || py < 0 || py >= size.height) return null;
          const offset = (py * size.width + px) * 4;
          return [...bytes.subarray(offset, offset + 3)];
        };
        const colors = mapped.map(({ px, py }) => readPixel(px, py));
        // Capture adjacent physical pixels from this very frame for failure diagnostics.
        const neighbors = mapped.map(({ px, py }) => [
          readPixel(px - 1, py), readPixel(px + 1, py), readPixel(px, py - 1), readPixel(px, py + 1),
        ]);
        return { colors, neighbors, mapped, size, bitmapBytes: bytes.length, scaleFactors };
      },
      { windowId, clip, points },
    );
  };
  const difference = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
  const deviceEdges = (rect, dpi) =>
    ['left', 'top', 'right', 'bottom'].map((edge) => Math.round(rect[edge] * dpi));
  const paintState = (item) =>
    item.evaluate((node) => ({
      background: getComputedStyle(node).backgroundColor,
      highlighted: node.hasAttribute('data-highlighted'),
      hovered: node.matches(':hover'),
      focused: document.activeElement === node,
      rect: node.getBoundingClientRect().toJSON(),
      menuId: node.closest('.dropdown-content').id,
      menuRect: node.closest('.dropdown-content').getBoundingClientRect().toJSON(),
      menuStyle: Object.fromEntries(
        [
          'corner-shape',
          'border-top-left-radius',
          'overflow-x',
          'overflow-y',
          'padding-top',
          'padding-left',
          'border-left-width',
          'opacity',
          'transform',
        ].map((property) => [
          property,
          getComputedStyle(node.closest('.dropdown-content')).getPropertyValue(property),
        ]),
      ),
      visibility: document.visibilityState,
      focus: document.hasFocus(),
      dpi: devicePixelRatio,
      ancestors: [
        ...node
          .closest('.dropdown-content')
          .querySelectorAll(
            '.dropdown-scroll,.reasoning-popup-body,.reasoning-popup-view,.reasoning-model-list',
          ),
      ]
        .filter((ancestor) => ancestor.contains(node))
        .map((ancestor) => {
          const style = getComputedStyle(ancestor);
          return {
            className: ancestor.className,
            rect: ancestor.getBoundingClientRect().toJSON(),
            overflow: [style.overflowX, style.overflowY],
            curve: style.cornerShape,
            radius: style.borderTopLeftRadius,
            opacity: style.opacity,
            transform: style.transform,
            scrollTop: ancestor.scrollTop,
          };
        }),
      animations: node
        .closest('.dropdown-content')
        .getAnimations({ subtree: true })
        .map((animation) => ({
          state: animation.playState,
          currentTime: animation.currentTime,
          endTime: animation.effect?.getComputedTiming().endTime,
        })),
    }));
  const hoverTarget = (item) =>
    item.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const hit = document.elementFromPoint(center.x, center.y);
      return {
        center,
        centerHitsItem: node.contains(hit),
        hit: hit && { tag: hit.localName, id: hit.id, class: hit.getAttribute('class') },
      };
    });
  const observeHover = (item) =>
    item.evaluate((node, markerId) => {
      const marker = document.getElementById(markerId);
      marker.hoverProbe?.controller.abort();
      const controller = new AbortController();
      const events = [];
      marker.hoverProbe = { controller, events };
      const describe = (target) =>
        target instanceof Element
          ? { tag: target.localName, id: target.id, class: target.getAttribute('class') }
          : null;
      for (const type of ['pointermove', 'pointerleave', 'focus', 'blur'])
        node.addEventListener(
          type,
          (event) => {
            events.push({
              type,
              trusted: event.isTrusted,
              x: event.clientX,
              y: event.clientY,
              pointerType: event.pointerType,
              target: describe(event.target),
              related: describe(event.relatedTarget),
            });
            if (events.length > 12) events.shift();
          },
          { capture: true, signal: controller.signal },
        );
    }, markerId);
  const hoverDiagnostics = async () => ({
    events: await page.evaluate((id) => document.getElementById(id)?.hoverProbe?.events, markerId),
    native: await app.evaluate(({ BrowserWindow }, windowId) => {
      const window = BrowserWindow.fromId(windowId);
      return {
        focusedWindow: BrowserWindow.getFocusedWindow()?.id,
        windowId,
        focused: window.isFocused(),
        visible: window.isVisible(),
        content: window.getContentBounds(),
      };
    }, windowId),
  });
  const paintedFrames = async () => {
    await page.waitForFunction(
      (menuId) => {
        const menu = document.getElementById(menuId);
        return (
          menu &&
          !menu.hasAttribute('data-menu-height-motion') &&
          menu
            .getAnimations({ subtree: true })
            .every(
              (animation) =>
                animation.effect?.getComputedTiming().endTime === Infinity ||
                (!animation.pending && animation.playState !== 'running'),
            )
        );
      },
      await menu.getAttribute('id'),
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  };
  try {
    const items = menu.locator('.dropdown-item');
    for (const [item, edge] of [
      [items.first(), 'top'],
      [items.last(), 'bottom'],
    ]) {
      await item.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await menu.focus();
      assert.equal(
        await item.evaluate((node) => node.hasAttribute('data-highlighted')),
        false,
        name + ': raster baseline must not highlight the sampled item',
      );
      await paintedFrames();
      const box = await item.boundingBox();
      const clip = {
        x: Math.floor(box.x),
        y: Math.floor(box.y),
        width: Math.ceil(box.x + box.width) - Math.floor(box.x),
        height: Math.ceil(box.y + box.height) - Math.floor(box.y),
      };
      const offsetX = box.x - clip.x,
        offsetY = box.y - clip.y,
        radius = box.height / 2;
      const points = [
        {
          x: Math.floor(offsetX + box.width / 2),
          y: Math.round(offsetY + (edge === 'top' ? 4 : box.height - 5)),
          corner: 'reference',
        },
      ];
      // Choose pixel centers fully inside the mathematical circle, close enough
      // to its edge to detect the old 35px continuous inner clipping curve.
      for (let y = 0; y < clip.height; y++)
        for (let x = 0; x < clip.width; x++) {
          const localX = x + 0.5 - offsetX,
            localY = y + 0.5 - offsetY;
          const dy = edge === 'top' ? localY : box.height - localY;
          for (const [corner, dx] of [
            ['left', localX],
            ['right', box.width - localX],
          ]) {
            if (dx <= 0 || dx >= radius || dy <= 0 || dy >= radius) continue;
            const inset = radius - Math.hypot(radius - dx, radius - dy);
            if (inset >= 0.85 && inset <= 2.5) points.push({ x, y, corner, inset });
          }
        }
      for (const corner of ['left', 'right'])
        assert.ok(
          points.filter((point) => point.corner === corner).length >= 3,
          name + ': capsule corner raster samples are required',
        );
      const outside = [
        {
          x: Math.round(offsetX + 1),
          y: Math.round(offsetY + (edge === 'top' ? 1 : box.height - 2)),
        },
        {
          x: Math.round(offsetX + box.width - 2),
          y: Math.round(offsetY + (edge === 'top' ? 1 : box.height - 2)),
        },
      ];
      await paintedFrames();
      const before = await paintState(item);
      const baselineRaster = await sample(clip, points);
      const baseline = baselineRaster.colors;
      const referenceId = markerId + '-reference';
      let circularRaster, circularRect;
      try {
        circularRect = await page.evaluate(
          ({ referenceId, itemRect }) => {
            const reference = document.createElement('div');
            reference.id = referenceId;
            reference.popover = 'manual';
            reference.inert = true;
            reference.setAttribute('aria-hidden', 'true');
            reference.style.cssText =
              'position:fixed!important;inset:auto!important;margin:0!important;' +
              'border:0!important;padding:0!important;box-sizing:border-box!important;' +
              'width:auto!important;height:auto!important;' +
              'border-radius:999px!important;corner-shape:round!important;' +
              'background:rgb(217,32,217)!important;opacity:1!important;' +
              'box-shadow:none!important;filter:none!important;backdrop-filter:none!important;' +
              'transform:none!important;animation:none!important;transition:none!important;' +
              'pointer-events:none!important;';
            // Resolve the four absolute edges independently. Rounding a copied width
            // before adding it to a fractional left can move the far edge by a pixel.
            const edges = ['left', 'top', 'right', 'bottom'];
            const placeEdge = (edge, coordinate) => {
              const value = edge === 'right' || edge === 'bottom'
                ? `calc(100% - ${coordinate}px)` : coordinate + 'px';
              reference.style.setProperty(edge, value, 'important');
            };
            for (const edge of edges) placeEdge(edge, itemRect[edge]);
            document.body.append(reference);
            // The top layer escapes all menu ancestor clips. If its layout grid
            // straddles a half-device-pixel tie, select the adjacent layout unit
            // on the item's side. Both CSS geometry and device edges are checked below.
            reference.showPopover();
            const initial = reference.getBoundingClientRect();
            for (const edge of edges) {
              const target = Math.round(itemRect[edge] * devicePixelRatio);
              const current = Math.round(initial[edge] * devicePixelRatio);
              if (target !== current)
                placeEdge(edge, itemRect[edge] + Math.sign(target - current) / 64);
            }
            return reference.getBoundingClientRect().toJSON();
          },
          { referenceId, itemRect: before.rect },
        );
        for (const key of ['x', 'y', 'width', 'height'])
          assert.ok(
            Math.abs(circularRect[key] - box[key]) <= 1 / 64,
            name +
              ': independent round reference must keep the exact item rect: ' +
              JSON.stringify({ box, circularRect }),
          );
        assert.deepEqual(
          deviceEdges(circularRect, before.dpi), deviceEdges(before.rect, before.dpi),
          name + ': reference and item device edges must match before hover: ' +
            JSON.stringify({ dpi: before.dpi, item: before.rect, reference: circularRect }),
        );
        await paintedFrames();
        circularRaster = await sample(clip, [...points, ...outside]);
      } finally {
        await page.evaluate((id) => document.getElementById(id)?.remove(), referenceId);
      }
      assert.deepEqual(
        baselineRaster.size,
        circularRaster.size,
        name + ': baseline and round reference must share one native pixel grid',
      );
      for (const corner of ['left', 'right'])
        assert.ok(
          points.filter(
            (point, index) =>
              point.corner === corner &&
              difference(circularRaster.colors[index], baseline[index]) > 80,
          ).length >= 3,
          name + ': round reference must paint contrasting ' + corner + ' cap samples',
        );
      // Removing the reference changes Chromium's top-layer hit-test state.
      // Wait for that frame to settle, then move the pointer without another
      // locator scroll or focus operation between hit testing and capture.
      await paintedFrames();
      await observeHover(item);
      const ready = await hoverTarget(item);
      if (!ready.centerHitsItem)
        assert.fail(
          name +
            ': capsule hover target is occluded: ' +
            JSON.stringify({
              edge,
              ready,
              ...(await hoverDiagnostics()),
            }),
        );
      await page.mouse.move(ready.center.x, ready.center.y);
      await paintedFrames();
      const after = await paintState(item);
      if (!after.highlighted || !after.hovered || !after.focused)
        assert.fail(
          name +
            ': pointer highlight did not survive to the painted frame: ' +
            JSON.stringify({
              edge,
              ready,
              after,
              ...(await hoverDiagnostics()),
            }),
        );
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(
          Math.abs(after.rect[key] - circularRect[key]) <= 1 / 64,
          name +
            ': hover must preserve the reference raster phase: ' +
            JSON.stringify({ actual: after.rect, circularRect }),
        );
      assert.deepEqual(
        deviceEdges(after.rect, after.dpi), deviceEdges(circularRect, before.dpi),
        name + ': hover must preserve all four reference device edges: ' +
          JSON.stringify({ dpi: after.dpi, item: after.rect, reference: circularRect }),
      );
      const highlightedRaster = await sample(clip, [...points, ...outside]);
      const highlighted = highlightedRaster.colors;
      assert.deepEqual(
        highlightedRaster.size,
        circularRaster.size,
        name + ': actual and round reference must share one native pixel grid',
      );
      const reference = highlighted[0];
      if (!(difference(reference, baseline[0]) > 80))
        assert.fail(
          name +
            ': hover must paint a real contrasting background: ' +
            JSON.stringify({
              edge,
              reference,
              baseline: baseline[0],
              referencePoint: points[0],
              clip,
              before,
              after,
              baselineImage: { size: baselineRaster.size, bitmapBytes: baselineRaster.bitmapBytes },
              highlightedImage: {
                size: highlightedRaster.size,
                bitmapBytes: highlightedRaster.bitmapBytes,
              },
              hover: await hoverDiagnostics(),
              marker: await page.evaluate(
                (id) => document.getElementById(id)?.textContent,
                markerId,
              ),
            }),
        );
      // Near-edge antialiasing depends on the native pixel phase. Compare each
      // cap with the independently round reference at that exact output pixel,
      // rather than requiring its coverage to match a solid center pixel.
      for (let index = 1; index < points.length; index++) {
        const delta = difference(highlighted[index], circularRaster.colors[index]);
        if (delta <= 28) continue;
        const mapped = highlightedRaster.mapped[index];
        const viewportPoint = { x: clip.x + mapped.x, y: clip.y + mapped.y };
        const hit = await item.evaluate((node, { x, y }) => {
          const target = document.elementFromPoint(x, y);
          const wrapper = node.closest('[data-radix-popper-content-wrapper]');
          return { item: node.contains(target), target: target?.className, wrapperTransform: wrapper && getComputedStyle(wrapper).transform };
        }, viewportPoint);
        const rect = ({ x, y, width, height }) => [x, y, width, height];
        assert.fail(name + ': ' + edge + ' ' + points[index].corner + ' capsule pixel mismatch: ' +
          JSON.stringify({
            delta, actual: highlighted[index], reference: circularRaster.colors[index],
            baseline: baseline[index], solid: reference, point: points[index], mapped,
            viewportPoint, hit, dpi: after.dpi, clip: rect(clip), bitmap: highlightedRaster.size,
            actualRect: rect(after.rect), referenceRect: rect(circularRect), menuRect: rect(after.menuRect),
            ancestorClips: after.ancestors.map(a => [a.className, rect(a.rect), a.overflow, a.radius]),
            neighborsLeftRightUpDown: { actual: highlightedRaster.neighbors[index], reference: circularRaster.neighbors[index] },
          }));
      }
      for (const pixel of circularRaster.colors.slice(points.length))
        assert.ok(
          difference(pixel, circularRaster.colors[0]) > 80,
          name + ': round reference exterior must remain unpainted',
        );
      for (const pixel of highlighted.slice(points.length))
        assert.ok(
          difference(pixel, reference) > 80,
          name + ': capsule exterior must remain unpainted',
        );
    }
  } finally {
    await page.evaluate((id) => {
      const marker = document.getElementById(id);
      marker?.hoverProbe?.controller.abort();
      marker?.remove();
    }, markerId);
  }
}

// Compare native raster output with a circular baseline at the same radii.
// Pixel checks cover child clipping and shadow paint independently of CSS text.
export async function verifyCornerRendering(page, app) {
  const selector = '#continuous-corner-render-probe';
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'continuous-corner-render-probe';
    // Buttons are capsules in the shared fallback. Exercise a continuous
    // reading card here, then verify the circular send control separately.
    probe.className = 'profile-summary';
    probe.style.cssText =
      'position:fixed;left:40px;top:40px;width:120px;height:80px;z-index:2147483647;' +
      'border:0;overflow:hidden;background:#008060;box-shadow:0 0 0 6px #f00;pointer-events:auto;';
    const fill = document.createElement('span');
    fill.style.cssText = 'position:absolute;inset:0;background:#008060;';
    probe.append(fill);
    const reference = document.createElement('span');
    reference.style.cssText =
      'position:absolute;left:54px;top:34px;width:12px;height:12px;background:#f00;';
    probe.append(reference);
    document.body.append(probe);
  });
  const pixels = async () => {
    const png = await page.screenshot({
      clip: { x: 32, y: 32, width: 136, height: 96 },
      scale: 'css',
      animations: 'disabled',
    });
    return app.evaluate(({ nativeImage }, png) => {
      const image = nativeImage.createFromBuffer(Buffer.from(png, 'base64'));
      return { size: image.getSize(), bytes: [...image.toBitmap()] };
    }, png.toString('base64'));
  };
  const pixel = (image, x, y) =>
    image.bytes.slice((y * image.size.width + x) * 4, (y * image.size.width + x) * 4 + 3);
  const distance = (a, b) => Math.max(...a.map((channel, i) => Math.abs(channel - b[i])));
  const corners = [];
  try {
    for (const radius of [8, 12, 20, 22]) {
      await page.locator(selector).evaluate((probe, radius) => {
        probe.style.borderRadius = radius + 'px';
        probe.style.cornerShape = '';
      }, radius);
      const shaped = await pixels();
      await page.locator(selector).evaluate((probe) => {
        probe.style.cornerShape = 'round';
      });
      const round = await pixels();
      const fill = pixel(shaped, 80, 48);
      let different = 0;
      for (let y = 8; y < 88; y++)
        for (let x = 8; x < 128; x++)
          if (distance(pixel(shaped, x, y), pixel(round, x, y)) > 12) different++;
      const shadow = pixel(shaped, 4, 48);
      const result = {
        radius,
        different,
        clipped: distance(pixel(shaped, 8, 8), fill) > 80,
        shadow: distance(shadow, pixel(shaped, 68, 48)) < 6,
      };
      assert.ok(result.different > 2 && result.clipped && result.shadow, JSON.stringify(result));
      corners.push(result);
    }
    await page.locator(selector).evaluate((probe) => {
      probe.style.borderRadius = '';
      probe.style.cornerShape = '';
      probe.style.width = '80px';
      probe.className = 'ui-button send-button';
    });
    const circle = await pixels();
    assert.ok(distance(pixel(circle, 18, 18), pixel(circle, 80, 48)) > 80);
    return { corners, circularControlClipped: true };
  } finally {
    await page.locator(selector).evaluate((probe) => probe.remove());
  }
}

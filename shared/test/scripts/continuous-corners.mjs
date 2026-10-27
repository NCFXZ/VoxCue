import assert from 'node:assert/strict';

// Chromium may serialize these equivalent CSS curves as keywords or functions.
export function cornerShapeNames(value) {
  const name = (shape) =>
    ({ 'superellipse(1)': 'round', 'superellipse(2)': 'squircle' })[shape] ?? shape;
  return typeof value === 'string'
    ? name(value)
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, name(item)]));
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

// Inspect actual pages, including portal menus and generated selection marks.
// Switching only the curve back to round must not change radii or box geometry.
export async function verifyContinuousCorners(page, name) {
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
        const textField =
          !pseudo &&
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
        const expectedCursor =
          !pseudo && element.matches('.personal-resize-handle')
            ? 'col-resize'
            : textField
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
        const capsule =
          (pseudo === '::before' && element.matches('.nav-item.active,.conversation-row.active')) ||
          (fallback &&
            !pseudo &&
            element.matches(
              '.ui-button:not(.button-icon),.confirm-delete,.download-button,.choice-trigger,.settings-choice,.speech-select,.dropdown-item,.history-filters input[type="search"]',
            )) ||
          element.matches(
            '.settings-switch,.floating-toolbar,.floating-brand,.floating-controls .ui-button,' +
              '.floating-drag-handle,.interview-ready-badge,.floating-toggle.ui-button,.interview-preview-capsule,' +
              '.floating-composer-toolbar .ui-button,.composer-tools .composer-tool,' +
              '.composer-tools .button-icon,.profile-overview > span,.neutral-badge,' +
              '.screen-capture-status,.record-transcript-heading span,' +
              '.interview-answer-status,.suggestions button,.toolbar-actions > .ui-button,.interview-start-dialog .ui-button',
          );
        const roundMenu = !fallback && element.matches('.composer-menu');
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
          if (element.matches('.interview-answer-failure') && style.borderRadius !== answerRadius)
            wrongSurfaces.push(label + ': failure alert differs from answer bubble corners');
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
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!menu.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const trigger = document.getElementById(menu.getAttribute('aria-labelledby'));
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
      if (fallback) {
        if (
          menuStyle.borderRadius !== '20px' ||
          menuStyle.getPropertyValue('corner-top-left-shape') !== continuous
        )
          wrongMenus.push(menu.className + ': fallback popup contour');
        continue;
      }
      for (const side of sides) {
        for (const property of ['border-' + side + '-radius', 'corner-' + side + '-shape']) {
          if (menuStyle.getPropertyValue(property) !== triggerStyle.getPropertyValue(property))
            wrongMenus.push(menu.className + ': ' + property);
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
  assert.deepEqual(result.wrongMenus, [], `${name}: menu corners differ from trigger`);
  assert.deepEqual(result.wrongSurfaces, [], `${name}: inconsistent component family surfaces`);
  assert.deepEqual(result.wrong, [], `${name}: rounded surfaces use inconsistent curves`);
  assert.deepEqual(result.changed, [], `${name}: curve changed radii, box sizes or shadow values`);
  return result;
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

export async function verifyCallbackCorners(app) {
  const fixtures = await app.evaluate(({ app }) => {
    const require = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json');
    const { createAuthCallbackPage } = require(
      app.getAppPath() + '/dist-electron/shared/electron/backend/auth/callbackPage.js',
    );
    const logo = require('node:fs').readFileSync(app.getAppPath() + '/../shared/public/voxcue.png');
    const callback = createAuthCallbackPage(logo);
    return ['received', 'invalid', 'used', 'not-found'].map((state) => ({
      state,
      html: callback.render(state),
    }));
  });
  const opened = app.waitForEvent('window');
  await app.evaluate(async ({ BrowserWindow }, html) => {
    const window = new BrowserWindow({
      show: false,
      width: 980,
      height: 800,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  }, fixtures[0].html);
  const page = await opened;
  const window = await app.browserWindow(page);
  const checks = [];
  try {
    for (const width of [980, 360]) {
      await window.evaluate((window, width) => window.setSize(width, 800), width);
      for (const { state, html } of fixtures) {
        await page.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
        for (const theme of ['light', 'dark']) {
          await page.emulateMedia({ colorScheme: theme });
          const name = `callback-${state}-${width}-${theme}`;
          const corners = await verifyContinuousCorners(page, name);
          const contained = await page.locator('.card').evaluate((card) => {
            const bounds = card.getBoundingClientRect();
            return (
              bounds.left >= 0 &&
              bounds.right <= innerWidth &&
              document.documentElement.scrollWidth <= innerWidth
            );
          });
          assert.equal(contained, true, name);
          await page.screenshot({ animations: 'disabled' });
          checks.push({ name, corners });
        }
      }
    }
  } finally {
    await page.close();
  }
  return checks;
}

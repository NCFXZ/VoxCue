import assert from 'node:assert/strict';

export async function assertPasswordVisibility(dialog, input, syntheticPassword) {
  const show = dialog.getByRole('button', { name: '显示密码', exact: true });
  const hide = dialog.getByRole('button', { name: '隐藏密码', exact: true });
  const focused = locator => locator.evaluate(node => node === document.activeElement);
  const id = await input.getAttribute('id');
  assert.ok(id);
  assert.equal(await show.getAttribute('aria-controls'), id);
  assert.equal(await show.getAttribute('aria-pressed'), 'false');
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(await input.inputValue(), '');
  await input.fill(syntheticPassword);
  for (const button of [show, hide]) {
    await button.click();
    assert.equal(await input.getAttribute('type'), button === show ? 'text' : 'password');
    assert.equal(await input.inputValue(), syntheticPassword);
    assert.ok(await focused(input), 'Mouse toggling must preserve the active password field');
  }
  await input.press('Tab');
  assert.ok(await focused(show), 'The eye button follows the field in keyboard order');
  await show.press('Space');
  assert.equal(await hide.getAttribute('aria-controls'), id);
  assert.equal(await hide.getAttribute('aria-pressed'), 'true');
  assert.equal(await input.getAttribute('type'), 'text');
  assert.equal(await input.inputValue(), syntheticPassword);
  assert.ok(await focused(hide));
  await hide.press('Enter');
  assert.equal(await input.getAttribute('type'), 'password');
  assert.equal(await input.inputValue(), syntheticPassword);
  assert.equal(await show.getAttribute('aria-pressed'), 'false');
  assert.ok(await focused(show));
  await show.press('Shift+Tab');
  assert.ok(await focused(input));
}

export async function assertPasswordClearedOnClose(dialog, input, close) {
  await dialog.page().emulateMedia({ reducedMotion: 'no-preference' });
  await dialog.getByRole('button', { name: '显示密码', exact: true }).click();
  assert.equal(await input.getAttribute('type'), 'text');
  assert.ok(await input.evaluate(field => field.value.length > 0));
  const observation = await dialog.evaluateHandle(() => {
    let result;
    const observer = new MutationObserver(() => {
      const snapshot = document.querySelector('[data-modal-exit]:popover-open');
      const field = snapshot?.querySelector('input[data-password-input]');
      if (field) result = {
        masked: field.type === 'password', cleared: field.value === '',
        attributeRemoved: !field.hasAttribute('value'), inert: snapshot.inert,
      };
    });
    observer.observe(document.body, { childList: true });
    return { result: () => result, stop: () => observer.disconnect() };
  });
  try {
    await close();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(await observation.evaluate(probe => probe.result()), {
      masked: true, cleared: true, attributeRemoved: true, inert: true,
    }, 'The visible exit snapshot must clear even a revealed password before painting');
  } finally {
    await observation.evaluate(probe => probe.stop());
    await observation.dispose();
  }
}

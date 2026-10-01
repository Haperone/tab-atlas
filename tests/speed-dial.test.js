import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedDialController } from '../extension/lib/speed-dial.js';

function fixture() {
  const store = new Map();
  let undo = null;
  const elements = {
    speedDial: { style: {}, innerHTML: '', contains: () => false },
    speedDialLabelInput: { value: 'Example' },
    speedDialUrlInput: { value: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, focus() {} },
    speedDialUrlError: { hidden: true, textContent: '' },
    speedDialDialog: { open: true, style: {}, close() { this.open = false; } },
  };
  const document = { getElementById: id => elements[id], body: { appendChild() {} } };
  elements.speedDialDialog.ownerDocument = document;
  elements.speedDialDialog.querySelector = () => null;
  const controller = createSpeedDialController({ document,
    storage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
    escapeHtml: value => value, favIcon: () => '', showToast: (_message, callback) => { undo = callback; },
  });
  return { controller, elements, undo: () => undo };
}

test('invalid shortcut addresses preserve the editor and never alter stored shortcuts', () => {
  const { controller, elements } = fixture();
  for (const url of ['', 'https://', 'bad address', 'mailto:test@example.com', 'javascript:alert(1)']) {
    elements.speedDialUrlInput.value = url;
    controller.saveSpeedDialFromDialog();
    assert.deepEqual(controller.getSpeedDialItems(), []);
    assert.equal(elements.speedDialDialog.open, true);
    assert.equal(elements.speedDialLabelInput.value, 'Example');
    assert.equal(elements.speedDialUrlError.hidden, false);
    assert.equal(elements.speedDialUrlInput.attributes['aria-invalid'], 'true');
  }
});

test('bare domains become website shortcuts and deletion Undo preserves later additions', () => {
  const { controller, elements, undo } = fixture();
  elements.speedDialUrlInput.value = 'github.com';
  controller.saveSpeedDialFromDialog();
  const first = controller.getSpeedDialItems()[0];
  assert.equal(first.url, 'https://github.com/');
  controller.removeSpeedDial(first.id);
  const restore = undo();
  elements.speedDialUrlInput.value = 'https://example.org/path';
  controller.saveSpeedDialFromDialog();
  const second = controller.getSpeedDialItems()[0];
  restore(); restore();
  assert.deepEqual(controller.getSpeedDialItems().map(item => item.id), [first.id, second.id]);
});

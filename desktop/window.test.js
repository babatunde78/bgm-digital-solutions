'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const showWindow = require('./window');
test('a minimized window is restored before it is shown and focused', () => {
  const calls = [];
  showWindow({ isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push('restore'), show: () => calls.push('show'), focus: () => calls.push('focus') });
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});
test('a normal window is shown without an unnecessary restore', () => {
  const calls = [];
  showWindow({ isDestroyed: () => false, isMinimized: () => false, show: () => calls.push('show'), focus: () => calls.push('focus') });
  assert.deepEqual(calls, ['show', 'focus']);
});
test('unavailable windows are ignored during startup or shutdown', () => {
  assert.equal(showWindow(undefined), undefined);
  assert.equal(showWindow({ isDestroyed: () => true }), undefined);
});

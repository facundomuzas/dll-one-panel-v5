/* Optional distraction-free workspace. Never changes accounts, permissions or data. */
function setWorkspaceMode(expanded) {
  const app = document.getElementById('app');
  const button = document.getElementById('workspaceModeButton');
  if (!app || !button) return;
  app.classList.toggle('focus-mode', Boolean(expanded));
  button.setAttribute('aria-pressed', String(Boolean(expanded)));
  button.setAttribute('aria-label', expanded ? 'Mostrar menú del panel' : 'Expandir espacio de trabajo');
  button.textContent = expanded ? '⤡ Mostrar menú' : '⤢ Expandir';
}
window.toggleWorkspaceMode = function toggleWorkspaceMode() {
  setWorkspaceMode(!document.getElementById('app')?.classList.contains('focus-mode'));
};
window.resetWorkspaceMode = function resetWorkspaceMode() {
  setWorkspaceMode(false);
};

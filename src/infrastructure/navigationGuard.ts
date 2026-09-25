const eventName = 'fluxcode:before-workspace-navigation';
/** Editors flush local drafts before navigation; failed persistence can keep them visible. */
export function allowWorkspaceNavigation(): boolean {
  return window.dispatchEvent(new Event(eventName, { cancelable: true }));
}
export function guardWorkspaceNavigation(flush: () => boolean): () => void {
  const listener = (event: Event) => {
    if (!flush()) event.preventDefault();
  };
  window.addEventListener(eventName, listener);
  return () => window.removeEventListener(eventName, listener);
}

import { reactive } from 'vue'

/**
 * Bridge between a game flow and the shell header.
 *
 * The shell owns the chrome, but only a running game knows whether quitting
 * makes sense and what to call it. A flow registers its action while it is
 * mounted and clears it on the way out, so the header stays game-agnostic.
 */
export const shellChrome = reactive<{
  quitLabel: string
  quit: (() => void) | null
  /** Optional role badge next to the brand, e.g. "Host" in a live room. */
  context: string
}>({
  quitLabel: '',
  quit: null,
  context: '',
})

export function setQuitAction(label: string, quit: () => void) {
  shellChrome.quitLabel = label
  shellChrome.quit = quit
}

export function clearQuitAction() {
  shellChrome.quit = null
}

export function setGameContext(label: string) {
  shellChrome.context = label
}

export function clearGameContext() {
  shellChrome.context = ''
}

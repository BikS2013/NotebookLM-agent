/**
 * IPC channel name constants. Used in both main and preload to avoid string typos.
 * Each channel is a unique string literal.
 */
export const IPC = {
  // Renderer -> Main (invoke/handle)
  OPEN_FILE:              'proxy-inspector:open-file',
  OPEN_RECENT:            'proxy-inspector:open-recent',
  GET_INTERACTION_DETAIL: 'proxy-inspector:get-interaction-detail',
  SEARCH:                 'proxy-inspector:search',
  PAUSE_WATCH:            'proxy-inspector:pause-watch',
  GET_RECENT_FILES:       'proxy-inspector:get-recent-files',

  // Main -> Renderer (send/on)
  FILE_DATA:              'proxy-inspector:file-data',
  NEW_EVENTS:             'proxy-inspector:new-events',
} as const;

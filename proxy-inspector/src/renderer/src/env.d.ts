import type { ProxyInspectorAPI } from '@shared/ipc-types'

declare global {
  interface Window {
    api: ProxyInspectorAPI
  }
}

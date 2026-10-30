declare module 'claude-code' {
  interface PluginState {
    'approval-signal-spike': { key: string }
  }
}
export type SpikeKey = string

export type TerminalKey = string

declare module 'claude-code' {
  interface PluginState {
    'cc-status-light': { terminal: TerminalKey }
  }
}

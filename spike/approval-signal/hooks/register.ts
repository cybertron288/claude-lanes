import type { Register, EngineInterface } from 'claude-code'

// Throwaway spike: append every signal near a permission dialog to events.log.
const LOG = '/Users/ravi/claude-misc/cc-status-light/spike/approval-signal/events.log'
const MODULE_KEY = crypto.randomUUID().slice(0, 8)
const lines: string[] = []
let chain: Promise<unknown> = Promise.resolve()

function log($: EngineInterface, o: Record<string, unknown>) {
  lines.push(JSON.stringify({ ms: Date.now() % 1000000, ...o }))
  const text = lines.join('\n') + '\n'
  chain = chain.then(() => $.fs.write(LOG, text)).catch(() => {})
}

function classic($: EngineInterface, ev: string, e: any) {
  log($, {
    ev: `classic.${ev}`, tool: e.tool_name, id: e.tool_use_id,
    notification_type: e.notification_type, message: e.message,
  })
}

function render($: EngineInterface, component: string, p: any) {
  log($, {
    ev: `render:${component}`, id: p?.tool_use_id, tool: p?.tool,
    isRunning: p?.isRunning, isErrored: p?.isErrored, isInterrupted: p?.isInterrupted, kind: p?.kind,
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    log($, { ev: 'session.start', isInteractive: e.isInteractive, surface: e.surface })
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    log($, { ev: 'session.end', reason: e.reason, sessionId: e.sessionId })
    return next(e)
  })
  on('prompt.submit', async ($, e, next) => {
    const held = await $.state.get({ plugin: 'approval-signal-spike', key: 'key' })
    if (held.value === undefined) await $.state.set({ plugin: 'approval-signal-spike', key: 'key' }, crypto.randomUUID())
    log($, { ev: 'prompt.submit', stateKey: held.value ?? 'unset', moduleKey: MODULE_KEY, sessionId: $.session.id() })
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    log($, { ev: 'turn.start', agentId: e.agentId })
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    log($, { ev: 'turn.complete', reason: e.reason })
    return next(e)
  })

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    log($, {
      ev: 'tool.check', tool: e.tool, id: e.tool_use_id, agentId: e.agentId,
      approver: e.approver, decision: r.decision, reason: r.reason, hook: r.hook,
      rule: r.rule, setting: r.setting, plugin: (r as any).plugin, isReadOnly: e.isReadOnly,
    })
    return r
  })

  on('tool.call', async ($, e, next) => {
    log($, { ev: 'tool.call:before', tool: e.tool, id: e.tool_use_id, agentId: e.agentId })
    try {
      const r = await next(e)
      log($, { ev: 'tool.call:after', tool: e.tool, id: e.tool_use_id, deny: r.deny, isError: r.isError })
      return r
    } catch (err) {
      log($, { ev: 'tool.call:reject', tool: e.tool, id: e.tool_use_id, err: String(err) })
      throw err
    }
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => (render($, 'ToolUse', e.props), next(e)))
  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => (render($, 'ToolProgress', e.props), next(e)))
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => (render($, 'AskUserQuestion', e.props), next(e)))

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const p = e.props as any
    log($, {
      ev: 'render:ToolGroup', isActive: p?.isActive,
      calls: (p?.calls ?? []).map((c: any) => `${c.tool}:${c.tool_use_id?.slice(-6)}:${c.isRunning ? 'run' : 'idle'}${c.output === undefined ? '' : ':out'}`),
    })
    return next(e)
  })
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const p = e.props as any
    log($, { ev: 'render:Spinner', word: p?.word, message: p?.message, suffix: p?.suffix })
    return next(e)
  })
  on('session.append', async ($, e, next) => {
    const m = e.message as any
    log($, { ev: 'session.append', door: e.door, agentId: e.agentId, type: m?.type, role: m?.role })
    return next(e)
  })

  on('classic.PermissionRequest', async ($, e, next) => (classic($, 'PermissionRequest', e), next(e)))
  on('classic.PermissionDenied', async ($, e, next) => (classic($, 'PermissionDenied', e), next(e)))
  on('classic.Notification', async ($, e, next) => (classic($, 'Notification', e), next(e)))
  on('classic.PostToolUse', async ($, e, next) => (classic($, 'PostToolUse', e), next(e)))
  on('classic.PostToolUseFailure', async ($, e, next) => (classic($, 'PostToolUseFailure', e), next(e)))
}

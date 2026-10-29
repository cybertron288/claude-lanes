import type { ClientEvent } from './protocol'
import type { Schedule } from './tracker'

export type Reporter = {
  report(ev: ClientEvent): void
  flush(): Promise<void>
}

export type ReporterOptions = { debounceMs?: number; timeoutMs?: number; retryMs?: number }

// Sends events to the Worker, never in the caller's way: report() returns at
// once, one request is in flight at a time, consecutive states coalesce to the
// last, and anything unsent stays queued for the next flush or retry.
export function createReporter(
  send: (ev: ClientEvent) => Promise<unknown>,
  schedule: Schedule,
  { debounceMs = 250, timeoutMs = 3000, retryMs = 5000 }: ReporterOptions = {},
): Reporter {
  const queue: ClientEvent[] = []
  let timer: { cancel: () => void; isRetry: boolean } | null = null

  const arm = (ms: number, isRetry: boolean) => {
    timer?.cancel()
    const cancel = schedule(ms, () => {
      timer = null
      void flush()
    })
    timer = { cancel, isRetry }
  }

  // $.http.fetch takes no AbortSignal: a hung request is abandoned, not aborted.
  const bounded = (ev: ClientEvent) =>
    new Promise<void>((resolve, reject) => {
      const cancel = schedule(timeoutMs, () => reject(new Error(`no answer in ${timeoutMs} ms`)))
      Promise.resolve()
        .then(() => send(ev))
        .then(
          () => (cancel(), resolve()),
          err => (cancel(), reject(err)),
        )
    })

  // One drain at a time; a flush during a drain waits for it, and the drain
  // picks up whatever was queued meanwhile.
  let draining: Promise<void> | null = null
  function flush(): Promise<void> {
    draining ??= (async () => {
      try {
        while (queue.length > 0) {
          await bounded(queue[0]!)
          queue.shift()
        }
      } catch {
        arm(retryMs, true)
      } finally {
        draining = null
      }
    })()
    return draining
  }

  return {
    report(ev) {
      const last = queue.at(-1)
      const isLastInFlight = draining !== null && queue.length === 1
      if (ev.kind === 'state' && last?.kind === 'state' && !isLastInFlight) queue[queue.length - 1] = ev
      else queue.push(ev)
      if (!timer || timer.isRetry) arm(debounceMs, false)
    },
    flush() {
      timer?.cancel()
      timer = null
      return flush()
    },
  }
}

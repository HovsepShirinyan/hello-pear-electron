module.exports = function createUpdateRequest(
  getWorker,
  {
    timeoutMs = 120000,
    setTimeout: schedule = setTimeout,
    clearTimeout: cancel = clearTimeout
  } = {}
) {
  // The updater sets its applied latch before replacing files. Keep the outcome
  // for this worker so another caller cannot retry a failed or uncertain swap.
  const attempts = new WeakMap()

  return () => {
    let pipe
    try {
      pipe = getWorker()
    } catch (error) {
      return Promise.reject(error)
    }

    if (attempts.has(pipe)) return attempts.get(pipe)

    let resolveRequest
    let rejectRequest
    const request = new Promise((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    attempts.set(pipe, request)

    const subscriptions = []
    let settled = false
    let timeout

    function listen(target, event, listener) {
      target.on(event, listener)
      subscriptions.push(() => target.removeListener(event, listener))
    }

    function finish(error) {
      if (settled) return
      settled = true
      if (timeout !== undefined) cancel(timeout)
      for (const unsubscribe of subscriptions) unsubscribe()
      if (error) rejectRequest(error)
      else resolveRequest()
    }

    function fail(error) {
      const reason = error instanceof Error ? error.message : 'The update worker failed.'
      const restart = 'Restart the app before trying again.'
      finish(new Error(reason + (reason.endsWith(restart) ? '' : ' ' + restart)))
    }

    try {
      if (pipe.destroyed || pipe.destroying) throw new Error('The update worker is unavailable.')

      listen(pipe, 'data', (data) => {
        const message = data.toString()
        if (message === 'pear:updateApplied') finish()
        else if (message === 'pear:updateFailed' || message.startsWith('pear:updateFailed ')) {
          fail(new Error(message.slice('pear:updateFailed'.length).trim() || 'Update failed.'))
        }
      })
      listen(pipe, 'error', fail)
      listen(pipe, 'close', () => fail(new Error('The update connection closed.')))
      if (pipe.rawStream) {
        listen(pipe.rawStream, 'exit', () => fail(new Error('The update worker stopped.')))
        listen(pipe.rawStream, 'error', fail)
      }
      timeout = schedule(
        () => fail(new Error('Update status could not be confirmed in time.')),
        timeoutMs
      )
      pipe.write('pear:applyUpdate')
    } catch (error) {
      fail(error)
    }

    return request
  }
}

// RPC response handling and the controller's retryable settings cache.
const CHANNEL = '/session-recap'
const ID = 'wombat9000-session-recap'

function unwrap(result) {
  if (!result?.ok) {
    throw new Error(result?.error?.message || 'Session recap is unavailable.')
  }
  return result.value
}

function createSettingsReader(rpc) {
  let pending

  function settings() {
    pending ??= rpc.call(CHANNEL, 'settings', {}).then(unwrap).catch((error) => {
      pending = undefined
      throw error
    })
    return pending
  }

  function invalidate() {
    pending = undefined
  }

  return { settings, invalidate }
}

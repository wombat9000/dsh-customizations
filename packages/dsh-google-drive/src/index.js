import { DRIVE_SCOPE, GoogleDriveClient } from './google.js'

export const name = 'google-drive'
export const inject = ['googleAuth']

// Authentication and credential persistence belong to the shared Google service.
export class GoogleDriveService {
  #client
  constructor({ googleAuth, fetch } = {}) {
    if (typeof googleAuth?.withAccessToken !== 'function') throw new Error('Google authentication service is required.')
    this.#client = new GoogleDriveClient({ withAccessToken: operation => googleAuth.withAccessToken('google-drive', operation), fetch })
  }
  listFiles(args) { return this.#client.listFiles(args) }
  dispose() { this.#client.dispose() }
}

export function apply(ctx) {
  ctx.effect(() => ctx.googleAuth.registerIntegration({
    id: 'google-drive', label: 'Google Drive', scopes: [DRIVE_SCOPE],
  }))
  const service = new GoogleDriveService({ googleAuth: ctx.googleAuth })
  ctx.effect(() => () => service.dispose())
  // Publish metadata only, including no token or account-management methods.
  ctx.provide('googleDrive', { listFiles: args => service.listFiles(args) })
}

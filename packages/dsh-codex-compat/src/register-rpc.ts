import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'

type Handle = Context['connection']['rpc']['handle']

/** RC5's rpc getter passes a shadow context to its registrar. Pass the plugin's
 * injected scope explicitly; the native registrar still owns admission, protocol
 * validation, peer identity, and disposal of the route. */
export function registerRpc(ctx: Context, ...args: Parameters<Handle>): ReturnType<Handle> {
  const connection = ctx.connection
  const register = Reflect.get(connection, 'register')
  if (typeof register !== 'function') return connection.rpc.handle(...args)
  return Reflect.apply(register, connection, [ctx, ...args])
}

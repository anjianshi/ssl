import path from 'node:path'
import { isFileExists } from '@anjianshi/utils/env-node/fs.js'

/**
 * 确认工作目录是否有效
 */
export async function confirmWorkDirectory(workDirectory: string) {
  const resolved = path.resolve(workDirectory)
  const configFilepaths = [path.join(resolved, 'config.json5'), path.join(resolved, 'config.json')]
  const isValid = (await Promise.all(configFilepaths.map(isFileExists))).some(v => v)
  return {
    resolved,
    isValid,
  }
}

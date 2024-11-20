import path from 'node:path'
import { isFileExists } from '@anjianshi/utils/env-node/fs.js'

/**
 * 确认工作目录是否有效
 */
export async function confirmWorkDirectory(workDirectory: string) {
  const resolved = path.resolve(workDirectory)
  const configFilepath = path.join(resolved, 'config.json')
  return {
    resolved,
    isValid: await isFileExists(configFilepath),
  }
}

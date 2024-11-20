/**
 * 维护 CA 账号（account.json）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeParseJSON } from '@anjianshi/utils'
import { isFileExists } from '@anjianshi/utils/env-node/fs.js'

interface SavedAccounts {
  staging?: string
  production?: string
}

async function getSavedAccounts(workDirectory: string) {
  const filepath = path.join(workDirectory, 'account.json')
  const savedAccounts: SavedAccounts = (await isFileExists(filepath))
    ? (safeParseJSON<SavedAccounts>(await fs.readFile(filepath, 'utf-8')) ?? {})
    : {}
  return { filepath, savedAccounts }
}

export async function getSavedAccount(workDirectory: string, staging: boolean) {
  const { savedAccounts } = await getSavedAccounts(workDirectory)
  return savedAccounts[staging ? 'staging' : 'production'] ?? null
}

export async function saveAccount(workDirectory: string, staging: boolean, accountKey: string) {
  const { filepath, savedAccounts } = await getSavedAccounts(workDirectory)
  const key = staging ? 'staging' : 'production'
  savedAccounts[key] = accountKey
  await fs.writeFile(filepath, JSON.stringify(savedAccounts, null, 2))
}

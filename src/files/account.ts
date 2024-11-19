/**
 * 维护 CA 账号（account.json）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeParseJSON } from '@anjianshi/utils'
import { isFileExists } from '@anjianshi/utils/env-node/fs.js'
import { varDir } from '../common.js'

const accountFile = path.join(varDir, 'account.json')
let savedAccounts = undefined as
  | {
      staging: string | null
      production: string | null
    }
  | undefined
type SavedAccounts = NonNullable<typeof savedAccounts>

export async function getSavedAccount(staging: boolean) {
  const key = staging ? 'staging' : 'production'
  if (savedAccounts === undefined) {
    const empty = { staging: null, production: null }
    // eslint-disable-next-line require-atomic-updates
    savedAccounts = (await isFileExists(accountFile))
      ? (safeParseJSON<SavedAccounts>(await fs.readFile(accountFile, 'utf-8')) ?? empty)
      : empty
  }
  return savedAccounts[key]
}

export async function saveAccount(staging: boolean, accountKey: string) {
  await getSavedAccount(staging)

  const key = staging ? 'staging' : 'production'
  savedAccounts![key] = accountKey
  await fs.writeFile(accountFile, JSON.stringify(savedAccounts, null, 2))
}

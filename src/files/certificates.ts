/**
 * 维护生成的证书文件
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { isFileExists, isDirectoryExists } from '@anjianshi/utils/env-node/index.js'
import { sha256, getCommonNameFromDomainNames } from '../common.js'

export interface SavedCertificate {
  certificate: string
  certificateKey: string
  path: string
  keyPath: string
}

export const certficateFilename = 'fullchain.pem'
export const certficateKeyFilename = 'privkey.pem'

export function getCertificateDir(workDirectory: string, staging: boolean, domainNames: string[]) {
  const prefix = staging ? 'staging-' : ''
  const commonName = getCommonNameFromDomainNames(domainNames)
  const dirname = `${prefix}${commonName}-` + sha256(domainNames.join('|')).slice(-8)
  return path.join(workDirectory, 'certificates', dirname)
}

export async function getSavedCertificate(
  workDirectory: string,
  staging: boolean,
  domainNames: string[],
) {
  const dirpath = getCertificateDir(workDirectory, staging, domainNames)
  const certificatePath = path.join(dirpath, certficateFilename)
  const certificateKeyPath = path.join(dirpath, certficateKeyFilename)
  if (!(await isFileExists(certificatePath)) || !(await isFileExists(certificateKeyPath)))
    return null

  const certificate = (await fs.readFile(certificatePath)).toString()
  const certificateKey = (await fs.readFile(certificateKeyPath)).toString()

  return {
    certificate,
    certificateKey,
    path: certificatePath,
    keyPath: certificateKeyPath,
  } as SavedCertificate
}

export async function saveCertificate(
  workDirectory: string,
  staging: boolean,
  domainNames: string[],
  certificate: string | Buffer,
  certificateKey: string | Buffer,
) {
  const dirpath = getCertificateDir(workDirectory, staging, domainNames)
  if (!(await isDirectoryExists(dirpath))) await fs.mkdir(dirpath, { recursive: true })

  const certificatePath = path.join(dirpath, certficateFilename)
  const certificateKeyPath = path.join(dirpath, certficateKeyFilename)
  await Promise.all([
    fs.writeFile(certificatePath, certificate),
    fs.writeFile(certificateKeyPath, certificateKey),
  ])

  return {
    certificate: certificate.toString(),
    certificateKey: certificateKey.toString(),
    path: certificatePath,
    keyPath: certificateKeyPath,
  } as SavedCertificate
}

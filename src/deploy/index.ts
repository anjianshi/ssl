/**
 * 部署证书
 */
import type { SavedCertificate } from '../files/certificates.js'
import { deployToAliyun } from './target-aliyun.js'
import { deployToQiniu } from './target-qiniu.js'
import { type SSHDeployConfig, deployBySSH } from './target-ssh.js'
import { deployToTenCentCloud } from './target-tencent-cloud.js'

// -----------------------------------
// 类型定义
// -----------------------------------

export type TargetConfig =
  | SSHTargetConfig
  | TencentCloudTargetConfig
  | AliyunTargetConfig
  | QiniuTargetConfig

export type SSHTargetConfig = SSHDeployConfig & { type: 'ssh' }

/** 腾讯云 OpenAPI 部署配置，对应账号需要有 cdn 和 ssl 操作权限 */
export interface TencentCloudTargetConfig {
  type: 'tencent-cloud'
  secretId: string
  secretKey: string
}

/**
 * 阿里云 OpenAPI 部署配置
 * 需要权限：AliyunYundunCertFullAccess AliyunCDNFullAccess
 */
export interface AliyunTargetConfig {
  type: 'aliyun'
  secretId: string
  secretKey: string
}

/** 七牛 OpenAPI 部署配置 */
export interface QiniuTargetConfig {
  type: 'qiniu'
  accessKey: string
  secretKey: string
}

// -----------------------------------
// 执行部署
// -----------------------------------

export async function deployCertificate(savedCertificate: SavedCertificate, target: TargetConfig) {
  if (target.type === 'ssh') return await deployBySSH(savedCertificate, target)
  if (target.type === 'tencent-cloud') {
    return await deployToTenCentCloud(savedCertificate, target.secretId, target.secretKey)
  }
  if (target.type === 'aliyun') {
    return await deployToAliyun(savedCertificate, target.secretId, target.secretKey)
  }
  return await deployToQiniu(savedCertificate, target.accessKey, target.secretKey)
}

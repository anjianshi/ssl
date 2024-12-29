/**
 * 处理配置文件（config.json）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { safeParseJSON } from '@anjianshi/utils'
import { isFileExists } from '@anjianshi/utils/env-node/fs.js'
import {
  getValidator,
  type Definition as ValidateDefinition,
} from '@anjianshi/utils/validators/index.js'
import JSON5 from 'json5'
import _ from 'lodash'
import { rootLogger } from '../common.js'
import type {
  TargetConfig,
  SSHTargetConfig,
  TencentCloudTargetConfig,
  AliyunTargetConfig,
  QiniuTargetConfig,
} from '../deploy/index.js'
import type { CreateAccountConfig, DNSChallengeConfig, CSRConfig } from '../request/index.js'

// -----------------------------
// 类型定义（最终整理得到的）
// -----------------------------

export interface Config {
  staging: boolean
  account?: string | CreateAccountConfig
  certificates: CertificateConfig[]
}

export interface CertificateConfig {
  csr: CSRConfig
  challenge: DNSChallengeConfig
  targets: TargetConfig[]
}

// -----------------------------------------
// 类型定义（config.json 内容格式）
// -----------------------------------------

export interface InputConfig {
  /** 正式环境（false）还是测试环境（true），默认正式环境 */
  staging: boolean

  /** 传入已有 CA 账号的 private key，或指定创建新账号所需的信息 */
  account?: string | CreateAccountConfig

  /** 预定义的证书验证配置 */
  challenges: Record<string, DNSChallengeConfig>

  /** 预定义的部署目标 */
  targets: Record<string, TargetPreset>

  /** 证书配置，包括各证书的域名列表、CSR 信息、部署位置 */
  certificates: InputCertificateConfig[]
}

/** 预定义的部署目标配置 */
export type TargetPreset =
  | SSHTargetPreset
  | TencentCloudTargetConfig
  | AliyunTargetConfig
  | QiniuTargetConfig

export type SSHTargetPreset = Pick<
  SSHTargetConfig,
  'type' | 'host' | 'port' | 'username' | 'identityFile' | 'setupCommand'
>

/** 证书配置 */
export interface InputCertificateConfig {
  /** CSR 生成配置，也可以直接传入 domainNames 数组 */
  csr: CSRConfig | string[]

  /** 证书验证配置，可传入 preset 名、完整 challenge 配置、或 preset 名搭配余下配置项 */
  challenge: DNSChallengeConfig | DNSChallengeConfigWithPreset | string

  /**
   * 部署目标
   * - ssh 之外的部署类型可直接传入 preset 名或完整部署配置
   * - ssh 部署的 preset 没法包含所有需要的信息，所以 ssh 部署必须传入一个对象，要么是完整部署配置，要么是 preset 名搭配余下的配置项（可覆盖 preset 的内容）
   */
  targets?: (
    | SSHTargetConfig
    | SSHTargetConfigWithPreset
    | TencentCloudTargetConfig
    | AliyunTargetConfig
    | QiniuTargetConfig
    | string
  )[]
}

export type DNSChallengeConfigWithPreset = { preset: string } & Pick<DNSChallengeConfig, 'ttl'>

export type SSHTargetConfigWithPreset = { preset: string } & Partial<
  Pick<SSHTargetConfig, 'host' | 'port' | 'username' | 'identityFile' | 'setupCommand'>
> &
  Pick<SSHTargetConfig, 'path' | 'keyPath'>

// -----------------------------
// 定义配置验证器
// -----------------------------

const definitions = {
  get csr() {
    return {
      type: 'struct',
      struct: {
        domainNames: { type: 'array', item: { type: 'string' }, unique: true },
        country: { type: 'string', required: false },
        province: { type: 'string', required: false },
        city: { type: 'string', required: false },
        organization: { type: 'string', required: false },
        email: { type: 'string', required: false },
        key: {
          type: 'oneOf',
          validators: [{ type: 'string' }, { type: 'number' }],
          required: false,
        },
      },
    } satisfies ValidateDefinition
  },

  get challenge() {
    return {
      type: 'struct',
      struct: {
        provider: { type: 'string', choices: ['tencent-cloud', 'aliyun'] as const },
        secretId: { type: 'string' },
        secretKey: { type: 'string' },
        ttl: { type: 'number', required: false },
      },
    } satisfies ValidateDefinition
  },
  get challengeWithPreset() {
    return {
      type: 'struct',
      struct: {
        preset: { type: 'string' },
        ..._.pick(definitions.challenge.struct, 'ttl'),
      },
    } satisfies ValidateDefinition
  },

  get sshTarget() {
    return {
      type: 'struct',
      struct: {
        type: { type: 'string', choices: ['ssh'] as const },
        host: { type: 'string' },
        port: { type: 'number', required: false },
        username: { type: 'string', required: false },
        identityFile: { type: 'string', required: false },
        path: { type: 'string' },
        keyPath: { type: 'string' },
        setupCommand: { type: 'string', required: false },
      },
    } satisfies ValidateDefinition
  },
  get sshTargetPreset() {
    return {
      type: 'struct',
      struct: _.pick(
        definitions.sshTarget.struct,
        'type',
        'host',
        'port',
        'username',
        'identityFile',
        'setupCommand',
      ),
    } satisfies ValidateDefinition
  },
  get sshTargetWithPreset() {
    return {
      type: 'struct',
      struct: {
        preset: { type: 'string' },
        host: { ...definitions.sshTarget.struct.host, required: false },
        ..._.pick(
          definitions.sshTarget.struct,
          'type',
          'port',
          'username',
          'identityFile',
          'path',
          'keyPath',
          'setupCommand',
        ),
      },
    } satisfies ValidateDefinition
  },

  get tencentCloudTarget() {
    return {
      type: 'struct',
      struct: {
        type: { type: 'string', choices: ['tencent-cloud' as const] },
        secretId: { type: 'string' },
        secretKey: { type: 'string' },
      },
    } satisfies ValidateDefinition
  },
  get aliyunTarget() {
    return {
      type: 'struct',
      struct: {
        type: { type: 'string', choices: ['aliyun' as const] },
        secretId: { type: 'string' },
        secretKey: { type: 'string' },
      },
    } satisfies ValidateDefinition
  },
  get qiniuTarget() {
    return {
      type: 'struct',
      struct: {
        type: { type: 'string', choices: ['qiniu' as const] },
        accessKey: { type: 'string' },
        secretKey: { type: 'string' },
      },
    } satisfies ValidateDefinition
  },
}

const configValidator = getValidator({
  type: 'struct',
  struct: {
    staging: { type: 'boolean', defaults: false },
    account: {
      type: 'oneOf',
      validators: [
        { type: 'string' },
        {
          type: 'struct',
          struct: {
            email: { type: 'string', required: false },
          },
        },
      ],
      required: false,
    },
    challenges: {
      type: 'record',
      record: definitions.challenge,
      defaults: {},
    },
    targets: {
      type: 'record',
      record: {
        type: 'oneOf',
        validators: [
          definitions.sshTargetPreset,
          definitions.tencentCloudTarget,
          definitions.aliyunTarget,
          definitions.qiniuTarget,
        ],
      },
      defaults: {},
    },
    certificates: {
      type: 'array',
      item: {
        type: 'struct',
        struct: {
          csr: {
            type: 'oneOf',
            validators: [definitions.csr, definitions.csr.struct.domainNames],
          },
          challenge: {
            type: 'oneOf',
            validators: [
              { type: 'string' },
              definitions.challengeWithPreset,
              definitions.challenge,
            ],
          },
          targets: {
            type: 'array',
            item: {
              type: 'oneOf',
              validators: [
                { type: 'string' },
                definitions.tencentCloudTarget,
                definitions.aliyunTarget,
                definitions.qiniuTarget,
                definitions.sshTarget,
                definitions.sshTargetWithPreset,
              ],
            },
            required: false,
          },
        },
      },
    },
  },
})

// -----------------------------
// 读取、验证配置
// -----------------------------

const logger = rootLogger.getChild('config')

function failed(...messages: unknown[]) {
  logger.error(...messages)
  return null
}

/**
 * 读取配置内容
 * - 若 formatted 为 true（默认），则返回格式化后的配置（所有 preset 内容都替换到实际配置中）
 * - 若 formatted 为 false，则原样返回从文件中读取到的 config，不做进一步格式化
 */
async function getConfig(workDirectory: string, formatted?: true): Promise<Config | null>
async function getConfig(workDirectory: string, formatted: false): Promise<InputConfig | null>
async function getConfig(
  workDirectory: string,
  formatted = true,
): Promise<Config | InputConfig | null> {
  let useJSON5 = true
  let configFile = path.join(workDirectory, 'config.json5')
  if (!(await isFileExists(configFile))) {
    useJSON5 = false
    configFile = path.join(workDirectory, 'config.json')
    if (!(await isFileExists(configFile))) {
      return failed('找不到配置文件：' + configFile)
    }
  }

  const configText = await fs.readFile(configFile, 'utf-8')
  const raw: Record<string, string> | undefined = useJSON5
    ? safeParseJSON5(configText)
    : safeParseJSON(configText)
  if (!raw) return failed('配置文件不是合法的 JSON5 或 JSON 文件')

  const result = configValidator(raw)
  if (!result.success) return failed('配置文件格式错误', result.message)

  const inputConfig = result.data
  const config = formatInputConfig(inputConfig) // 就算不需要格式化后的 config，也要格式化一下，保证 config 内容合法
  if (!config) return null
  return formatted ? config : inputConfig
}
export { getConfig }

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function safeParseJSON5<T>(json: string): T | undefined {
  try {
    return JSON5.parse(json)
  } catch (e) {
    return undefined
  }
}
function formatInputConfig(inputConfig: InputConfig): Config | null {
  const certificates: CertificateConfig[] = []
  for (const {
    csr: inputCsr,
    challenge: inputChallenge,
    targets: inputTargets,
  } of inputConfig.certificates) {
    const csr: CSRConfig = Array.isArray(inputCsr) ? { domainNames: inputCsr } : inputCsr

    let challenge: DNSChallengeConfig
    if (typeof inputChallenge === 'string') {
      if (!inputConfig.challenges[inputChallenge])
        return failed(`challenge preset '${inputChallenge}' 不存在`)
      challenge = inputConfig.challenges[inputChallenge]
    } else if ('preset' in inputChallenge) {
      const { preset, ...rest } = inputChallenge
      if (!inputConfig.challenges[preset]) return failed(`challenge preset '${preset}' 不存在`)
      challenge = { ...inputConfig.challenges[preset], ...rest }
    } else {
      challenge = inputChallenge
    }

    const targets: TargetConfig[] = []
    for (const inputTarget of inputTargets ?? []) {
      if (typeof inputTarget === 'string') {
        if (!inputConfig.targets[inputTarget])
          return failed(`target preset '${inputTarget}' 不存在`)
        const preset = inputConfig.targets[inputTarget]
        if (preset.type === 'ssh')
          return failed(`ssh 类型的 target preset 在证书配置里不能只传名字（${inputTarget}）`)
        targets.push(preset)
      } else if ('preset' in inputTarget) {
        const { preset: presetName, ...rest } = inputTarget
        if (!inputConfig.targets[presetName]) return failed(`target preset '${presetName}' 不存在`)
        const preset = inputConfig.targets[presetName]
        if (preset.type !== 'ssh')
          return failed(
            `target preset '${presetName}' 不是 ssh 类型，但在证书配置里作为 ssh 类型被引用`,
          )
        const target: SSHTargetConfig = { ...preset, ...rest }
        targets.push(target)
      } else {
        targets.push(inputTarget)
      }
    }

    certificates.push({ csr, challenge, targets })
  }
  const config = { ..._.pick(inputConfig, 'staging', 'account'), certificates }
  return config
}

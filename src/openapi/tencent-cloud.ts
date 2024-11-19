import { stringifyQuery, success, failed } from '@anjianshi/utils'
import { rootLogger, sha256, hmac } from '../common.js'

const logger = rootLogger.getChild('tencent-cloud')

export interface APIOptions {
  service: string // 腾讯云产品名
  version: string // 腾讯云开放接口版本号
  action: string
  method?: 'POST' | 'GET'
  data?: Record<string, unknown>
  secretId: string
  secretKey: string
  ignoreCodes?: string[] // 出现这些错误码时只返回错误信息，不记录错误日志
}

export interface APIResponse<T> {
  Response: {
    RequestId: string
    Error?: {
      Code: string
      Message: string
    }
  } & T
}

/**
 * 调用腾讯云开放接口
 * https://cloud.tencent.com/document/api
 */
export async function API<T>(options: APIOptions) {
  logger.debug('调用开放接口', JSON.stringify(options))

  const { service, version } = options
  const domain = `${service}.tencentcloudapi.com`
  const method = options.method ?? 'POST'
  const headers: Record<string, string> = {
    Host: domain,
    'X-TC-Action': options.action,
    'X-TC-Timestamp': Math.floor(Date.now() / 1000).toString(),
    'X-TC-Version': version,
    'Content-Type': method === 'GET' ? 'application/x-www-form-urlencoded' : 'application/json',
  }
  const query =
    method === 'GET' ? stringifyQuery((options.data ?? {}) as Record<string, string>) : ''
  const body = method === 'POST' ? JSON.stringify(options.data ?? {}) : ''
  const url = 'https://' + domain + (query ? '?' + query : '')

  const authorization = getAPIAuthorization({
    secretId: options.secretId,
    secretKey: options.secretKey,
    service,
    method,
    headers,
    query,
    body,
  })
  headers.Authorization = authorization

  try {
    const request = await fetch(url, {
      method,
      headers,
      body,
    })
    if (request.status !== 200) {
      logger.error(`请求失败`, {
        options,
        status: request.status,
        content: await request.text(),
      })
      return failed('腾讯云 API 请求失败')
    }
    const response = (await request.json()) as APIResponse<T>
    if (response.Response.Error) {
      if (!options.ignoreCodes?.includes(response.Response.Error.Code)) {
        logger.error({ options, error: response.Response.Error })
      }
      return failed('腾讯云 API 请求失败', response.Response.Error.Code)
    }

    logger.debug(`${options.action} 请求成功`, JSON.stringify(response.Response))
    return success(response.Response)
  } catch (error) {
    logger.error('请求失败', { options, error })
    return failed('腾讯云 API 请求失败')
  }
}

/**
 * 生成 API 认证信息
 * https://cloud.tencent.com/document/product/1427/56189
 */
export function getAPIAuthorization(options: {
  secretId: string
  secretKey: string
  service: string
  method: 'GET' | 'POST'
  headers: Record<string, string>
  query: string
  body: string
}) {
  const choosedHeaders = ['Content-Type', 'Host', 'X-TC-Action']

  const canonicalHeaders = choosedHeaders
    .map(header => `${header}:${options.headers[header]!}\n`)
    .join('')
    .toLowerCase()
  const signedHeaders = choosedHeaders.join(';').toLowerCase()
  const hashedRequestPayload = options.body ? sha256(options.body) : ''
  const canonicalRequest = `${options.method}\n/\n${options.query}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`

  const date = new Date(parseInt(options.headers['X-TC-Timestamp']!, 10) * 1000)
    .toISOString()
    .slice(0, 10)
  const credentialScope = `${date}/${options.service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${options.headers['X-TC-Timestamp']}\n${credentialScope}\n${sha256(canonicalRequest)}`

  const { secretKey } = options
  const secretDate = hmac('sha256', `TC3${secretKey}`, date)
  const secretService = hmac('sha256', secretDate, options.service)
  const secretSigning = hmac('sha256', secretService, 'tc3_request')

  const signature = hmac('sha256', secretSigning, stringToSign, 'hex')

  const authorization = `TC3-HMAC-SHA256 Credential=${options.secretId}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`
  return authorization
}

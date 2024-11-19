import { success, failed, stringifyQuery } from '@anjianshi/utils'
import { rootLogger, sha256, hmac } from '../common.js'

const logger = rootLogger.getChild('aliyun')

export interface APIOptions {
  secretId: string
  secretKey: string
  endpoint: string
  apiVersion: string
  action: string
  params?: Record<string, unknown>
}

export async function API<T>(options: APIOptions) {
  logger.debug('调用开放接口', JSON.stringify(options))

  const time = new Date().toISOString().replace(/\.\d+/, '')
  const method = 'GET'
  const headers = getHeadersWithAuthorization({
    secretId: options.secretId,
    secretKey: options.secretKey,
    method,
    endpoint: options.endpoint,
    params: options.params,
    headers: {
      'x-acs-action': options.action,
      'x-acs-version': options.apiVersion,
      'x-acs-date': time,
      'x-acs-content-sha256': '',
    },
  })
  const queryString = stringifyQuery((options.params ?? {}) as Record<string, string>)
  const url = `https://${options.endpoint}?${queryString}`

  try {
    const request = await fetch(url, { method, headers })
    if (request.status === 200) {
      const data = (await request.json()) as T
      logger.debug(`${options.action} 请求成功`, JSON.stringify(data))
      return success(data)
    } else {
      logger.error({ options, response: (await request.json()) as unknown })
      return failed('阿里云 API 请求失败')
    }
  } catch (error) {
    logger.error('请求失败', { options, error })
    return failed('阿里云 API 请求失败')
  }
}

export function getHeadersWithAuthorization(options: {
  secretId: string
  secretKey: string
  method: string
  endpoint: string
  headers: Record<string, string>
  params?: Record<string, unknown>
}) {
  // ----- 常量定义 ------
  const signatureAlgorithm = 'ACS3-HMAC-SHA256'
  const hashedRequestPayload = sha256('')

  // ----- 整理 headers -----
  let headers: Record<string, string> = {
    ...options.headers,
    host: options.endpoint,
    'x-acs-content-sha256': hashedRequestPayload,
  }

  headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const sortedHeaderKeys = Object.keys(headers)
    .filter(key => key.startsWith('x-acs-') || key === 'host' || key === 'content-type')
    .sort()
  const canonicalHeaders = sortedHeaderKeys.reduce(
    (result, key) => `${result}${key}:${headers[key]!}\n`,
    '',
  )
  const signedHeaders = sortedHeaderKeys.join(';')

  // ----- 生成 canonicalRequest -----
  const canonicalUri = '/'
  const canonicalQueryString = getAliyunStyleCanonicalQueryString(options.params)
  const canonicalRequest = [
    options.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n')

  // ----- 生成 signature -----
  const stringToSign = signatureAlgorithm + '\n' + sha256(canonicalRequest)
  const signature = hmac('sha256', options.secretKey, stringToSign, 'hex')

  // ----- 生成 Authorization Header -----
  headers.Authorization = `${signatureAlgorithm} Credential=${options.secretId},SignedHeaders=${signedHeaders},Signature=${signature}`
  return headers
}
function getAliyunStyleCanonicalQueryString(params?: Record<string, unknown>) {
  if (!params) return ''
  return Object.entries(params)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([key, value]) =>
        `${aliyunStyleEncodeCanonicalString(key)}=${aliyunStyleEncodeCanonicalString(String(value))}`,
    )
    .join('&')
}
function aliyunStyleEncodeCanonicalString(content: string) {
  return encodeURIComponent(content).replace(/\*/g, '%2A').replace(/~/g, '%7E')
}

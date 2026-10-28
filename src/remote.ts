#!/usr/bin/env node
/**
 * Optional remote Streamable HTTP MCP transport.
 * Set WEBEAR_MCP_TOKEN to a strong secret and deploy behind HTTPS.
 * Existing local stdio entry point (src/index.ts) remains unchanged.
 */
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { analyzeRecordingSchema, analyzeRecordingHandler } from './tools/analyzeRecording.js'

const token = process.env.WEBEAR_MCP_TOKEN
if (!token || Buffer.byteLength(token) < 32) {
  throw new Error('Set WEBEAR_MCP_TOKEN to a random secret of at least 32 bytes')
}
const port = Number(process.env.PORT ?? 4100)
const host = process.env.HOST ?? '127.0.0.1'

function authorized(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const provided = Buffer.from(header.slice(7))
  const expected = Buffer.from(token!)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

const httpServer = createServer(async (req, res) => {
  if (req.url?.split('?')[0] !== '/mcp') {
    res.writeHead(404).end('Not found')
    return
  }
  if (!authorized(req.headers.authorization)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('Unauthorized')
    return
  }
  // Stateless sessions: each POST has an independent MCP server instance.
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end('Method not allowed')
    return
  }
  const server = new McpServer({ name: 'webear-remote', version: '2.1.0' })
  server.tool('analyze_recording',
    'Analyze a base64-encoded audio file with ffmpeg and return structured signal features. These measurements describe the combined recording, not isolated vocal flow.',
    analyzeRecordingSchema, analyzeRecordingHandler)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  res.once('close', () => { void server.close() })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res)
  } catch (error) {
    console.error('[webear-remote] Request failed', error)
    if (!res.headersSent) res.writeHead(500).end('Internal error')
  }
})
httpServer.listen(port, host, () => {
  console.error('[webear-remote] Listening on ' + host + ':' + port + '/mcp')
})

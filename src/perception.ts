export type WebPerceptionSensor = 'ear' | 'eye' | 'sense' | 'nerve' | 'shield' | 'log';

export type SensorConnectionState =
  | 'idle'
  | 'initializing'
  | 'connected'
  | 'disconnected'
  | 'capturing'
  | 'error';

export interface SensorStatus {
  state: SensorConnectionState;
  message: string;
  updatedAt: number;
}

export interface SensorHandle {
  startCapture: (durationMs?: number, selector?: string) => Promise<string>;
  getLastCaptureId: () => string | null;
  status: () => SensorConnectionState;
  connect: () => Promise<void>;
  disconnect: () => void;
  getStatus: () => SensorStatus;
}

export interface WebPerceptionOptions {
  apiKey: string | (() => string | Promise<string>);
  relayUrl?: string;
  apiBasePath?: string;
  sensors?: WebPerceptionSensor[];
  autoConnect?: boolean;
  debug?: boolean;
  exposeGlobals?: boolean;
  reconnect?: boolean;
  reconnectInitialDelayMs?: number;
  reconnectMaxDelayMs?: number;
  ear?: WebEarOptions;
  eye?: WebEyeOptions;
  sense?: WebSenseOptions;
  nerve?: WebNerveOptions;
  shield?: WebShieldOptions;
  log?: WebLogOptions;
}

export interface WebEarOptions {
  audioStream?: MediaStream | (() => MediaStream | Promise<MediaStream | null> | null);
  audioNode?: AudioNode;
  audioContext?: BaseAudioContext | (() => BaseAudioContext | null);
  connectAudioSource?: (destination: MediaStreamAudioDestinationNode) => void | Promise<void>;
  disconnectAudioSource?: (destination: MediaStreamAudioDestinationNode) => void | Promise<void>;
  captureDisplayAudio?: boolean;
  mimeType?: string;
}

export interface WebEyeOptions {
  selector?: string;
  preferDisplayMedia?: boolean;
  displayMediaOptions?: DisplayMediaStreamOptions;
  mimeType?: string;
}

export interface WebSenseOptions {
  audioContext?: BaseAudioContext | (() => BaseAudioContext | null);
}

export interface WebNerveOptions {
  includeResourcePattern?: RegExp;
}

export interface WebShieldOptions {
  sensitiveStoragePattern?: RegExp;
}

export interface WebLogOptions {
  maxLogs?: number;
  patchConsole?: boolean;
  getStateSnapshot?: () => unknown;
}

export interface WebPerceptionController {
  sensors: Partial<Record<WebPerceptionSensor, SensorHandle>>;
  connect: () => Promise<void>;
  disconnect: () => void;
  getStatus: () => Partial<Record<WebPerceptionSensor, SensorStatus>>;
}

declare global {
  interface Window {
    __webPerception?: WebPerceptionController;
    __webEar?: SensorHandle;
    __webEye?: SensorHandle;
    __webSense?: SensorHandle;
    __webNerve?: SensorHandle;
    __webShield?: SensorHandle;
    __webLog?: SensorHandle & { getLogs?: () => ConsoleLogEntry[] };
    __webearStatus?: SensorStatus;
    __webeyeStatus?: SensorStatus;
    __websenseStatus?: SensorStatus;
    __webnerveStatus?: SensorStatus;
    __webshieldStatus?: SensorStatus;
    __weblogStatus?: SensorStatus;
    __audioDebug?: unknown;
    Tone?: {
      Transport?: {
        state?: string;
        bpm?: { value?: number };
      };
      getContext?: () => { rawContext?: BaseAudioContext; context?: BaseAudioContext };
    };
  }

  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }

  interface Navigator {
    connection?: {
      effectiveType?: string;
      rtt?: number;
      downlink?: number;
      saveData?: boolean;
    };
  }
}

interface RuntimeOptions {
  apiKey: () => Promise<string>;
  relayUrl: string;
  apiBasePath: string;
  debug: boolean;
  exposeGlobals: boolean;
  reconnect: boolean;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
}

interface CaptureCommand {
  captureId: string;
  durationMs?: number;
  selector?: string;
}

interface ConsoleLogEntry {
  type: 'log' | 'warn' | 'error' | 'exception';
  message: string;
  timestamp: number;
}

const SENSOR_ENDPOINTS: Record<WebPerceptionSensor, string> = {
  ear: 'webear',
  eye: 'webeye',
  sense: 'websense',
  nerve: 'webnerve',
  shield: 'webshield',
  log: 'weblog',
};

const SENSOR_GLOBALS: Record<WebPerceptionSensor, keyof Window> = {
  ear: '__webEar',
  eye: '__webEye',
  sense: '__webSense',
  nerve: '__webNerve',
  shield: '__webShield',
  log: '__webLog',
};

const STATUS_GLOBALS: Record<WebPerceptionSensor, keyof Window> = {
  ear: '__webearStatus',
  eye: '__webeyeStatus',
  sense: '__websenseStatus',
  nerve: '__webnerveStatus',
  shield: '__webshieldStatus',
  log: '__weblogStatus',
};

function normalizeRelayUrl(relayUrl?: string): string {
  const fallback = typeof window !== 'undefined' ? window.location.origin : '';
  return (relayUrl ?? fallback).replace(/\/+$/, '');
}

function normalizeBasePath(path?: string): string {
  const raw = path ?? '/api';
  if (!raw) return '';
  return raw.startsWith('/') ? raw.replace(/\/+$/, '') : `/${raw.replace(/\/+$/, '')}`;
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 12);
}

function chooseMime(candidates: string[], fallback: string): string {
  if (typeof MediaRecorder === 'undefined') return fallback;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? fallback;
}

function isAudioContext(context: BaseAudioContext | null): context is AudioContext {
  return Boolean(context && 'createMediaStreamDestination' in context);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toMessage(args: unknown[]): string {
  return args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

async function resolveMaybe<T>(value: T | (() => T | Promise<T>)): Promise<T> {
  return typeof value === 'function' ? await (value as () => T | Promise<T>)() : value;
}

async function recordStream(stream: MediaStream, durationMs: number, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType });
    const stopTimer = window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, durationMs);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      window.clearTimeout(stopTimer);
      reject(event instanceof ErrorEvent ? event.error : new Error('MediaRecorder failed'));
    };
    recorder.onstop = () => {
      window.clearTimeout(stopTimer);
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.start();
  });
}

abstract class BaseSensorBridge implements SensorHandle {
  protected sseSource: EventSource | null = null;
  protected isCapturing = false;
  protected isConnected = false;
  protected lastCaptureId: string | null = null;
  protected reconnectTimer: number | null = null;
  protected reconnectDelayMs: number;
  protected statusValue: SensorStatus;

  constructor(
    protected readonly sensor: WebPerceptionSensor,
    protected readonly runtime: RuntimeOptions,
  ) {
    this.reconnectDelayMs = runtime.reconnectInitialDelayMs;
    this.statusValue = {
      state: 'idle',
      message: `${this.label} bridge idle`,
      updatedAt: Date.now(),
    };
  }

  protected get endpoint(): string {
    return SENSOR_ENDPOINTS[this.sensor];
  }

  protected get label(): string {
    return `Web${this.sensor[0].toUpperCase()}${this.sensor.slice(1)}`;
  }

  status(): SensorConnectionState {
    if (this.isCapturing) return 'capturing';
    return this.statusValue.state;
  }

  getStatus(): SensorStatus {
    return this.statusValue;
  }

  getLastCaptureId(): string | null {
    return this.lastCaptureId;
  }

  async startCapture(durationMs = 3000, selector?: string): Promise<string> {
    const captureId = createId();
    await this.capture({ captureId, durationMs, selector });
    return captureId;
  }

  async connect(): Promise<void> {
    if (this.sseSource || this.isCapturing) return;
    const apiKey = await this.runtime.apiKey();
    if (!apiKey) {
      this.setStatus('error', `${this.label} API key is required`);
      this.scheduleReconnect();
      return;
    }

    this.setStatus('initializing', `Connecting ${this.label} relay`);
    this.sseSource = new EventSource(this.url(`/${this.endpoint}/connect?key=${encodeURIComponent(apiKey)}`));

    this.sseSource.addEventListener('connected', () => {
      this.isConnected = true;
      this.reconnectDelayMs = this.runtime.reconnectInitialDelayMs;
      this.setStatus('connected', `${this.label} is connected`);
      this.debug('connected');
    });

    this.sseSource.addEventListener('capture', (event: MessageEvent) => {
      const command = JSON.parse(event.data) as CaptureCommand;
      void this.capture(command).catch((error) => {
        this.setStatus('error', error instanceof Error ? error.message : String(error));
      });
    });

    this.sseSource.onerror = () => {
      this.isConnected = false;
      this.setStatus('disconnected', `${this.label} relay disconnected`);
      this.sseSource?.close();
      this.sseSource = null;
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sseSource?.close();
    this.sseSource = null;
    this.isConnected = false;
    this.setStatus('disconnected', `${this.label} disconnected`);
  }

  protected abstract capture(command: CaptureCommand): Promise<void>;

  protected async upload(captureId: string, body: BodyInit, contentType: string): Promise<void> {
    const apiKey = await this.runtime.apiKey();
    const response = await fetch(this.url(`/${this.endpoint}/blob/${captureId}`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': contentType,
      },
      body,
    });
    if (!response.ok) throw new Error(`${this.label} upload failed with ${response.status}`);
  }

  protected url(path: string): string {
    return `${this.runtime.relayUrl}${this.runtime.apiBasePath}${path}`;
  }

  protected setStatus(state: SensorConnectionState, message: string): void {
    this.statusValue = { state, message, updatedAt: Date.now() };
    if (typeof window !== 'undefined' && this.runtime.exposeGlobals) {
      (window as unknown as Record<string, unknown>)[STATUS_GLOBALS[this.sensor] as string] = this.statusValue;
      window.dispatchEvent(new CustomEvent(`${this.endpoint}:status`, { detail: this.statusValue }));
    }
  }

  protected debug(message: string): void {
    if (this.runtime.debug) console.debug(`[${this.endpoint}-bridge] ${message}`);
  }

  protected scheduleReconnect(): void {
    if (!this.runtime.reconnect || this.reconnectTimer !== null || typeof window === 'undefined') return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelayMs);
    this.reconnectDelayMs = Math.min(
      this.runtime.reconnectMaxDelayMs,
      Math.round(this.reconnectDelayMs * 1.5),
    );
  }
}

class WebEarBridge extends BaseSensorBridge {
  constructor(runtime: RuntimeOptions, private readonly options: WebEarOptions = {}) {
    super('ear', runtime);
  }

  protected override get label(): string {
    return 'WebEar';
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', `WebEar capturing ${command.durationMs ?? 3000}ms`);

    let stream: MediaStream | null = null;
    let destination: MediaStreamAudioDestinationNode | null = null;
    let disconnect: (() => Promise<void>) | null = null;

    try {
      const durationMs = Math.min(30000, Math.max(500, command.durationMs ?? 3000));
      const sourceStream = this.options.audioStream
        ? await resolveMaybe(this.options.audioStream)
        : null;

      if (sourceStream) {
        stream = sourceStream;
      } else if (this.options.connectAudioSource) {
        const context = this.resolveAudioContext();
        if (!isAudioContext(context)) {
          throw new Error('WebEar requires an AudioContext when using connectAudioSource');
        }
        const tapDestination = context.createMediaStreamDestination();
        destination = tapDestination;
        await this.options.connectAudioSource(tapDestination);
        disconnect = async () => {
          await this.options.disconnectAudioSource?.(tapDestination);
        };
        stream = tapDestination.stream;
      } else if (this.options.audioNode) {
        const context = this.resolveAudioContext() ?? this.options.audioNode.context;
        if (!isAudioContext(context)) {
          throw new Error('WebEar requires an AudioContext for audioNode capture');
        }
        const tapDestination = context.createMediaStreamDestination();
        destination = tapDestination;
        this.options.audioNode.connect(tapDestination);
        disconnect = async () => {
          this.options.audioNode?.disconnect(tapDestination);
        };
        stream = tapDestination.stream;
      } else if (this.options.captureDisplayAudio) {
        stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      } else {
        throw new Error('WebEar needs audioStream, audioNode, connectAudioSource, or captureDisplayAudio');
      }

      const mimeType = this.options.mimeType ?? chooseMime(
        ['audio/webm;codecs=opus', 'audio/webm', 'video/webm;codecs=opus', 'video/webm'],
        'audio/webm',
      );
      const blob = await recordStream(stream, durationMs, mimeType);
      await this.upload(command.captureId, blob, blob.type || mimeType);
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebEar capture uploaded');
    } finally {
      await disconnect?.();
      if (this.options.captureDisplayAudio && stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      this.isCapturing = false;
    }
  }

  private resolveAudioContext(): BaseAudioContext | null {
    if (typeof this.options.audioContext === 'function') return this.options.audioContext();
    if (this.options.audioContext) return this.options.audioContext;
    return window.Tone?.getContext?.().rawContext ?? window.Tone?.getContext?.().context ?? null;
  }
}

class WebEyeBridge extends BaseSensorBridge {
  constructor(runtime: RuntimeOptions, private readonly options: WebEyeOptions = {}) {
    super('eye', runtime);
  }

  protected override get label(): string {
    return 'WebEye';
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', `WebEye capturing ${command.durationMs ?? 3000}ms`);

    let stream: MediaStream | null = null;
    let shouldStopTracks = false;
    try {
      const durationMs = Math.min(30000, Math.max(500, command.durationMs ?? 3000));
      const selector = command.selector ?? this.options.selector;
      const element = selector ? document.querySelector(selector) : null;
      const captureStream = (element as unknown as { captureStream?: () => MediaStream } | null)?.captureStream;

      if (captureStream && !this.options.preferDisplayMedia) {
        stream = captureStream.call(element);
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia(
          this.options.displayMediaOptions ?? { video: true, audio: false },
        );
        shouldStopTracks = true;
      }

      const mimeType = this.options.mimeType ?? chooseMime(
        ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'],
        'video/webm',
      );
      const blob = await recordStream(stream, durationMs, mimeType);
      await this.upload(command.captureId, blob, blob.type || mimeType);
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebEye capture uploaded');
    } finally {
      if (shouldStopTracks && stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      this.isCapturing = false;
    }
  }
}

class WebSenseBridge extends BaseSensorBridge {
  constructor(runtime: RuntimeOptions, private readonly options: WebSenseOptions = {}) {
    super('sense', runtime);
  }

  protected override get label(): string {
    return 'WebSense';
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', `WebSense sampling ${command.durationMs ?? 3000}ms`);
    try {
      const durationMs = Math.min(30000, Math.max(500, command.durationMs ?? 3000));
      const report = await this.collectTelemetry(durationMs);
      await this.upload(command.captureId, JSON.stringify(report), 'application/json');
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebSense telemetry uploaded');
    } finally {
      this.isCapturing = false;
    }
  }

  private async collectTelemetry(durationMs: number): Promise<object> {
    const startTime = performance.now();
    const frameTimes: number[] = [];
    let lastFrameTime = performance.now();
    let frameId = 0;
    let clicks = 0;
    let keypresses = 0;
    let scrolls = 0;
    let cumulativeLayoutShift = 0;
    let firstInputDelayMs: number | null = null;

    const trackFrame = () => {
      const now = performance.now();
      frameTimes.push(now - lastFrameTime);
      lastFrameTime = now;
      frameId = requestAnimationFrame(trackFrame);
    };
    const clickHandler = () => { clicks += 1; };
    const keyHandler = () => { keypresses += 1; };
    const scrollHandler = () => { scrolls += 1; };

    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if (entry.entryType === 'layout-shift' && !(entry as unknown as { hadRecentInput?: boolean }).hadRecentInput) {
            cumulativeLayoutShift += (entry as unknown as { value?: number }).value ?? 0;
          }
          if (entry.entryType === 'first-input') firstInputDelayMs = entry.duration;
        }
      });
      observer.observe({ entryTypes: ['layout-shift', 'first-input'] });
    } catch {
      observer = null;
    }

    frameId = requestAnimationFrame(trackFrame);
    window.addEventListener('click', clickHandler);
    window.addEventListener('keydown', keyHandler);
    window.addEventListener('scroll', scrollHandler);
    await sleep(durationMs);
    cancelAnimationFrame(frameId);
    window.removeEventListener('click', clickHandler);
    window.removeEventListener('keydown', keyHandler);
    window.removeEventListener('scroll', scrollHandler);
    observer?.disconnect();

    const deltas = frameTimes.slice(1);
    const avgDelta = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 16.67;
    const fpsValues = deltas.length ? deltas.map((delta) => 1000 / delta) : [60];
    const jitterMs = deltas.length
      ? Math.sqrt(deltas.reduce((sum, value) => sum + (value - avgDelta) ** 2, 0) / deltas.length)
      : 0;

    const memory = performance.memory;
    const audioContext = this.resolveAudioContext();

    return {
      timestamp: Date.now(),
      windowMs: durationMs,
      actualWindowMs: performance.now() - startTime,
      fps: {
        average: 1000 / avgDelta,
        min: Math.min(...fpsValues),
        max: Math.max(...fpsValues),
        jitterMs,
      },
      memory: {
        supported: Boolean(memory),
        usedHeapMb: memory ? memory.usedJSHeapSize / 1048576 : 0,
        totalHeapMb: memory ? memory.totalJSHeapSize / 1048576 : 0,
        limitMb: memory ? memory.jsHeapSizeLimit / 1048576 : 0,
        heapUsagePercent: memory ? (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100 : 0,
      },
      vitals: {
        cumulativeLayoutShift,
        firstInputDelayMs,
      },
      interaction: {
        clicks,
        keypresses,
        scrolls,
      },
      audioState: {
        state: audioContext?.state ?? 'no-context',
        sampleRate: audioContext?.sampleRate ?? 0,
        latencySeconds: 'baseLatency' in (audioContext ?? {}) ? (audioContext as AudioContext).baseLatency : 0,
      },
    };
  }

  private resolveAudioContext(): BaseAudioContext | null {
    if (typeof this.options.audioContext === 'function') return this.options.audioContext();
    if (this.options.audioContext) return this.options.audioContext;
    return window.Tone?.getContext?.().rawContext ?? window.Tone?.getContext?.().context ?? null;
  }
}

class WebNerveBridge extends BaseSensorBridge {
  constructor(runtime: RuntimeOptions, private readonly options: WebNerveOptions = {}) {
    super('nerve', runtime);
  }

  protected override get label(): string {
    return 'WebNerve';
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', `WebNerve sampling ${command.durationMs ?? 3000}ms`);
    const startTime = Date.now();
    try {
      const durationMs = Math.min(30000, Math.max(500, command.durationMs ?? 3000));
      performance.clearResourceTimings?.();
      await sleep(durationMs);

      const includePattern = this.options.includeResourcePattern ?? /\/api\//;
      const resourceTimings = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      const apiRequests = resourceTimings
        .filter((entry) => includePattern.test(entry.name))
        .map((entry) => ({
          name: entry.name,
          durationMs: entry.duration,
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
          initiatorType: entry.initiatorType,
        }));

      const report = {
        captureId: command.captureId,
        timestamp: Date.now(),
        windowMs: durationMs,
        actualWindowMs: Date.now() - startTime,
        metrics: {
          totalResources: resourceTimings.length,
          apiRequestsCount: apiRequests.length,
          apiRequests,
          storage: {
            localStorageBytes: this.storageBytes(localStorage),
            sessionStorageBytes: this.storageBytes(sessionStorage),
          },
          connection: navigator.connection
            ? {
                effectiveType: navigator.connection.effectiveType ?? 'unknown',
                rttMs: navigator.connection.rtt ?? 0,
                downlinkMb: navigator.connection.downlink ?? 0,
                saveData: navigator.connection.saveData ?? false,
              }
            : null,
        },
      };

      await this.upload(command.captureId, JSON.stringify(report), 'application/json');
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebNerve report uploaded');
    } finally {
      this.isCapturing = false;
    }
  }

  private storageBytes(storage: Storage): number {
    let bytes = 0;
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) bytes += key.length + (storage.getItem(key)?.length ?? 0);
    }
    return bytes;
  }
}

class WebShieldBridge extends BaseSensorBridge {
  constructor(runtime: RuntimeOptions, private readonly options: WebShieldOptions = {}) {
    super('shield', runtime);
  }

  protected override get label(): string {
    return 'WebShield';
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', 'WebShield scanning browser exposure');
    try {
      const sensitivePattern = this.options.sensitiveStoragePattern ?? /token|jwt|auth|key|secret|password|private|credential/i;
      const storageRisks: string[] = [];
      this.collectStorageRisks(localStorage, 'localStorage', sensitivePattern, storageRisks);
      this.collectStorageRisks(sessionStorage, 'sessionStorage', sensitivePattern, storageRisks);

      const report = {
        captureId: command.captureId,
        timestamp: Date.now(),
        protocol: window.location.protocol,
        origin: window.location.origin,
        isHttps: window.location.protocol === 'https:',
        security: {
          isFramed: window.self !== window.top,
          metaCsps: Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'))
            .map((element) => element.getAttribute('content') ?? ''),
          readableCookies: document.cookie
            ? document.cookie.split(';').map((cookie) => cookie.split('=')[0]?.trim()).filter(Boolean)
            : [],
          storageRisks,
        },
      };

      await this.upload(command.captureId, JSON.stringify(report), 'application/json');
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebShield report uploaded');
    } finally {
      this.isCapturing = false;
    }
  }

  private collectStorageRisks(storage: Storage, label: string, pattern: RegExp, out: string[]): void {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && pattern.test(key)) out.push(`${label}: ${key}`);
    }
  }
}

class WebLogBridge extends BaseSensorBridge {
  private readonly logBuffer: ConsoleLogEntry[] = [];
  private readonly maxLogs: number;

  constructor(runtime: RuntimeOptions, private readonly options: WebLogOptions = {}) {
    super('log', runtime);
    this.maxLogs = options.maxLogs ?? 100;
    if (options.patchConsole !== false) this.patchConsole();
  }

  protected override get label(): string {
    return 'WebLog';
  }

  getLogs(): ConsoleLogEntry[] {
    return [...this.logBuffer];
  }

  protected async capture(command: CaptureCommand): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.lastCaptureId = command.captureId;
    this.setStatus('capturing', `WebLog sampling ${command.durationMs ?? 3000}ms`);
    const captureStartTime = Date.now();
    try {
      const durationMs = Math.min(30000, Math.max(500, command.durationMs ?? 3000));
      await sleep(durationMs);
      const recentLogs = this.logBuffer.filter((entry) => entry.timestamp >= captureStartTime - 30000);
      const report = {
        captureId: command.captureId,
        timestamp: Date.now(),
        durationMs,
        logs: recentLogs,
        stateSnapshot: this.options.getStateSnapshot?.() ?? {
          audioState: (window.__audioDebug as { status?: () => string } | undefined)?.status?.() ?? 'unknown',
          isPlaying: window.Tone?.Transport?.state === 'started',
          activeBpm: window.Tone?.Transport?.bpm?.value ?? 120,
        },
      };

      await this.upload(command.captureId, JSON.stringify(report), 'application/json');
      this.setStatus(this.isConnected ? 'connected' : 'idle', 'WebLog report uploaded');
    } finally {
      this.isCapturing = false;
    }
  }

  private patchConsole(): void {
    const marker = '__webPerceptionConsolePatched';
    const consoleRecord = console as Console & Record<string, unknown>;
    if (consoleRecord[marker]) return;
    consoleRecord[marker] = true;

    const originalLog = console.log.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      this.pushLog('log', args);
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      this.pushLog('warn', args);
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      this.pushLog('error', args);
    };

    window.addEventListener('error', (event) => {
      this.pushLog('exception', [`Uncaught Exception: ${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.pushLog('exception', [`Unhandled Rejection: ${String(event.reason)}`]);
    });
  }

  private pushLog(type: ConsoleLogEntry['type'], args: unknown[]): void {
    this.logBuffer.push({ type, message: toMessage(args), timestamp: Date.now() });
    while (this.logBuffer.length > this.maxLogs) this.logBuffer.shift();
  }
}

export function initWebPerception(options: WebPerceptionOptions): WebPerceptionController {
  if (typeof window === 'undefined') {
    throw new Error('Web Perception browser SDK must run in a browser');
  }

  const runtime: RuntimeOptions = {
    apiKey: async () => String(await resolveMaybe(options.apiKey)),
    relayUrl: normalizeRelayUrl(options.relayUrl),
    apiBasePath: normalizeBasePath(options.apiBasePath),
    debug: options.debug ?? false,
    exposeGlobals: options.exposeGlobals ?? true,
    reconnect: options.reconnect ?? true,
    reconnectInitialDelayMs: options.reconnectInitialDelayMs ?? 3000,
    reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 30000,
  };

  const selectedSensors = options.sensors ?? ['ear', 'eye', 'sense', 'nerve', 'shield', 'log'];
  const sensors: Partial<Record<WebPerceptionSensor, SensorHandle>> = {};

  for (const sensor of selectedSensors) {
    if (sensor === 'ear') sensors.ear = new WebEarBridge(runtime, options.ear);
    if (sensor === 'eye') sensors.eye = new WebEyeBridge(runtime, options.eye);
    if (sensor === 'sense') sensors.sense = new WebSenseBridge(runtime, options.sense);
    if (sensor === 'nerve') sensors.nerve = new WebNerveBridge(runtime, options.nerve);
    if (sensor === 'shield') sensors.shield = new WebShieldBridge(runtime, options.shield);
    if (sensor === 'log') sensors.log = new WebLogBridge(runtime, options.log);
  }

  const controller: WebPerceptionController = {
    sensors,
    connect: async () => {
      await Promise.all(Object.values(sensors).map((sensor) => sensor?.connect()));
    },
    disconnect: () => {
      for (const sensor of Object.values(sensors)) sensor?.disconnect();
    },
    getStatus: () => {
      const result: Partial<Record<WebPerceptionSensor, SensorStatus>> = {};
      for (const [sensor, handle] of Object.entries(sensors) as Array<[WebPerceptionSensor, SensorHandle]>) {
        result[sensor] = handle.getStatus();
      }
      return result;
    },
  };

  if (runtime.exposeGlobals) {
    window.__webPerception = controller;
    for (const [sensor, handle] of Object.entries(sensors) as Array<[WebPerceptionSensor, SensorHandle]>) {
      (window as unknown as Record<string, unknown>)[SENSOR_GLOBALS[sensor] as string] = handle;
    }
  }

  if (options.autoConnect !== false) {
    const connect = () => { void controller.connect(); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', connect, { once: true });
    } else {
      connect();
    }
  }

  return controller;
}

export const WebPerception = {
  init: initWebPerception,
};

export const WebEar = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['ear'] }).sensors.ear,
};

export const WebEye = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['eye'] }).sensors.eye,
};

export const WebSense = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['sense'] }).sensors.sense,
};

export const WebNerve = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['nerve'] }).sensors.nerve,
};

export const WebShield = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['shield'] }).sensors.shield,
};

export const WebLog = {
  init: (options: Omit<WebPerceptionOptions, 'sensors'>) => initWebPerception({ ...options, sensors: ['log'] }).sensors.log,
};

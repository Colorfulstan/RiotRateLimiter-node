import {RateLimiter, STRATEGY} from '../RateLimiter/index';

export interface RateLimitOptions {
  requests: number,
  seconds: number,
  type?: RATELIMIT_TYPE
  count?: number,
  debug?: boolean,
}

export interface RateLimitUpdateOptions {
  requests?: number,
  seconds?: number,
  type?: RATELIMIT_TYPE
  count?: number,
  debug?: boolean
}

export enum RATELIMIT_TYPE {
  APP,
  METHOD,
  SYNC,
  BACKOFF
}

export const RATELIMIT_TYPE_STRINGS         = {
  [RATELIMIT_TYPE.METHOD] : 'method',
  [RATELIMIT_TYPE.APP]    : 'app',
  [RATELIMIT_TYPE.SYNC]   : 'sync',
  [RATELIMIT_TYPE.BACKOFF]: 'backoff'
}
export const RATELIMIT_INIT_SECONDS: number = 7200;

export const FACTOR_REQUEST_MARGIN_BELOW_5_SEC: number = 0.75
export const FACTOR_REQUEST_MARGIN_ABOVE_5_SEC: number = 0.9

export interface Comparable {
  equals(c): boolean

  compareTo(c1, c2): number
}

export class RateLimit implements Comparable, RateLimitOptions {
  private _requests: number
  private requestsSafeBurst: number;

  public get requests(): number {return this._requests}

  private _seconds: number
  public get seconds(): number {return this._seconds}

  private _type: RATELIMIT_TYPE
  public get type(): RATELIMIT_TYPE {return this._type}

  private _count: number
  public get count(): number {return this._count}

  private _debug: boolean;
  public get debug(): boolean {return this._debug}


  private resetTimeout: NodeJS.Timer;
  private timestampLastReset: number = Date.now()

  /** limiters that use this limit to be notified if it was updated (by another limiter) */
  private limiters: RateLimiter[];

  constructor({requests, seconds, type = RATELIMIT_TYPE.APP, count = 0}: RateLimitOptions, {debug = false} = {}) {
    this._requests = requests
    this._seconds  = seconds
    this._type     = type
    this._count    = count

    this.startResetTimer()

    this._debug             = debug
    this.timestampLastReset = Date.now()

    this.requestsSafeBurst = (this.seconds <= 5) ? Math.floor(this.requests * FACTOR_REQUEST_MARGIN_BELOW_5_SEC) : Math.floor(this.requests * FACTOR_REQUEST_MARGIN_ABOVE_5_SEC)
    this.limiters          = []
  }

  static getRateLimitTypeString(type: RATELIMIT_TYPE) {
    return RATELIMIT_TYPE_STRINGS[type]
  }

  addLimiter(limiter: RateLimiter) {
    this.limiters.push(limiter)
  }

  reloadLimiters() {
    this.limiters = this.limiters.filter((limiter) => {
      return limiter.getLimits().find(limit => limit.equals(this))
    })
  }

  dispose() {
    clearTimeout(this.resetTimeout)
    this.limiters.forEach(limiter => limiter.notifyAboutRemovedLimit(this))
  }

  static calcMSUntilReset(limitIntervalSeconds: number, timestampLastLimitReset: number = 0) {
    const timeSinceLastResetMS = Date.now() - timestampLastLimitReset
    let remainingInterval      = limitIntervalSeconds * 1000 - timeSinceLastResetMS
    if (remainingInterval < 0) {
      remainingInterval *= -1
      remainingInterval %= limitIntervalSeconds * 1000
    }
    return remainingInterval
  }

  check(strategy: STRATEGY) {
    return this.getRemainingRequests(strategy) !== 0
  }

  private getSecondsUntilReset() {
    const remaingSeconds = ((this.seconds * 1000) - (Date.now() - this.timestampLastReset)) / 1000
    return remaingSeconds > 0 ? remaingSeconds : 0
  }

  getMaximumRequests(strategy: STRATEGY) {
    if (this.isUsingSafetyMargin(strategy)) {
      return this.requestsSafeBurst
    } else {
      return this.requests
    }
  }

  getRemainingRequests(strategy: STRATEGY) {
    let available
    if (this.isUsingSafetyMargin(strategy)) {
      // using only 95% of the limit as safety measure on burst
      available = this.requestsSafeBurst
    } else {
      available = this.requests
    }

    let remaining = available - this._count
    return remaining > 0 ? remaining : 0
  }

  isUsingSafetyMargin(strategy: STRATEGY) {
    return strategy === STRATEGY.BURST && this.type !== RATELIMIT_TYPE.SYNC && this.type !== RATELIMIT_TYPE.BACKOFF
  }

  getSpreadInterval() {
    const remainingExecutionsInIntervall = this._requests - this._count
    return RateLimit.calcMSUntilReset(this._seconds, this.timestampLastReset) / ((remainingExecutionsInIntervall > 0) ? remainingExecutionsInIntervall : 1);
  }

  increment(count: number = 0) {
    if (count > 0) {
      this._count += count
    } else {
      this._count++
    }
  }

  reset() {
    if (this.type === RATELIMIT_TYPE.BACKOFF) {
      this.limiters.forEach(limiter => {
        limiter.notifyAboutBackoffFinished(this)
      })
      this.dispose()
    } else {
      this._count             = 0
      this.timestampLastReset = Date.now()

      if (!this.check(STRATEGY.BURST)) {
        if (this.debug) {console.log('resetting exceeded limit', this.toString())}
        this.limiters.forEach(limiter => {
          limiter.notifyAboutExceededLimitReset()
        })
      }
      this.restartTimeout()
    }
  }

  toString() {
    return `${RATELIMIT_TYPE_STRINGS[this._type]} RateLimit: ${this._count}/${this._requests}:${this._seconds} | resetting in ${this.getSecondsUntilReset()}`
  }

  update({requests = this._requests, seconds = this._seconds, type = this._type, count = this._count}: RateLimitUpdateOptions) {

    const wasExceededBeforeUpdate = !this.check(STRATEGY.BURST)
    this.updateValues({requests, seconds, type, count})
    const isExceededAfterUpdate = !this.check(STRATEGY.BURST)

    // restart timeout if the update indicates an exceeded burst limit or if the limit was exceeded before and got
    // updated to an acceptable value
    // this might lead to longer waiting times, but prevents wrong automatic resets
    if (isExceededAfterUpdate || (!isExceededAfterUpdate && wasExceededBeforeUpdate)) {
      this.restartTimeout()
    }
    this.notifyLimiters()
  }

  updateSilently(limit: RateLimitOptions) {
    this.updateValues(limit)
  }

  private updateValues(limit: RateLimitOptions) {
    if (this._debug) {
      console.log(`updating ${this.toString()}:
      requests: ${this._requests} to ${limit.requests}
      seconds ${this._seconds} to ${limit.seconds}
      count ${this._count} to ${limit.count}`)
    }

    this._requests = limit.requests
    this._seconds  = limit.seconds
    this._type     = limit.type
    this._count    = limit.count
  }

  /** if there is currently no timeout running to reset the limit, start it.
   * Otherwise a noop */
  private startResetTimer() {
    if (!this.resetTimeout) {
      if (this.debug && !this.check(STRATEGY.BURST)) {
        console.log('starting resetTimeout for exceeded limit' + this._seconds * 1000, this.toString())
      }
      // NOTE: using timeout since interval is not testable for some reason with node-ts and sinon!?
      this.resetTimeout = setTimeout(() => {this.reset()}, this._seconds * 1000)
      this.resetTimeout.unref()
    }
  }

  private notifyLimiters() {
    this.limiters.forEach(limiter => {
      limiter.notifyAboutLimitUpdate(this)
    })
  }

  static compare(limit1: RateLimitOptions, limit2: RateLimitOptions) {
    const compareLimits = limit2.requests - limit1.requests;

    let compareSeconds: number = 0;
    if (compareLimits === 0) {
      compareSeconds = limit2.seconds - limit1.seconds
    }

    return compareSeconds + compareLimits
  }

  compareTo(comparable: RateLimitOptions): number {
    return RateLimit.compare(this, comparable)
  }

  equals(limit: RateLimitOptions) {
    if (limit.type === RATELIMIT_TYPE.BACKOFF || limit.type === RATELIMIT_TYPE.SYNC) {
      return this.type === limit.type
    }
    return this.compareTo(limit) === 0
  }

  restartTimeout() {
    clearTimeout(this.resetTimeout)
    this.resetTimeout = null
    this.startResetTimer()
  }
}

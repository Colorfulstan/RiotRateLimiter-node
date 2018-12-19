import {
  RateLimit,
  RATELIMIT_INIT_SECONDS, RATELIMIT_TYPE, RATELIMIT_TYPE_STRINGS,
  RateLimitOptions
} from '../RateLimit';
import {RiotRateLimiterParameterError} from '../errors/RiotRateLimiterParameterError';

export type RateLimiterOptions = {
  limits: RateLimit[], strategy?: STRATEGY, debug?: boolean
}

export enum STRATEGY {
  BURST,
  SPREAD
}

export const RATELIMIT_BACKOFF_DURATION_MS_DEFAULT = 1000

export class RateLimiter {
  private debug: boolean;
  public static STRATEGY = STRATEGY

  /** backoff duration used on 429 from underlying system */
  private backoffDurationMS: number = RATELIMIT_BACKOFF_DURATION_MS_DEFAULT
  private backoffUntilTimestamp: number

  private intervalProcessQueue: NodeJS.Timer        = null;
  private intervalNextSpreadExecution: NodeJS.Timer = null

  private queue: Array<{ fn: (limiter: RateLimiter) => any, resolve: (value?: (PromiseLike<any> | any)) => void, reject: (reason?: any) => void }> = []

  private strategy: STRATEGY;

  /** all limits set within the limiter.
   * manipulation should only be done by using .addLimit() and .removeLimit
   * to ensure integrity throughout shared limits */
  private limits: RateLimit[];

  /**
   * Indicates that the limiter is paused.
   * A paused limiter will not execute any queued items and newly scheduled items will be added to the queue directly.
   */
  private _isPaused: boolean;

  constructor({limits, strategy = RateLimiter.STRATEGY.BURST, debug = false}: RateLimiterOptions) {
    if (!limits || !Array.isArray(limits) || limits.length === 0) {
      throw new RiotRateLimiterParameterError('At least one RateLimit has to be provided!')
    }
    this.limits   = limits
    this.strategy = strategy
    this.debug    = debug

    limits.forEach(limit => limit.addLimiter(this))
  }

  addOrUpdateLimit(limit: RateLimit) {
    if (this.debug && (limit.type === RATELIMIT_TYPE.BACKOFF || limit.type === RATELIMIT_TYPE.SYNC)) {
      console.log('adding ' + RATELIMIT_TYPE_STRINGS[limit.type] + ' limit', limit.toString())
    }

    const limitIndex = this.indexOfLimit(limit)
    if (limitIndex === -1) {
      limit.addLimiter(this)
      this.limits.push(limit)
      return limit
    } else if (limit.type === RATELIMIT_TYPE.BACKOFF || limit.type === RATELIMIT_TYPE.SYNC) {
      // we want to ensure only one of those limits even if they changed in values
      const foundLimit = this.limits[limitIndex]
      foundLimit.updateSilently(limit)
      foundLimit.restartTimeout()

      if (limit.type === RATELIMIT_TYPE.SYNC) {
        this.clearTimeoutAndInterval()
      }

      return foundLimit
    }
    return null
  }

  removeLimit(limit: RateLimit) {
    const index = this.indexOfLimit(limit)
    if (index !== -1) {
      const removedLimit = this.limits.splice(index, 1)[0]
      removedLimit.reloadLimiters()
      return removedLimit
    }
    return null
  }

  updateLimits(limitsOptions: RateLimitOptions[]) {
    if (this.debug) {
      console.log('limits before update: ' + this.getLimitStrings())
      console.log('options to update from: ' + JSON.stringify(limitsOptions, null, 2))
    }

    this.pause()

    // remove limits not within the update
    this.limits.filter(limit => !limitsOptions.find(options => limit.equals(options)))
        .forEach(options => this.removeLimit(options))

    // updating count when needed, otherwise only make sure the right limits are available
    if (this.isInitializing()) {
      this.limits.forEach(limit => {
        const update = limitsOptions.find(options => limit.equals(options))
        if (update) {
          limit.update(update)
        }
      })
    }

    // add limits not yet in limiter
    limitsOptions.filter(options => this.indexOfLimit(options) === -1)
                 .forEach(options => {
                   this.addOrUpdateLimit(new RateLimit(options, {debug: this.debug}))
                 })

    if (this.debug) {
      console.log('updated limits: ' + this.getLimitStrings())
    }
    // refresh limiter
    this.unpause()
  }

  /** index of the limit within this.limits or -1 if not found */
  indexOfLimit(limit: RateLimit | RateLimitOptions): number {
    let index = -1
    this.limits.find((_limit, i) => {
      if (_limit.equals(limit)) {
        index = i
        return true
      } else return false
    })
    return index
  }

  notifyAboutBackoffFinished(limit: RateLimit) {
    if (this.debug && this.indexOfLimit(limit) === -1) { // TODO: DRY
      console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!')
    }
    this.backoffUntilTimestamp = null
    this.addOrUpdateLimit(RateLimiter.createSyncRateLimit())
  }

  notifyAboutLimitUpdate(limit: RateLimit) {
    if (this.debug && this.indexOfLimit(limit) === -1) { // TODO: DRY
      console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!')
    }
    if (this.isStrategySpread()) {
      this.refresh()
    }
  }

  notifyAboutExceededLimitReset() {
    this.addOrUpdateLimit(RateLimiter.createSyncRateLimit())
  }

  notifyAboutLimitReached(limit: RateLimit) {
    if (this.debug && this.indexOfLimit(limit) === -1) { // TODO: DRY
      console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!')
    }
    // TODO: add callback to notify user about time until next burst
    console.warn('rate limit reached ' + limit.toString())
  }

  notifyAboutRemovedLimit(rateLimit: RateLimit) {
    this.removeLimit(rateLimit)
  }

  isStrategyBurst() {
    return this.strategy === STRATEGY.BURST
  }

  isStrategySpread() {
    return this.strategy === STRATEGY.SPREAD
  }

  public get isPaused(): boolean {
    return this._isPaused;
  }

  /**
   *
   * @return {boolean} true if the limit is not yet met
   */
  public checkBurstRateLimit(): boolean {
    const exceededLimit = this.limits.find(limit => !limit.check(this.strategy))
    // if (this.debug && exceededLimit) {
    //   console.log('exceeded ratelimt found: ', exceededLimit.toString())
    // }
    return !exceededLimit
  }

  /**
   * @return {boolean} true if the limit is not yet met
   */
  public checkSpreadRateLimit(): boolean {
    // since spread is done through timeout with the shortest interval allowed across all limits, we
    // only need to check if there are items in the queue
    return this.queue.length === 0 && !this.intervalNextSpreadExecution && this.limits.length > 0
  }

  public getLimits(): RateLimit[] {
    return this.limits
  }

  public getLimitStrings(): string[] {
    return this.limits.map((limit) => limit.toString() + '\r\n')
  }

  public toString(): string {
    let rateLimiterSetupInfo     = `RateLimiter with ${this.getStrategyString()} - Limits: \r\n${this.getLimitStrings()}`
    let spreadLimitExecutionInfo = `${this.isStrategySpread() ? `next execution in ${this.getSpreadInterval() / 1000} seconds` : ''}`
    let backoffInfo              = `${this.backoffUntilTimestamp ? `| backing off until ${new Date(this.backoffUntilTimestamp)}` : ''}`

    return `${rateLimiterSetupInfo} | ${spreadLimitExecutionInfo} | ${backoffInfo}`
  }

  /**
   *
   * @return {number} number of currently waiting requests within this specific RateLimiter instance. Not taking
   * into account possible chained limiters
   */
  public getQueueSize(): number {
    return this.queue.length
  }

  public getStrategy() {
    return this.strategy
  }

  public getStrategyString() {
    switch (this.strategy) {
      case STRATEGY.SPREAD:
        return 'SPREAD Strategy'
      case STRATEGY.BURST:
        return 'BURST Strategy'
      default:
        return 'UNKNOWN Strategy'
    }
  }

  /** stops executing the queue and sets the limiter to paused */
  private pause() {

    if (this.debug) {
      console.log('pausing limiter ' + this.toString())
    }

    this._isPaused = true
    this.clearTimeoutAndInterval()
  }

  /**
   * Changes the strategy and refreshes the limiting processes.
   * @param {STRATEGY} strategy
   */
  public setStrategy(strategy: STRATEGY) {
    this.strategy = strategy
    this.refresh()
  }

  /**
   * Schedules a function execution acchording to the rate limits and strategy set.
   *
   * @param fn the (anonymous) function to be executed. Will be passed the executing RateLimiter when executed
   * @param isReschedule if true, execution will be done asap instead of queueing up and will not increase the
   * execution count. Meaning, if there is a queue it will be added in front.
   * @return {Promise<any>} Promise will be resolved with the return value of the executed function, or rejected if
   * errors are thrown during the function execution
   */
  public scheduling(fn: (limiter: RateLimiter) => any, isReschedule = false) {
    if (this.isStrategyBurst()) {
      return this.schedulingWithBurst(fn, isReschedule)
    }
    if (this.isStrategySpread()) {
      return this.schedulingWithSpread(fn, isReschedule)
    }
  }

  /**
   * Schedules a function execution to be executed asap, disregarding existing queue
   * @see {@link scheduling}
   * */
  public rescheduling(fn: (limiter: RateLimiter) => any) {
    return this.scheduling(fn, true)
  }

  /**
   * Pause this limiter for the given amount of time.
   * Limits will reset on themselves, so we just need to hold off on the executions and push additionally received
   * requests into the queue
   * @param {any} retryAfterMS
   */
  public backoff({retryAfterMS = void 0} = {}) {
    if (retryAfterMS === void 0) {
      if (this.debug) {
        console.log('429 from underlying system, backing off generically')
      }
      // setting an arbitrary backoff duration that increases exponentially
      retryAfterMS = this.backoffDurationMS
      this.backoffDurationMS *= 2
    } else {
      this.backoffDurationMS = RATELIMIT_BACKOFF_DURATION_MS_DEFAULT
    }
    if (retryAfterMS <= 1000) retryAfterMS = 2000
    this.backoffUntilTimestamp = Date.now() + retryAfterMS

    if (this.debug) {
      console.log('Backing off for ' + retryAfterMS / 1000 + 'seconds')
    }
    this.addOrUpdateLimit(RateLimiter.createBackoffRateLimit((retryAfterMS / 1000), this.debug))
    this.addOrUpdateLimit(RateLimiter.createSyncRateLimit(this.debug))
  }

  public resetBackoff() {
    this.backoffDurationMS     = RATELIMIT_BACKOFF_DURATION_MS_DEFAULT
    this.backoffUntilTimestamp = null
  }

  private schedulingWithBurst(fn: (limiter: RateLimiter) => any, isReschedule = false) {
    return new Promise((resolve, reject) => {
      if (this.debug) {
        console.log('scheduling request, limit not exceeded: ' + this.checkBurstRateLimit() + ' rescheduled:' +
          ' ' + isReschedule)
      }
      if (!this.isPaused && this.checkBurstRateLimit()) {
        if (this.debug) console.log('executing function')
        this.execute(fn, resolve, reject)
      } else {
        this.addToQueue(fn, resolve, reject, isReschedule)
      }
    })
  }

  private schedulingWithSpread(fn: (limiter: RateLimiter) => any, isReschedule = false) {
    return new Promise((resolve, reject) => {
      if (!this.isPaused && this.checkSpreadRateLimit()) {
        this.refresh()
        this.execute(fn, resolve, reject)
      } else {
        this.addToQueue(fn, resolve, reject, isReschedule)
      }
    })
  }

  public addToQueue(fn: (limiter: RateLimiter) => any,
                    resolve: (value?: (PromiseLike<any> | any)) => void,
                    reject: (reason?: any) => void,
                    isReschedule: boolean = false
  ) {
    if ((this.isStrategySpread() && !this.intervalNextSpreadExecution) || (this.isStrategyBurst() && !this.intervalProcessQueue)) {
      this.refresh()
    }
    if (isReschedule) {
      this.queue.unshift({fn, resolve, reject})
    } else {
      this.queue.push({fn, resolve, reject})
    }
    return this.queue
  }

  /**
   * Procecces the first item of the queue
   * */
  private processSpreadLimitInterval() {
    if (this.queue.length !== 0) {
      const {fn, resolve, reject} = this.queue.shift()
      this.execute(fn, resolve, reject)
    } else {
      this.pause()
    }
  }

  /** refreshes the limiter processes.
   * Use this after changing any settings in the limiter that need to be applied to executions
   * */
  private refresh() {
    if (this.isStrategyBurst()) {
      this.refreshBurstLimiter()
    } else if (this.isStrategySpread()) {
      this.refreshSpreadLimiter()
    }
  }

  private clearTimeoutAndInterval() {
    clearInterval(this.intervalProcessQueue)
    this.intervalProcessQueue = null

    clearInterval(this.intervalNextSpreadExecution)
    this.intervalNextSpreadExecution = null
  }

  private refreshBurstLimiter() {
    this.clearTimeoutAndInterval()

    this.processBurstQueue()

    if (this.queue.length !== 0) {
      // kind of a primitive round-robin in case limiters use the same limit
      // with the same interval every time the limiter that is created first would always get the reset from the limit
      // rare case propably
      const factorForEqualRights = Math.floor(Math.random() * 100)
      this.intervalProcessQueue  = setInterval(() => {this.processBurstQueue()}, 1000 + factorForEqualRights)
      this.intervalProcessQueue.unref()
    }
  }

  private refreshSpreadLimiter() {
    this.clearTimeoutAndInterval()

    this.intervalNextSpreadExecution = setInterval(() => {
      this.processSpreadLimitInterval()
    }, this.getSpreadInterval())
    this.intervalNextSpreadExecution.unref()
  }

  /**
   * Executes the function, passing the result to given callbacks
   * @param {Function} fn
   * @param {(value?: (PromiseLike<any> | any)) => void} onSuccess
   * @param {(reason?: any) => void} onError
   */
  private execute(fn: (limiter: RateLimiter) => any,
                  onSuccess: (value?: (PromiseLike<any> | any)) => void,
                  onError: (reason?: any) => void
  ) {
    try {
      this.limits.forEach(limit => limit.increment())
      onSuccess(fn(this))
    } catch (e) {
      onError(e)
    }
  }

  processBurstQueue() {
    if (this.checkBurstRateLimit()) {
      const limitWithLowestRequestsRemaining = this.limits.reduce((foundLimit, limit) => {
        if (foundLimit === null) { return limit }
        return (foundLimit.getRemainingRequests(STRATEGY.BURST) < limit.getRemainingRequests(STRATEGY.BURST)) ? foundLimit : limit
      }, null)

      const queueSplice = this.queue.splice(0, limitWithLowestRequestsRemaining.getRemainingRequests(STRATEGY.BURST))

      if (this.debug && limitWithLowestRequestsRemaining.type === RATELIMIT_TYPE.SYNC) {
        console.log('processing single item to sync with headers')
        queueSplice.forEach(({fn, resolve, reject}) => {
          this.scheduling(fn, true).then(resolve).catch((err) => {
            // if (err.statusCode >= 500){
            // in case we get an error from the synching call, we need to be able to move on
            // we do so by backing off with the default value and moving on from there
            // while still rejecting the original function, to delegate the error to the user
            this.backoff()
            // }
            reject(err)
          })
        })
      }
      queueSplice.forEach(({fn, resolve, reject}) => {
        this.scheduling(fn, true).then(resolve).catch(reject)
      })
    }
  }

  private isBackoffWithoutRetryAfter() {
    return this.backoffDurationMS !== RATELIMIT_BACKOFF_DURATION_MS_DEFAULT
  }

  isStrategy(strategy: STRATEGY) {
    return this.strategy === strategy
  }

  getQueue() {
    return this.queue
  }

  /** start executing the queue again and sets the limiter to unpaused */
  private unpause() {
    if (this.debug) {
      console.log('unpausing limiter ' + this.toString())
    }

    this._isPaused = false
    this.refresh()
  }

  private getSpreadInterval(): number {
    return this.limits.reduce((longestInterval: number, limit: RateLimit) => {
      const interval = limit.getSpreadInterval()
      if (longestInterval === null) return interval
      return (longestInterval > interval) ? longestInterval : interval
    }, null)
  }

  /** true if the RateLimiter contains the init type rateLimit */
  isInitializing() {
    return !!this.limits.find(limit => limit.type === RATELIMIT_TYPE.SYNC)
  }

  /** Rate Limit with a single request to synch up a methods rate-limiter with the response headers before starting
   *  batch requests.
   *  Only use this as initial RateLimit for a fresh RateLimiter.
   *
   *  Needs to be replaced with the correct RateLimit objects afterwards.
   *  This is taken care off by {@link executingScheduledCallback}
   *  */
  public static createSyncRateLimit(debug = false): RateLimit {
    return new RateLimit({
      requests: 1,
      seconds : RATELIMIT_INIT_SECONDS,
      type    : RATELIMIT_TYPE.SYNC
    }, {debug})
  }

  private static createBackoffRateLimit(seconds, debug: boolean) {
    return new RateLimit({
      requests: 0,
      seconds : seconds,
      type    : RATELIMIT_TYPE.BACKOFF
    }, {debug})
  }
}

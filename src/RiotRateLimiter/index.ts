import {RateLimiter, STRATEGY} from '../RateLimiter'

const requestP = require('request-promise');
const Bluebird = require('bluebird');

export type RiotRateLimiterConstructorOptions = { strategy?: STRATEGY, debug?: boolean }
export type RiotRateLimiterOptions = { limits: RateLimitOptions[], strategy: STRATEGY, platformId: string, apiMethod: string }


import {RiotRateLimiterParameterError} from '../errors/RiotRateLimiterParameterError';
import {RateLimit, RATELIMIT_INIT_SECONDS, RATELIMIT_TYPE, RateLimitOptions} from '../RateLimit/index';

export class RiotRateLimiter {

  /**
   * Each apiMethod on each platformId has multiple rate-limiters representing the rate-limits told from the
   * response-headers.
   *
   * Ordering of the RateLimiter Array is not guaranteed, but chain will be ordered in a predictable manner.
   * To add an execution to the chain, use .getFirstInChain() on any of the limiters and call .scheduling on the
   * returned limiter. This will ensure the function passed goes through all the limiters before being executed.
   */
  private limitersPerPlatformId: {
    [platformId: string]: {
      [apiMethod: string]: RateLimiter
    }
  };

  /** Rate limiting strategy currently active */
  private strategy: STRATEGY;
  private debug: boolean;
  private appLimits: RateLimit[];

  // TODO: do we even need the input limits? // propably only as fallback in case there are headers missing
  constructor({strategy = STRATEGY.SPREAD, debug = false}: RiotRateLimiterConstructorOptions = {}) {
    this.strategy = strategy
    this.debug    = debug

    this.limitersPerPlatformId = {}
  }

  public executing({url, token, resolveWithFullResponse = false}) {
    const {platformId, apiMethod} = RiotRateLimiter.extractPlatformIdAndMethodFromUrl(url)

    // IF there are no limiters set for the method yet, we do a request to sych the limits and create the needed
    // limiters
    if (!this.limitersPerPlatformId[platformId]) {
      this.limitersPerPlatformId[platformId] = {}
    }
    if (!this.limitersPerPlatformId[platformId][apiMethod]) {
      console.log('creating sync rate limimter for ', platformId, apiMethod)
      this.limitersPerPlatformId[platformId][apiMethod] = new RateLimiter({
        limits  : [RateLimiter.createSyncRateLimit(this.debug)],
        strategy: this.strategy,
        debug   : this.debug
      })
      if (this.debug) {
        console.log('RateLimiterChain for init request created\r\n' + this.limitersPerPlatformId[platformId][apiMethod].toString())
      }
    }

    return this.limitersPerPlatformId[platformId][apiMethod]
      .scheduling((rateLimiter: RateLimiter) => {
        return this.executingScheduledCallback(rateLimiter, {
          url,
          token,
          resolveWithFullResponse
        })
      })
  }

  private executingScheduledCallback(rateLimiter: RateLimiter,
                                     {url, token, resolveWithFullResponse = false}
  ) {
    return Bluebird.resolve().then(() => {
      if (!url) { throw new RiotRateLimiterParameterError('URL has to be provided for the ApiRequest') }
      if (!token) { throw new RiotRateLimiterParameterError('options.token has to be provided for the ApiRequest'); }

      let options = {
        url      : url,
        method   : 'GET',
        headers  : {'X-Riot-Token': token},
        resolveWithFullResponse,
        transform: (body, response, resolveWithFullResponse) => {
          let updatedLimits: RateLimitOptions[] = []

          if (this.debug) {
            console.log(response.statusCode)
            console.log(response.headers)
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            resolveWithFullResponse = true
          }

          // App limits
          // X-App-Rate-Limit and X-App-Rate-Limit-Count + Retry-After if 429
          if (response.headers['x-app-rate-limit']) {
            const appRateLimits = RiotRateLimiter.extractRateLimitFromHeader(RATELIMIT_TYPE.APP, response.headers['x-app-rate-limit'])

            if (response.headers['x-app-rate-limit-count']) {
              RiotRateLimiter.addRequestsCountFromHeader(RATELIMIT_TYPE.APP, appRateLimits, response.headers['x-app-rate-limit-count'])
            }

            this.updateAppRateLimits(appRateLimits)
            if (this.appLimits) {
              this.appLimits.forEach(limit => {
                rateLimiter.addOrUpdateLimit(limit)
              })
              updatedLimits = updatedLimits.concat(appRateLimits)
            }
          }


          // Method limits
          // X-Method-Rate-Limit and X-Method-Rate-Limit-Count + Retry-After if 429
          if (response.headers['x-method-rate-limit']) {
            const methodRateLimits = RiotRateLimiter.extractRateLimitFromHeader(RATELIMIT_TYPE.METHOD, response.headers['x-method-rate-limit'])

            if (response.headers['x-method-rate-limit-count']) {
              RiotRateLimiter.addRequestsCountFromHeader(RATELIMIT_TYPE.METHOD, methodRateLimits, response.headers['x-method-rate-limit-count'])
            }
            updatedLimits = updatedLimits.concat(methodRateLimits)
          }

          if (updatedLimits.length > 0) {
            if (this.debug) {
              console.log('limitOptions from headers:')
              console.log(JSON.stringify(updatedLimits, null, 2))
            }
            rateLimiter.updateLimits(updatedLimits)
          } else if (rateLimiter.isInitializing()) {
            rateLimiter.addOrUpdateLimit(RateLimiter.createSyncRateLimit(this.debug))
          }

          if (response.statusCode === 429) {
            let retryAfterMS: number;

            if (response.headers['retry-after']) {
              // App, method or service limit exceeded => backoff
              // (limits update done anyways for app and method limiters)
              // X-Rate-Limit-Type + Retry-After


              if (this.debug) {
                console.warn('Rate limit exceeded on X-Rate-Limit-Type: ' + response.headers['x-rate-limit-type'])
                console.warn('Backing off and continue requests after: ' + response.headers['retry-after'])
                console.warn('Request url: ' + url)
              }

              retryAfterMS = parseInt(response.headers['retry-after']) * 1000;

            } else {
              // service limits from underlying system (return to sender - requestPromise will create a StatusCodeError)
              if (this.debug) {
                console.warn('Rate limit exceeded on underlying system for ' + url)
              }
            }

            rateLimiter.backoff({retryAfterMS})
            return response
          }

          rateLimiter.resetBackoff() // request succesful, make sure backoff is reset
          return resolveWithFullResponse ? response : body
        }
      };

      return requestP(options)
        .catch(err => {
          if (err.statusCode !== 429) {
            throw err
          } else {
            if (this.debug) {
              console.warn('rescheduling request on ' + rateLimiter.toString())
            }

            return rateLimiter.rescheduling((rateLimiter: RateLimiter) => {
              return this.executingScheduledCallback(rateLimiter, {
                url,
                token,
                resolveWithFullResponse
              })
            })
          }
        });
    });
  }

  private static extractPlatformIdAndMethodFromUrl(url: string) {
    let platformId: string;
    let apiMethod: string = url.toLowerCase();

    platformId = url.match(/\/\/(.*?)\./)[1];

    // matches "by-something/whatever/",  "by-something/whatever" and "by-something/whatever?moreStuff"
    let regex = /by-.*?\/(.*?)\/|by-.*?\/(.*?$)/g

    let regexResult       = regex.exec(url)
    const regexResultsArr = []
    while (regexResult !== null) {
      regexResultsArr.push(regexResult)
      regexResult = regex.exec(url)
    }

    regexResultsArr.reverse().forEach(result => {
      // find first slash -> beginning of parameter
      const slashIndex = apiMethod.indexOf('/', result.index)
      apiMethod        = apiMethod.substring(0, slashIndex + 1) + apiMethod.substring(result.index + result[0].length)
    })

    apiMethod = apiMethod
      .replace(/\?.*/g, '') // removing query
      .replace(/\/\d+/g, '/'); // removing possible numeric parameter following "/"

    apiMethod = apiMethod.substring(apiMethod.search(/\w\/\w/) + 1); // cut off host before first / after //
    if (!platformId || !apiMethod) throw new Error('Could not extract PlatformId and Method from url: ' + url)
    return {platformId, apiMethod}
  }

  public static extractRateLimitFromHeader(type: RATELIMIT_TYPE, rateLimitHeader: string): RateLimitOptions[] {
    return rateLimitHeader.split(',')
                          .map(limitString => {
                            const [requests, seconds] = limitString.split(':').map(limitString => parseInt(limitString))
                            return <RateLimitOptions>{requests, seconds, type}
                          })
  }

  public static extractRateLimitCountsFromHeader(type: RATELIMIT_TYPE,
                                                 rateLimitCountHeader: string
  ): RateLimitOptions[] {
    return rateLimitCountHeader
      .split(',')
      .map(limitCountString => {
        const [count, seconds] = limitCountString.split(':')
                                                 .map(limitOrCountString => parseInt(limitOrCountString))
        return <RateLimitOptions>{count, seconds, type}
      })
  }

  private static addRequestsCountFromHeader(type: RATELIMIT_TYPE, updatedLimits: RateLimitOptions[],
                                            rateLimitCountHeader: string
  ): RateLimitOptions[] {
    const limitCounts = RiotRateLimiter.extractRateLimitCountsFromHeader(type, rateLimitCountHeader)

    return updatedLimits.map(options => {
      const limitCountUpdate = limitCounts.find(rateLimitCount => rateLimitCount.seconds === options.seconds)
      if (limitCountUpdate) {
        options.count = limitCountUpdate.count
      }
      return options
    })
  }

  /** returns the string representation of the limiter that will take care of the given url requests when it is
   *  executed by {@link executing}.
   *  If no url is passed, it stringifies all available RateLimiters
   *  @param url a full API url */
  toString(url: string) {
    if (url) {
      const {platformId, apiMethod} = RiotRateLimiter.extractPlatformIdAndMethodFromUrl(url)
      if (this.limitersPerPlatformId[platformId][apiMethod]) {
        return this.limitersPerPlatformId[platformId][apiMethod].toString()
      }
    } else {
      return JSON.stringify(this.limitersPerPlatformId, null, 2)
    }
  }

  /** Changes the limiting strategy for all available Limiters */
  setStrategy(strategy: STRATEGY) {
    this.strategy = strategy
    Object.keys(this.limitersPerPlatformId).forEach(platformId => {
      Object.keys(this.limitersPerPlatformId[platformId]).forEach((methodName) => {
        this.limitersPerPlatformId[platformId][methodName].setStrategy(strategy)
      })
    })
  }

  /**
   * Returns all RateLimit instances for the given platformId.
   * App-RateLimits references are included in each apiMethod array.
   * @return {{[p: string]: {[p: string]: RateLimit[]}}}
   */
  getLimitsForPlatformId(platformId: string): { [apiMethod: string]: RateLimit[] } {
    if (!platformId) {
      throw new RiotRateLimiterParameterError('platformId is required')
    }

    platformId                = platformId.toLowerCase()
    const limitersForPlatform = this.limitersPerPlatformId[platformId]
    if (!limitersForPlatform) {
      return {}
    }
    const limits = {}
    for (let apiMethod in limitersForPlatform) {
      limits[apiMethod] = limitersForPlatform[apiMethod].getLimits()
    }
    return limits
  }

  /**
   * Returns all RateLimit instances.
   * App-RateLimits references are included in each apiMethod array.
   * @return {{[p: string]: {[p: string]: RateLimit[]}}}
   */
  getLimits(): { [platformId: string]: { [apiMethod: string]: RateLimit[] } } {
    const limits = {}
    if (!this.limitersPerPlatformId) {
      return limits;
    }

    for (let platformId in this.limitersPerPlatformId) {
      const limitersForPlatform = this.limitersPerPlatformId[platformId]
      if (!limitersForPlatform) { return limits}

      for (let apiMethod in limitersForPlatform) {
        limits[platformId][apiMethod] = limitersForPlatform[apiMethod].getLimits()
      }
    }
    return limits
  }

  /** Updates the App RateLimits stored here for shared usage across all method RateLimiter instances.
   *
   * @param {RateLimitOptions[]} updateOptions
   * @return {any}
   */
  private updateAppRateLimits(updateOptions: RateLimitOptions[] = []) {
    // if no updatedLimits given, noop
    if (updateOptions.length === 0) {
      return null
    }

    let updateOptionsCopy = updateOptions.slice()

    // if no limits set yet, just set
    if (!this.appLimits || this.appLimits.length === 0) {
      this.appLimits = updateOptionsCopy.map(options => new RateLimit(options, {debug: this.debug}))
    } else {
      // else update the limits acchordingly

      // removing deprecated limits
      this.appLimits = this.appLimits.filter(limit => {
        const optionsForLimit = updateOptionsCopy.find((options, index) => {
          if (limit.seconds === options.seconds) {
            // removing the option since it is not needed anymore
            updateOptionsCopy.splice(index, 1)
            return true
          } else return false
        })

        if (optionsForLimit) {
          return true
        } else {
          limit.dispose()
          return false
        }
      })

      // adding additional limits if neccessary
      if (updateOptionsCopy.length > 0) {
        this.appLimits = this.appLimits.concat(updateOptionsCopy.map(
          options => new RateLimit(options, {debug: this.debug})))
      }
    }
  }
}

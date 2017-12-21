"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const RateLimit_1 = require("../RateLimit");
const RiotRateLimiterParameterError_1 = require("../errors/RiotRateLimiterParameterError");
var STRATEGY;
(function (STRATEGY) {
    STRATEGY[STRATEGY["BURST"] = 0] = "BURST";
    STRATEGY[STRATEGY["SPREAD"] = 1] = "SPREAD";
})(STRATEGY = exports.STRATEGY || (exports.STRATEGY = {}));
exports.RATELIMIT_BACKOFF_DURATION_MS_DEFAULT = 1000;
class RateLimiter {
    constructor({ limits, strategy = RateLimiter.STRATEGY.BURST, debug = false }) {
        this.backoffDurationMS = exports.RATELIMIT_BACKOFF_DURATION_MS_DEFAULT;
        this.intervalProcessQueue = null;
        this.intervalNextSpreadExecution = null;
        this.queue = [];
        if (!limits || !Array.isArray(limits) || limits.length === 0) {
            throw new RiotRateLimiterParameterError_1.RiotRateLimiterParameterError('At least one RateLimit has to be provided!');
        }
        this.limits = limits;
        this.strategy = strategy;
        this.debug = debug;
        limits.forEach(limit => limit.addLimiter(this));
    }
    addOrUpdateLimit(limit) {
        if (this.debug && (limit.type === RateLimit_1.RATELIMIT_TYPE.BACKOFF || limit.type === RateLimit_1.RATELIMIT_TYPE.SYNC)) {
            console.log('adding ' + RateLimit_1.RATELIMIT_TYPE_STRINGS[limit.type] + ' limit', limit.toString());
        }
        const limitIndex = this.indexOfLimit(limit);
        if (limitIndex === -1) {
            limit.addLimiter(this);
            this.limits.push(limit);
            return limit;
        }
        else if (limit.type === RateLimit_1.RATELIMIT_TYPE.BACKOFF || limit.type === RateLimit_1.RATELIMIT_TYPE.SYNC) {
            const foundLimit = this.limits[limitIndex];
            foundLimit.updateSilently(limit);
            foundLimit.restartTimeout();
            if (limit.type === RateLimit_1.RATELIMIT_TYPE.SYNC) {
                this.clearTimeoutAndInterval();
            }
            return foundLimit;
        }
        return null;
    }
    removeLimit(limit) {
        const index = this.indexOfLimit(limit);
        if (index !== -1) {
            const removedLimit = this.limits.splice(index, 1)[0];
            removedLimit.reloadLimiters();
            return removedLimit;
        }
        return null;
    }
    updateLimits(limitsOptions) {
        if (this.debug) {
            console.log('limits before update: ' + this.getLimitStrings());
            console.log('options to update from: ' + JSON.stringify(limitsOptions, null, 2));
        }
        this.pause();
        this.limits.filter(limit => !limitsOptions.find(options => limit.equals(options)))
            .forEach(options => this.removeLimit(options));
        if (this.isInitializing()) {
            this.limits.forEach(limit => {
                const update = limitsOptions.find(options => limit.equals(options));
                if (update) {
                    limit.update(update);
                }
            });
        }
        limitsOptions.filter(options => this.indexOfLimit(options) === -1)
            .forEach(options => {
            this.addOrUpdateLimit(new RateLimit_1.RateLimit(options, { debug: this.debug }));
        });
        if (this.debug) {
            console.log('updated limits: ' + this.getLimitStrings());
        }
        this.unpause();
    }
    indexOfLimit(limit) {
        let index = -1;
        this.limits.find((_limit, i) => {
            if (_limit.equals(limit)) {
                index = i;
                return true;
            }
            else
                return false;
        });
        return index;
    }
    notifyAboutBackoffFinished(limit) {
        if (this.debug && this.indexOfLimit(limit) === -1) {
            console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!');
        }
        this.backoffUntilTimestamp = null;
        this.addOrUpdateLimit(RateLimiter.createSyncRateLimit());
    }
    notifyAboutLimitUpdate(limit) {
        if (this.debug && this.indexOfLimit(limit) === -1) {
            console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!');
        }
        if (this.isStrategySpread()) {
            this.refresh();
        }
    }
    notifyAboutExceededLimitReset() {
        this.addOrUpdateLimit(RateLimiter.createSyncRateLimit());
    }
    notifyAboutLimitReached(limit) {
        if (this.debug && this.indexOfLimit(limit) === -1) {
            console.warn(this.toString() + ' got notified from ' + limit.toString() + ' but is not attached to it!');
        }
        console.warn('rate limit reached ' + limit.toString());
    }
    notifyAboutRemovedLimit(rateLimit) {
        this.removeLimit(rateLimit);
    }
    isStrategyBurst() {
        return this.strategy === STRATEGY.BURST;
    }
    isStrategySpread() {
        return this.strategy === STRATEGY.SPREAD;
    }
    get isPaused() {
        return this._isPaused;
    }
    checkBurstRateLimit() {
        const exceededLimit = this.limits.find(limit => !limit.check(this.strategy));
        return !exceededLimit;
    }
    checkSpreadRateLimit() {
        return this.queue.length === 0 && !this.intervalNextSpreadExecution && this.limits.length > 0;
    }
    getLimits() {
        return this.limits;
    }
    getLimitStrings() {
        return this.limits.map((limit) => limit.toString() + '\r\n');
    }
    toString() {
        let rateLimiterSetupInfo = `RateLimiter with ${this.getStrategyString()} - Limits: \r\n${this.getLimitStrings()}`;
        let spreadLimitExecutionInfo = `${this.isStrategySpread() ? `next execution in ${this.getSpreadInterval() / 1000} seconds` : ''}`;
        let backoffInfo = `${this.backoffUntilTimestamp ? `| backing off until ${new Date(this.backoffUntilTimestamp)}` : ''}`;
        return `${rateLimiterSetupInfo} | ${spreadLimitExecutionInfo} | ${backoffInfo}`;
    }
    getQueueSize() {
        return this.queue.length;
    }
    getStrategy() {
        return this.strategy;
    }
    getStrategyString() {
        switch (this.strategy) {
            case STRATEGY.SPREAD:
                return 'SPREAD Strategy';
            case STRATEGY.BURST:
                return 'BURST Strategy';
            default:
                return 'UNKNOWN Strategy';
        }
    }
    pause() {
        if (this.debug) {
            console.log('pausing limiter ' + this.toString());
        }
        this._isPaused = true;
        this.clearTimeoutAndInterval();
    }
    setStrategy(strategy) {
        this.strategy = strategy;
        this.refresh();
    }
    scheduling(fn, isReschedule = false) {
        if (this.isStrategyBurst()) {
            return this.schedulingWithBurst(fn, isReschedule);
        }
        if (this.isStrategySpread()) {
            return this.schedulingWithSpread(fn, isReschedule);
        }
    }
    rescheduling(fn) {
        return this.scheduling(fn, true);
    }
    backoff({ retryAfterMS = void 0 } = {}) {
        if (retryAfterMS === void 0) {
            if (this.debug) {
                console.log('429 from underlying system, backing off generically');
            }
            retryAfterMS = this.backoffDurationMS;
            this.backoffDurationMS *= 2;
        }
        else {
            this.backoffDurationMS = exports.RATELIMIT_BACKOFF_DURATION_MS_DEFAULT;
        }
        if (retryAfterMS <= 1000)
            retryAfterMS = 2000;
        this.backoffUntilTimestamp = Date.now() + retryAfterMS;
        if (this.debug) {
            console.log('Backing off for ' + retryAfterMS / 1000 + 'seconds');
        }
        this.addOrUpdateLimit(RateLimiter.createBackoffRateLimit((retryAfterMS / 1000), this.debug));
        this.addOrUpdateLimit(RateLimiter.createSyncRateLimit(this.debug));
    }
    resetBackoff() {
        this.backoffDurationMS = exports.RATELIMIT_BACKOFF_DURATION_MS_DEFAULT;
        this.backoffUntilTimestamp = null;
    }
    schedulingWithBurst(fn, isReschedule = false) {
        return new Promise((resolve, reject) => {
            if (this.debug) {
                console.log('scheduling request, limit not exceeded: ' + this.checkBurstRateLimit() + ' rescheduled:' +
                    ' ' + isReschedule);
            }
            if (!this.isPaused && this.checkBurstRateLimit()) {
                if (this.debug)
                    console.log('executing function');
                this.execute(fn, resolve, reject);
            }
            else {
                this.addToQueue(fn, resolve, reject, isReschedule);
            }
        });
    }
    schedulingWithSpread(fn, isReschedule = false) {
        return new Promise((resolve, reject) => {
            if (!this.isPaused && this.checkSpreadRateLimit()) {
                this.refresh();
                this.execute(fn, resolve, reject);
            }
            else {
                this.addToQueue(fn, resolve, reject, isReschedule);
            }
        });
    }
    addToQueue(fn, resolve, reject, isReschedule = false) {
        if ((this.isStrategySpread() && !this.intervalNextSpreadExecution) || (this.isStrategyBurst() && !this.intervalProcessQueue)) {
            this.refresh();
        }
        if (isReschedule) {
            this.queue.unshift({ fn, resolve, reject });
        }
        else {
            this.queue.push({ fn, resolve, reject });
        }
        return this.queue;
    }
    processSpreadLimitInterval() {
        if (this.queue.length !== 0) {
            const { fn, resolve, reject } = this.queue.shift();
            this.execute(fn, resolve, reject);
        }
        else {
            this.pause();
        }
    }
    refresh() {
        if (this.isStrategyBurst()) {
            this.refreshBurstLimiter();
        }
        else if (this.isStrategySpread()) {
            this.refreshSpreadLimiter();
        }
    }
    clearTimeoutAndInterval() {
        clearInterval(this.intervalProcessQueue);
        this.intervalProcessQueue = null;
        clearInterval(this.intervalNextSpreadExecution);
        this.intervalNextSpreadExecution = null;
    }
    refreshBurstLimiter() {
        this.clearTimeoutAndInterval();
        this.processBurstQueue();
        if (this.queue.length !== 0) {
            const factorForEqualRights = Math.floor(Math.random() * 100);
            this.intervalProcessQueue = setInterval(() => { this.processBurstQueue(); }, 1000 + factorForEqualRights);
        }
    }
    refreshSpreadLimiter() {
        this.clearTimeoutAndInterval();
        this.intervalNextSpreadExecution = setInterval(() => {
            this.processSpreadLimitInterval();
        }, this.getSpreadInterval());
    }
    execute(fn, onSuccess, onError) {
        try {
            this.limits.forEach(limit => limit.increment());
            onSuccess(fn(this));
        }
        catch (e) {
            onError(e);
        }
    }
    processBurstQueue() {
        if (this.checkBurstRateLimit()) {
            const limitWithLowestRequestsRemaining = this.limits.reduce((foundLimit, limit) => {
                if (foundLimit === null) {
                    return limit;
                }
                return (foundLimit.getRemainingRequests(STRATEGY.BURST) < limit.getRemainingRequests(STRATEGY.BURST)) ? foundLimit : limit;
            }, null);
            const queueSplice = this.queue.splice(0, limitWithLowestRequestsRemaining.getRemainingRequests(STRATEGY.BURST));
            if (this.debug && limitWithLowestRequestsRemaining.type === RateLimit_1.RATELIMIT_TYPE.SYNC) {
                console.log('processing single item to sync with headers');
                queueSplice.forEach(({ fn, resolve, reject }) => {
                    this.scheduling(fn, true).then(resolve).catch((err) => {
                        this.backoff();
                        reject(err);
                    });
                });
            }
            queueSplice.forEach(({ fn, resolve, reject }) => {
                this.scheduling(fn, true).then(resolve).catch(reject);
            });
        }
    }
    isBackoffWithoutRetryAfter() {
        return this.backoffDurationMS !== exports.RATELIMIT_BACKOFF_DURATION_MS_DEFAULT;
    }
    isStrategy(strategy) {
        return this.strategy === strategy;
    }
    getQueue() {
        return this.queue;
    }
    unpause() {
        if (this.debug) {
            console.log('unpausing limiter ' + this.toString());
        }
        this._isPaused = false;
        this.refresh();
    }
    getSpreadInterval() {
        return this.limits.reduce((longestInterval, limit) => {
            const interval = limit.getSpreadInterval();
            if (longestInterval === null)
                return interval;
            return (longestInterval > interval) ? longestInterval : interval;
        }, null);
    }
    isInitializing() {
        return !!this.limits.find(limit => limit.type === RateLimit_1.RATELIMIT_TYPE.SYNC);
    }
    static createSyncRateLimit(debug = false) {
        return new RateLimit_1.RateLimit({
            requests: 1,
            seconds: RateLimit_1.RATELIMIT_INIT_SECONDS,
            type: RateLimit_1.RATELIMIT_TYPE.SYNC
        }, { debug });
    }
    static createBackoffRateLimit(seconds, debug) {
        return new RateLimit_1.RateLimit({
            requests: 0,
            seconds: seconds,
            type: RateLimit_1.RATELIMIT_TYPE.BACKOFF
        }, { debug });
    }
}
RateLimiter.STRATEGY = STRATEGY;
exports.RateLimiter = RateLimiter;

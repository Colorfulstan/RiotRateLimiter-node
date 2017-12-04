"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../RateLimiter/index");
var RATELIMIT_TYPE;
(function (RATELIMIT_TYPE) {
    RATELIMIT_TYPE[RATELIMIT_TYPE["APP"] = 0] = "APP";
    RATELIMIT_TYPE[RATELIMIT_TYPE["METHOD"] = 1] = "METHOD";
    RATELIMIT_TYPE[RATELIMIT_TYPE["SYNC"] = 2] = "SYNC";
    RATELIMIT_TYPE[RATELIMIT_TYPE["BACKOFF"] = 3] = "BACKOFF";
})(RATELIMIT_TYPE = exports.RATELIMIT_TYPE || (exports.RATELIMIT_TYPE = {}));
exports.RATELIMIT_TYPE_STRINGS = {
    [RATELIMIT_TYPE.METHOD]: 'method',
    [RATELIMIT_TYPE.APP]: 'app',
    [RATELIMIT_TYPE.SYNC]: 'sync',
    [RATELIMIT_TYPE.BACKOFF]: 'backoff'
};
exports.RATELIMIT_INIT_SECONDS = 7200;
exports.FACTOR_REQUEST_MARGIN_BELOW_5_SEC = 0.75;
exports.FACTOR_REQUEST_MARGIN_ABOVE_5_SEC = 0.9;
class RateLimit {
    constructor({ requests, seconds, type = RATELIMIT_TYPE.APP, count = 0 }, { debug = false } = {}) {
        this.timestampLastReset = Date.now();
        this._requests = requests;
        this._seconds = seconds;
        this._type = type;
        this._count = count;
        this.startResetTimer();
        this._debug = debug;
        this.timestampLastReset = Date.now();
        this.requestsSafeBurst = (this.seconds <= 5) ? Math.floor(this.requests * exports.FACTOR_REQUEST_MARGIN_BELOW_5_SEC) : Math.floor(this.requests * exports.FACTOR_REQUEST_MARGIN_ABOVE_5_SEC);
        this.limiters = [];
    }
    get requests() { return this._requests; }
    get seconds() { return this._seconds; }
    get type() { return this._type; }
    get count() { return this._count; }
    get debug() { return this._debug; }
    static getRateLimitTypeString(type) {
        return exports.RATELIMIT_TYPE_STRINGS[type];
    }
    addLimiter(limiter) {
        this.limiters.push(limiter);
    }
    reloadLimiters() {
        this.limiters = this.limiters.filter((limiter) => {
            return limiter.getLimits().find(limit => limit.equals(this));
        });
    }
    dispose() {
        clearTimeout(this.resetTimeout);
        this.limiters.forEach(limiter => limiter.notifyAboutRemovedLimit(this));
    }
    static calcMSUntilReset(limitIntervalSeconds, timestampLastLimitReset = 0) {
        const timeSinceLastResetMS = Date.now() - timestampLastLimitReset;
        let remainingInterval = limitIntervalSeconds * 1000 - timeSinceLastResetMS;
        if (remainingInterval < 0) {
            remainingInterval *= -1;
            remainingInterval %= limitIntervalSeconds * 1000;
        }
        return remainingInterval;
    }
    check(strategy) {
        return this.getRemainingRequests(strategy) !== 0;
    }
    getSecondsUntilReset() {
        const remaingSeconds = ((this.seconds * 1000) - (Date.now() - this.timestampLastReset)) / 1000;
        return remaingSeconds > 0 ? remaingSeconds : 0;
    }
    getMaximumRequests(strategy) {
        if (this.isUsingSafetyMargin(strategy)) {
            return this.requestsSafeBurst;
        }
        else {
            return this.requests;
        }
    }
    getRemainingRequests(strategy) {
        let available;
        if (this.isUsingSafetyMargin(strategy)) {
            available = this.requestsSafeBurst;
        }
        else {
            available = this.requests;
        }
        let remaining = available - this._count;
        return remaining > 0 ? remaining : 0;
    }
    isUsingSafetyMargin(strategy) {
        return strategy === index_1.STRATEGY.BURST && this.type !== RATELIMIT_TYPE.SYNC && this.type !== RATELIMIT_TYPE.BACKOFF;
    }
    getSpreadInterval() {
        const remainingExecutionsInIntervall = this._requests - this._count;
        return RateLimit.calcMSUntilReset(this._seconds, this.timestampLastReset) / ((remainingExecutionsInIntervall > 0) ? remainingExecutionsInIntervall : 1);
    }
    increment(count = 0) {
        if (count > 0) {
            this._count += count;
        }
        else {
            this._count++;
        }
    }
    reset() {
        if (this.type === RATELIMIT_TYPE.BACKOFF) {
            this.limiters.forEach(limiter => {
                limiter.notifyAboutBackoffFinished(this);
            });
            this.dispose();
        }
        else {
            this._count = 0;
            this.timestampLastReset = Date.now();
            if (!this.check(index_1.STRATEGY.BURST)) {
                if (this.debug) {
                    console.log('resetting exceeded limit', this.toString());
                }
                this.limiters.forEach(limiter => {
                    limiter.notifyAboutExceededLimitReset();
                });
            }
            this.restartTimeout();
        }
    }
    toString() {
        return `${exports.RATELIMIT_TYPE_STRINGS[this._type]} RateLimit: ${this._count}/${this._requests}:${this._seconds} | resetting in ${this.getSecondsUntilReset()}`;
    }
    update({ requests = this._requests, seconds = this._seconds, type = this._type, count = this._count }) {
        const wasExceededBeforeUpdate = !this.check(index_1.STRATEGY.BURST);
        this.updateValues({ requests, seconds, type, count });
        const isExceededAfterUpdate = !this.check(index_1.STRATEGY.BURST);
        if (isExceededAfterUpdate || (!isExceededAfterUpdate && wasExceededBeforeUpdate)) {
            this.restartTimeout();
        }
        this.notifyLimiters();
    }
    updateSilently(limit) {
        this.updateValues(limit);
    }
    updateValues(limit) {
        if (this._debug) {
            console.log(`updating ${this.toString()}:
      requests: ${this._requests} to ${limit.requests}
      seconds ${this._seconds} to ${limit.seconds}
      count ${this._count} to ${limit.count}`);
        }
        this._requests = limit.requests;
        this._seconds = limit.seconds;
        this._type = limit.type;
        this._count = limit.count;
    }
    startResetTimer() {
        if (!this.resetTimeout) {
            if (this.debug && !this.check(index_1.STRATEGY.BURST)) {
                console.log('starting resetTimeout for exceeded limit' + this._seconds * 1000, this.toString());
            }
            this.resetTimeout = setTimeout(() => { this.reset(); }, this._seconds * 1000);
        }
    }
    notifyLimiters() {
        this.limiters.forEach(limiter => {
            limiter.notifyAboutLimitUpdate(this);
        });
    }
    static compare(limit1, limit2) {
        const compareLimits = limit2.requests - limit1.requests;
        let compareSeconds = 0;
        if (compareLimits === 0) {
            compareSeconds = limit2.seconds - limit1.seconds;
        }
        return compareSeconds + compareLimits;
    }
    compareTo(comparable) {
        return RateLimit.compare(this, comparable);
    }
    equals(limit) {
        if (limit.type === RATELIMIT_TYPE.BACKOFF || limit.type === RATELIMIT_TYPE.SYNC) {
            return this.type === limit.type;
        }
        return this.compareTo(limit) === 0;
    }
    restartTimeout() {
        clearTimeout(this.resetTimeout);
        this.resetTimeout = null;
        this.startResetTimer();
    }
}
exports.RateLimit = RateLimit;

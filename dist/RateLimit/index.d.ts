import { RateLimiter, STRATEGY } from '../RateLimiter/index';
export interface RateLimitOptions {
    requests: number;
    seconds: number;
    type?: RATELIMIT_TYPE;
    count?: number;
    debug?: boolean;
}
export interface RateLimitUpdateOptions {
    requests?: number;
    seconds?: number;
    type?: RATELIMIT_TYPE;
    count?: number;
    debug?: boolean;
}
export declare enum RATELIMIT_TYPE {
    APP = 0,
    METHOD = 1,
    SYNC = 2,
    BACKOFF = 3,
}
export declare const RATELIMIT_TYPE_STRINGS: {
    [x: number]: string;
};
export declare const RATELIMIT_INIT_SECONDS: number;
export declare const FACTOR_REQUEST_MARGIN_BELOW_5_SEC: number;
export declare const FACTOR_REQUEST_MARGIN_ABOVE_5_SEC: number;
export interface Comparable {
    equals(c: any): boolean;
    compareTo(c1: any, c2: any): number;
}
export declare class RateLimit implements Comparable, RateLimitOptions {
    private _requests;
    private requestsSafeBurst;
    readonly requests: number;
    private _seconds;
    readonly seconds: number;
    private _type;
    readonly type: RATELIMIT_TYPE;
    private _count;
    readonly count: number;
    private _debug;
    readonly debug: boolean;
    private resetTimeout;
    private timestampLastReset;
    private limiters;
    constructor({requests, seconds, type, count}: RateLimitOptions, {debug}?: {
        debug?: boolean;
    });
    static getRateLimitTypeString(type: RATELIMIT_TYPE): string;
    addLimiter(limiter: RateLimiter): void;
    reloadLimiters(): void;
    dispose(): void;
    static calcMSUntilReset(limitIntervalSeconds: number, timestampLastLimitReset?: number): number;
    check(strategy: STRATEGY): boolean;
    private getSecondsUntilReset();
    getMaximumRequests(strategy: STRATEGY): number;
    getRemainingRequests(strategy: STRATEGY): number;
    isUsingSafetyMargin(strategy: STRATEGY): boolean;
    getSpreadInterval(): number;
    increment(count?: number): void;
    reset(): void;
    toString(): string;
    update({requests, seconds, type, count}: RateLimitUpdateOptions): void;
    updateSilently(limit: RateLimitOptions): void;
    private updateValues(limit);
    private startResetTimer();
    private notifyLimiters();
    static compare(limit1: RateLimitOptions, limit2: RateLimitOptions): number;
    compareTo(comparable: RateLimitOptions): number;
    equals(limit: RateLimitOptions): boolean;
    restartTimeout(): void;
}

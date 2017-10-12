import { RateLimit, RateLimitOptions } from '../RateLimit';
export declare type RateLimiterOptions = {
    limits: RateLimit[];
    strategy?: STRATEGY;
    debug?: boolean;
};
export declare enum STRATEGY {
    BURST = 0,
    SPREAD = 1,
}
export declare const RATELIMIT_BACKOFF_DURATION_MS_DEFAULT = 1000;
export declare class RateLimiter {
    private debug;
    static STRATEGY: typeof STRATEGY;
    private backoffDurationMS;
    private backoffUntilTimestamp;
    private intervalProcessQueue;
    private intervalNextSpreadExecution;
    private queue;
    private strategy;
    private limits;
    private _isPaused;
    constructor({limits, strategy, debug}: RateLimiterOptions);
    addOrUpdateLimit(limit: RateLimit): RateLimit;
    removeLimit(limit: RateLimit): RateLimit;
    updateLimits(limitsOptions: RateLimitOptions[]): void;
    indexOfLimit(limit: RateLimit | RateLimitOptions): number;
    notifyAboutBackoffFinished(limit: RateLimit): void;
    notifyAboutLimitUpdate(limit: RateLimit): void;
    notifyAboutExceededLimitReset(): void;
    notifyAboutLimitReached(limit: RateLimit): void;
    notifyAboutRemovedLimit(rateLimit: RateLimit): void;
    isStrategyBurst(): boolean;
    isStrategySpread(): boolean;
    readonly isPaused: boolean;
    checkBurstRateLimit(): boolean;
    checkSpreadRateLimit(): boolean;
    getLimits(): RateLimit[];
    getLimitStrings(): string[];
    toString(): string;
    getQueueSize(): number;
    getStrategy(): STRATEGY;
    getStrategyString(): "SPREAD Strategy" | "BURST Strategy" | "UNKNOWN Strategy";
    private pause();
    setStrategy(strategy: STRATEGY): void;
    scheduling(fn: (limiter: RateLimiter) => any, isReschedule?: boolean): Promise<{}>;
    rescheduling(fn: (limiter: RateLimiter) => any): Promise<{}>;
    backoff({retryAfterMS}?: {
        retryAfterMS?: any;
    }): void;
    resetBackoff(): void;
    private schedulingWithBurst(fn, isReschedule?);
    private schedulingWithSpread(fn, isReschedule?);
    addToQueue(fn: (limiter: RateLimiter) => any, resolve: (value?: (PromiseLike<any> | any)) => void, reject: (reason?: any) => void, isReschedule?: boolean): {
        fn: (limiter: RateLimiter) => any;
        resolve: (value?: any) => void;
        reject: (reason?: any) => void;
    }[];
    private processSpreadLimitInterval();
    private refresh();
    private clearTimeoutAndInterval();
    private refreshBurstLimiter();
    private refreshSpreadLimiter();
    private execute(fn, onSuccess, onError);
    processBurstQueue(): void;
    private isBackoffWithoutRetryAfter();
    isStrategy(strategy: STRATEGY): boolean;
    getQueue(): {
        fn: (limiter: RateLimiter) => any;
        resolve: (value?: any) => void;
        reject: (reason?: any) => void;
    }[];
    private unpause();
    private getSpreadInterval();
    isInitializing(): boolean;
    static createSyncRateLimit(debug?: boolean): RateLimit;
    private static createBackoffRateLimit(seconds, debug);
}
